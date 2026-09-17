# Winterthur Council Tools

Werkzeuge rund um das **Stadtparlament Winterthur** — eine statische Website ohne Backend
und ohne Tracking. Alle Daten stammen aus den öffentlich zugänglichen
Publikationen des Parlamentsdienstes und liegen als JSON im Repository.
Das Repository ist öffentlich; veröffentlicht wird die Seite über **GitHub Pages**
(siehe [Veröffentlichung](#veröffentlichung)).

> Privates Projekt ohne Verbindung zur Stadt Winterthur. Alle Angaben ohne Gewähr.
> Details im [Impressum](impressum.html).

## Werkzeuge

| Seite | Beschreibung |
| --- | --- |
| `index.html` | Startseite mit Tool-Kacheln, Traktanden-Download und kompaktem Mehrheitsrechner |
| `tools/sitzplan.html` | Interaktive Sitzordnung (Drag & Drop, Fraktionspräsidien, Export/Import) |
| `tools/mehrheitsrechner.html` | Mehrheiten je Fraktion/Partei, Absenzen, mögliche Allianzen (per Klick als Stimmvorlage), teilbarer Link |
| `tools/statistik.html` | «Zusammensetzung»: Sitzverteilung, Alter, Geschlecht, Amtsdauer, Stadtkreise (gesamt/Partei/Fraktion) |
| `tools/vorstoesse.html` | Historische Auswertungen zu den Geschäften seit 2000, durchgehend nach Partei |
| `tools/mitglieder.html` | Durchsuchbare, sortierbare Mitgliederliste mit Link auf das Profil |
| `impressum.html` | Betreiber, Datenquellen, Umgang mit Personendaten, Haftungsausschluss |

## Projektstruktur

```
├── index.html              Startseite
├── impressum.html
├── tools/                  je eine HTML-Seite pro Werkzeug
├── assets/
│   ├── css/main.css        Design-Tokens, Layout, Komponenten
│   ├── css/seating.css     nur für den Sitzplan
│   └── js/
│       ├── paths.js        Basis-URL aus import.meta.url (funktioniert im Unterpfad) + fetchJson
│       ├── layout.js       Header, Navigation, Footer, Disclaimer
│       ├── parties.js      Parteien-/Fraktionsmetadaten
│       ├── data.js         Datenzugriff (Promise-Cache) und Selektoren
│       ├── seating.js      Sitzplan-Logik
│       ├── majority.js     Mehrheitslogik (rein, ohne DOM, getestet)
│       ├── majority-ui.js  Oberfläche des Mehrheitsrechners (voll + kompakt)
│       ├── stats.js        Statistik-Aggregationen
│       ├── stats-ui.js     Statistik-Oberfläche
│       ├── inquiry-stats.js     Auswertungen zu den Geschäften (rein, ohne DOM, getestet)
│       ├── inquiry-stats-ui.js  Oberfläche der Seite «Vorstösse»
│       ├── charts.js       Chart.js-Wrapper mit Tabellen-Fallback
│       ├── members-ui.js   Mitgliederliste
│       ├── agenda-ui.js    Download der Traktandenliste (Startseite)
├── data/
│   ├── members.json        Mitgliederdatenbank (vom Scraper erzeugt)
│   ├── party-meta.json     Parteien, Farben, Reihenfolge, Fraktions- und Quellzuordnung
│   ├── gender-overrides.json  manuell gepflegtes Merkmal Geschlecht
│   ├── seating.json        Sitzordnung aus dem offiziellen Sitzplan-PDF
│   ├── agenda.json         Stand der Traktandenliste (vom Traktanden-Workflow erzeugt)
│   ├── traktandenliste.xlsx  Traktanden der nächsten Sitzung (Download der Startseite)
│   ├── people.json         alle je erfassten Ratsmitglieder samt Partei und Mandatsdauer
│   ├── people-overrides.json  manuelle Korrekturen zum Personenverzeichnis
│   ├── inquiry-facts.json  kompakte Auswertungsbasis der Seite «Vorstösse»
│   └── inquiries/         politische Geschäfte seit 2000 (vom Geschäfte-Workflow erzeugt)
│       ├── index.json     Registry aller Geschäfte samt Kennzahlen
│       └── <jahr>.json    vollständige Datensätze, ein Shard je Jahrgang
├── scripts/                Node-Skripte (Scraper, Validierung, Tests)
├── media/                  Logos, Wappen, Sitzplan-PDF
└── docs/PHASE-1-PLAN.md    Umsetzungsplan dieser Ausbaustufe
```

## Lokal starten

Die Seiten laden ihre Daten per `fetch`; ein Öffnen über `file://` schlägt daher fehl.
Es braucht einen beliebigen statischen Webserver im Projektverzeichnis:

```bash
npx serve .          # oder: python3 -m http.server 8080
```

Danach `http://localhost:3000` bzw. `http://localhost:8080` aufrufen. Ein Build-Schritt
ist nicht nötig — die Seite besteht aus reinen ES-Modulen und wird so ausgeliefert, wie sie
im Repository liegt.

## Veröffentlichung

Die Seite wird von `.github/workflows/deploy-pages.yml` bei jedem Push auf `main` (oder
manuell über *Actions → GitHub Pages veröffentlichen → Run workflow*) auf GitHub Pages
veröffentlicht: Tests → Datenvalidierung → `_site` zusammenstellen → Upload des
Pages-Artefakts → Deployment. Nur `index.html`, `impressum.html`, `tools/`, `assets/`,
`data/`, `media/` und `.nojekyll` gelangen ins Deployment; Skripte, Workflows und
Dokumentation bleiben aussen vor.

### Einmalige Einrichtung

1. **Pages aktivieren** — *Settings → Pages → Build and deployment → Source: **GitHub
   Actions***. Damit veröffentlicht der Workflow direkt aus Actions; es braucht weder einen
   `gh-pages`-Branch noch weitere Konfiguration.
2. Workflow laufen lassen (Push auf `main` oder *Run workflow*). Die Seite erscheint unter
   `https://dkerni.github.io/winterthur-council-tools/`.

Das Repository ist **öffentlich**, GitHub Pages ist damit ohne kostenpflichtigen Plan
verfügbar. Die Seite ist frei zugänglich; einen Passwortschutz gibt es nicht — die Daten
stammen ohnehin aus öffentlichen Publikationen des Parlamentsdienstes und liegen offen im
Repository.

### Deployment lokal nachstellen

```bash
mkdir -p _site && cp index.html impressum.html .nojekyll _site/ && cp -r assets data media tools _site/
npx serve _site
```

## Daten aktualisieren

```bash
npm run scrape          # Mitgliederdaten abrufen und data/members.json schreiben
npm run scrape:dry      # nur abrufen und Ergebnis anzeigen, nichts schreiben
npm run scrape:agenda   # Traktanden der nächsten Sitzung als Excel speichern
npm run scrape:inquiries      # politische Geschäfte abgleichen (neue und offene)
npm run scrape:inquiries:dry  # Trockenlauf mit den ersten 25 Geschäften
npm run scrape:people         # Personenverzeichnis abrufen (aktive und ausgeschiedene)
npm run build:facts           # data/inquiry-facts.json für die Seite «Vorstösse» aufbauen
npm run validate        # data/*.json prüfen
npm test                # Unit-Tests der Mehrheits-, Traktanden- und Geschäftslogik
```

Nützliche Flags: `--limit=N` (nur die ersten N Personen), `--verbose` (jede abgerufene URL),
`--strict` (Validierung: Warnungen gelten als Fehler), `--expect-members=60`.

Der Scraper ruft die Quelle sequenziell mit Pause zwischen den Anfragen ab (rund
2 Minuten für 60 Personen) und verwendet folgende Seiten:

* Mitgliederliste — `https://parlament.winterthur.ch/stadtparlament/27428`
* Personenseiten — `https://parlament.winterthur.ch/behoerdenmitglieder/<id>`
* Fraktionen — `https://parlament.winterthur.ch/fraktionen`
* Kommissionen — `https://parlament.winterthur.ch/kommissionen`

Automatisiert läuft das Ganze wöchentlich über den Workflow «Update member data»
(`.github/workflows/update-members.yml`): Scraper → Validierung → Tests → **Commit auf
`main`** und anschliessend ein Pages-Deployment. Ein Pull Request wäre zur Prüfung
angenehmer, doch GitHub Actions darf in diesem Repository keine Pull Requests erstellen
(«GitHub Actions is not permitted to create or approve pull requests»); die Änderung
wird deshalb direkt committet und allein durch Validierung und Tests abgesichert.
Warnungen der Validierung (z.B. eine auf der Quelle fehlende Berufsangabe) werden
ausgegeben, brechen den Lauf aber nicht ab — nur Schema- und Konsistenzfehler tun das.
`.github/workflows/validate.yml` prüft Tests und Daten bei jedem Push und Pull Request,
`.github/workflows/deploy-pages.yml` veröffentlicht `main` auf GitHub Pages.

## Traktandenliste der nächsten Sitzung

`scripts/scrape-agenda.mjs` liest die Sitzungsübersicht
(`https://parlament.winterthur.ch/sitzung`), bestimmt die nächste Sitzung — meist eine
Doppelsitzung mit zwei Daten —, holt deren Traktanden (z.B.
`https://parlament.winterthur.ch/sitzung/7603498`) und schreibt sie nach
`data/traktandenliste.xlsx`. Die Startseite bietet die Datei zum Download an.

Zwei Eigenheiten der Quelle sind dabei zu beachten:

* Die Übersicht führt «Nächste» und «Letzte Sitzungen» als Tabellen, deren Zeilen erst im
  Browser gerendert werden. Die Daten stehen im Attribut `data-entities`, und Sitzungen
  sind dort als `/_rte/anlass/<id>` verlinkt — dieselbe Sitzung ist unter `/sitzung/<id>`
  erreichbar. Beide Formen werden gelesen; bleibt `/sitzung/<id>` leer, dient
  `/_rte/anlass/<id>` als Ausweichpfad.
* Die Traktandenliste erscheint im Browser mehrseitig, das Blättern übernimmt aber erst
  das Tabellen-Skript. Der Quelltext enthält alle Traktanden, ein Abruf genügt. Gibt es
  dennoch echte Folgeseiten (Blätter-Parameter in der Adresse), werden sie mitgeladen.
* Traktanden mit Dokumenten enthalten in der Zelle «Bezeichnung» eine weitere Tabelle
  (Liste der Dokumente). Der Parser zählt deshalb die Tabellen-Tags, statt sie
  nicht-gierig zu suchen: Sonst endet die Zeile beim ersten `</tr>` der Dokumentenliste,
  die Werte rutschen in die falschen Spalten und die folgenden Traktanden fehlen.
  Verschachtelte Tabellen bleiben aus den Zellwerten draussen.

Spalten der Arbeitsmappe: **Nr.**, **Geschäft** (verlinkt), **Geschäftart** und
**Bezeichnung** stammen aus der Quelle; **Zuständig Fraktion**, **Resultat Kommission**,
**Entscheid Fraktion**, **Votum** und **Bemerkungen** bleiben leer und sind für die
Fraktionsarbeit gedacht. Die Datei entsteht ohne zusätzliche Abhängigkeiten
(`scripts/lib/xlsx.mjs` schreibt das XLSX-Paket direkt).

Aufbau des Blattes:

* **Kopfbereich** (Zeilen 1–2): Titel der Sitzung sowie Datum und Ort — beide Zeilen sind
  direkt mit der Sitzungsseite verknüpft; rechts steht das Logo der Mitte-Fraktion
  (`media/Logo Mitte Fraktion.png`, als Bild in die Mappe eingebettet). Den Ort führt erst
  die Sitzungsseite als Label/Wert-Paar («Ort: …»); fehlt er oder maskiert ihn die Quelle
  (ein Token wie `#1513…dc0c`, das erst ein Skript im Browser auflöst), bleibt die Angabe
  weg.
* **Kopfzeile der Tabelle** (Zeile 4): weisse Schrift auf dem Dunkelblau des Logos, mit
  Autofilter und fixiert, damit sie beim Blättern stehen bleibt.
* **Datenzeilen**: klassische Tabellenoptik mit Zellrahmen und abwechselnd weissem und
  hellblauem Hintergrund.

`data/agenda.json` hält den Stand fest:

```jsonc
{
  "schemaVersion": 4,
  "status": "ok",                       // ok = Datei vorhanden, none = keine Traktanden
  "session": { "id": "7603498", "title": "…", "url": "…",
               "date": "2026-09-21", "dates": ["2026-09-21", "2026-10-05"],
               "location": "Grosser Rathaussaal",  // null, wenn die Quelle keinen Ort nennt
               "itemCount": 42 },
  "file": "data/traktandenliste.xlsx",  // null, wenn keine Traktanden publiziert sind
  "fileName": "2026 09 21 Traktandenliste 10 11.xlsx",  // Datum, Titelzusatz, Sitzungsnummern
  "contentHash": "…"                    // erkennt unveränderte Sitzungen
}
```

Ist die gefundene Sitzung bereits gespeichert und inhaltlich unverändert, schreibt das
Skript nichts. Eine erhöhte `schemaVersion` — etwa nach einer Änderung an der
Formatierung — baut die Arbeitsmappe beim nächsten Lauf trotzdem neu auf. Ist keine
künftige Sitzung publiziert, steht `status: "none"` in `data/agenda.json` — die
Startseite weist dann darauf hin, dass noch keine Sitzungstraktanden verfügbar sind, und
der Download-Knopf bleibt deaktiviert.

Automatisiert läuft das über `.github/workflows/update-agenda.yml`: täglich um 08:00
Ortszeit (06:00 und 07:00 UTC, für Sommer- und Winterzeit), danach Tests, Commit auf den
Branch und ein angestossenes Pages-Deployment. Der Lauf zur jeweils anderen Uhrzeit findet
nichts Neues und schreibt deshalb nichts.

## Politische Geschäfte

`scripts/scrape-inquiries.mjs` erfasst alle politischen Geschäfte (Vorstösse, Anträge,
Wahlen …) als Grundlage für historische Statistiken. Stand der Erhebung: **3 217
Geschäfte ab dem Jahr 2000** in 26 Geschäftsarten.

Die Trefferliste unter `https://parlament.winterthur.ch/politbusiness` liefert mit einem
früh gesetzten Startdatum (`vomStart=17.9.1800`) den **gesamten Bestand in einem einzigen
Request** — das CMS legt die Liste als JSON im Attribut `data-entities` ab, es gibt weder
Paginierung noch eine Prüfung des Formular-Tokens. Daraus ergeben sich ID, Nummer, Titel,
Geschäftsart und Eingangsdatum; alles Weitere stammt von der Detailseite
`https://parlament.winterthur.ch/politbusiness/<id>`.

### Aktualisierungslogik

Ein zweiter Listenabruf mit dem Filter `statusId=erledigt` verrät ohne einen einzigen
Detailabruf, welche Geschäfte abgeschlossen sind (aktuell 3 138 von 3 217). Abgerufen
wird deshalb nur, was sich noch ändern kann:

| Grund | Auswahl |
| --- | --- |
| `new` | Geschäft steht nicht im Index |
| `open` | gespeichertes Geschäft ohne Status «Erledigt» — es kann sich noch ändern |
| `reopened` | als erledigt gespeichert, fehlt aber im Erledigt-Filter |
| `changed` | Nummer, Eingangsdatum oder Geschäftsart weichen von der Liste ab |
| `all` | `--full`, fehlender Index oder erhöhte `schemaVersion` |

Geschäfte, die an der Quelle verschwinden, werden entfernt. Ein Datensatz, dessen
`contentHash` unverändert bleibt, wird **nicht** neu geschrieben — auch sein `fetchedAt`
bleibt stehen, damit der wöchentliche Lauf keine leeren Commits erzeugt.

Der erste Lauf liest rund 3 200 Detailseiten und dauert 20–30 Minuten; danach sind es pro
Woche rund 80 neue und offene Geschäfte (etwa eine Minute). Wie die übrigen Scraper ruft
auch dieser die Quelle sequenziell mit Pause, Timeout und Wiederholversuchen ab.

Nützliche Flags: `--full` (Vollabgleich), `--dry-run`, `--verbose`, `--limit=N`,
`--year=YYYY`, `--id=<id>`, `--force` (überspringt die Plausibilitätsprüfung). Liefert die
Liste weniger als 90 % des gespeicherten Bestands, bricht der Lauf ab, ohne zu schreiben —
eine Störung der Quelle soll die Daten nicht leeren.

Automatisiert läuft das über `.github/workflows/update-inquiries.yml`: montags um 04:00
UTC, danach Tests, Commit auf den Branch und ein angestossenes Pages-Deployment. Der
Vollabgleich lässt sich über *Actions → Politische Geschäfte aktualisieren → Run workflow*
mit der Option **full** anstossen.

### Ablage

Die Daten liegen in `data/inquiries/`: ein schlanker `index.json` als Registry samt
Kennzahlen und je Jahrgang ein Shard mit den vollständigen Datensätzen. Beide Dateien
schreiben **eine Zeile je Geschäft** — gültiges JSON, aber mit zeilenweisen Git-Diffs, so
dass eine wöchentliche Änderung nur die betroffenen Zeilen berührt.

```jsonc
// data/inquiries/index.json
{
  "schemaVersion": 1,
  "generatedAt": "2026-09-17T12:00:00Z",
  "source": "https://parlament.winterthur.ch/politbusiness?…",
  "lastFullSync": "2026-09-17T12:00:00Z",
  "lastSubmittedDate": "2026-09-08",   // jüngstes Eingangsdatum im Bestand
  "counts": { "total": 3217, "closed": 3138, "open": 79,
              "byYear": { "2000": 98 }, "byType": { "Motion": 113 },
              "byStatus": { "Erledigt": 3138 } },
  "years": [{ "year": 2026, "file": "2026.json", "count": 94, "open": 70 }],
  "inquiries": [{ "id": "2777389", "number": "2026.14", "year": 2026,
                  "type": "Schriftliche Anfrage", "status": "Erledigt",
                  "submittedDate": "2026-03-02", "closed": true,
                  "contentHash": "…" }]
}
```

```jsonc
// data/inquiries/<jahr>.json — ein Eintrag je Geschäft
{
  "id": "2777389",
  "url": "https://parlament.winterthur.ch/politbusiness/2777389",
  "number": "2026.14",
  "numberSort": "202600014",           // stabile Sortierung aus der Quelle
  "year": 2026,
  "title": "Schulabsentismus in Winterthur",
  "type": "Schriftliche Anfrage",
  "typeId": "schriftliche-anfrage",
  "status": "Erledigt",                // null, wenn die Quelle keinen Status nennt
  "statusId": "erledigt",
  "closed": true,                      // steuert den wöchentlichen Nachlauf
  "submittedDate": "2026-03-02",       // Eingangsdatum

  "authors": [{ "name": "Vogel Kaspar", "lastName": "Vogel", "firstName": "Kaspar",
                "role": "Erstunterzeichner/-in", "roleId": "erstunterzeichner",
                "personId": "297677",  // gleiche ID wie in data/members.json
                "personUrl": "https://parlament.winterthur.ch/behoerdenmitglieder/297677" }],

  // Verlauf des Geschäfts: alle Felder der Detailseite in Quellreihenfolge,
  // inklusive Wiederholungen (zwei Beratungsstufen = zweimal «Beschlussdatum …»)
  "stages": [{ "label": "Beschlussdatum Stadtparlament", "value": "11. Mai 2026",
               "date": "2026-05-11" },
             { "label": "Beschlussart Stadtparlament", "value": "Zustimmung" }],

  // aus stages abgeleitet: je Beratungsschritt ein Eintrag
  "decisions": [{ "body": "Stadtparlament", "date": "2026-05-11", "decision": "Zustimmung",
                  "vote": { "raw": "27:25 (3 Enthaltungen)", "yes": 27, "no": 25,
                            "abstentions": 3, "unanimous": false } }],

  "dates": { "submitted": "2026-03-02",
             "deadline": "2026-06-02",          // «Frist für Antrag / Beantwortung bis»
             "answeredByCouncil": "2026-05-20", // «Beantwortung durch Stadtrat vom»
             "motion": null,                    // «Antrag vom»
             "report": null,                    // «Antrag und Bericht vom»
             "assigned": null,                  // «Zuweisung am»
             "finalDecision": "2026-05-11",     // letzter Parlamentsbeschluss laut Quelle
             "concluded": "2026-05-11" },       // Abschlussdatum, notfalls abgeleitet
  "concludedSource": "decision",       // decision | document | session | null
  "durationDays": 70,                  // submitted → concluded

  "applicant": null,                   // «Antragsteller» (Stadtrat, Parlamentsleitung …)
  "committee": null,                   // «Geschäft in Vorberatung bei»
  "remarks": null,                     // «Bemerkungen»

  "documents": [{ "name": "2026.14V", "url": "https://…/_doc/5536708",
                  "date": "2026-03-02", "category": "Vorstoss",
                  "fileType": "PDF", "fileSize": "71 kB" }],
  "sessions": [{ "id": "6789199", "name": "9./10. Sitzungen", "date": "2026-01-19",
                 "url": "https://parlament.winterthur.ch/sitzung/6789199" }],

  "fetchedAt": "2026-09-17T12:00:00Z",
  "contentHash": "…"                   // erkennt echte inhaltliche Änderungen
}
```

Alle Geschäftsarten nutzen **dasselbe Schema**. Die festen Kernfelder (Jahr, Art, Status,
Dauer, Verfasser) erlauben Auswertungen über alle Arten hinweg; die typabhängigen Abläufe
stecken verlustfrei in `stages`, aus dem `decisions` und `dates` abgeleitet werden.
Führt die Quelle ein neues Feld ein, landet es automatisch in `stages`, statt verloren zu
gehen.

Die Quelle nennt Verfasser als Text («Vogel Kaspar (Erstunterzeichner/-in)») und verlinkt
nur einen Teil von ihnen als Person. Gespeichert werden deshalb Name, Rolle und — sofern
vorhanden — die Personen-ID; eine Zuordnung zu Partei und Fraktion ist damit bis auf
Weiteres nur für verlinkte Personen möglich.

### Abschlussdatum und Dauer

Vor etwa 2017 nennt die Quelle bei den meisten Geschäften **kein Beschlussdatum**; ein
allein darauf gestütztes `durationDays` gäbe es nur für rund 500 der 3 138 erledigten
Geschäfte. `dates.concluded` fällt deshalb gestuft zurück, `concludedSource` weist die
Herkunft aus:

| `concludedSource` | Herleitung | Anzahl |
| --- | --- | --- |
| `decision` | `dates.finalDecision` aus der Quelle | 536 |
| `document` | jüngstes Dokument der Kategorie «Beschluss …» | 1 294 |
| `session` | jüngstes Sitzungsdatum | 24 |
| `null` | nicht ermittelbar oder Geschäft noch offen | 1 363 |

Die Rückfälle greifen **nur bei erledigten Geschäften**; Überweisungsbeschlüsse bleiben
aussen vor, weil sie nur eine Zwischenstufe sind. Wer ausschliesslich Datumsangaben der
Quelle auswerten will, filtert auf `concludedSource === "decision"` oder nutzt
`dates.finalDecision` direkt.

## Historische Auswertungen («Vorstösse»)

Die Seite `tools/vorstoesse.html` wertet die 3 217 Geschäfte **nach Partei** aus:
Vorstösse je Partei und Jahr, genutzte Instrumente, Mitunterzeichnungen, Beschlüsse
und Behandlungsdauer. Gruppiert wird bewusst nach Partei und nicht nach Fraktion —
Fraktionszugehörigkeiten wechselten über 25 Jahre zu häufig, um vergleichbar zu sein.

Die bestehende Statistikseite heisst neu **«Zusammensetzung»** (`tools/statistik.html`,
URL unverändert) und behandelt weiterhin den aktuellen Rat.

### Ablauf

```
scrape-inquiries  →  data/inquiries/*.json   (Geschäfte samt Verfasserangaben)
scrape-people     →  data/people.json        (alle je erfassten Ratsmitglieder)
build-inquiry-facts → data/inquiry-facts.json (Auswertungsbasis fürs Frontend)
```

Alle drei Schritte laufen im Workflow «Politische Geschäfte aktualisieren»
nacheinander; `build-inquiry-facts` greift nicht aufs Netz zu.

### Personenverzeichnis

`https://parlament.winterthur.ch/stadtparlament/27428` liefert in **einem** Request die
Tabelle `icmsTable-personList` mit **allen 226 Personen** — aktiven und ausgeschiedenen.
Der Status-Filter der Seite wirkt rein clientseitig. Laufende Mandate tragen das
Enddatum `9999-12-31`; `_mandatPersonFirstDatumVon` nennt den ersten Eintritt,
`_mandatPersonDatumVon` das aktuelle Mandat.

`data/people.json` ist eine Obermenge von `data/members.json` (gleicher ID-Raum), aber
schlanker: nur Name, Partei, Wahlkreis, Mandatsdaten. `members.json` bleibt die Quelle
für Sitzplan, Mehrheitsrechner und Mitgliederseite.

### Parteien über die Zeit

Parteien wurden umbenannt (CVP → Die Mitte, Alternative Liste → Alternative Linke).
Anker ist deshalb die **Partei-ID der Quelle** (`/_rte/partei/<id>`), nicht der Name.
Die Zuordnung steht in `data/party-meta.json` unter `sourceIds`:

| Quell-ID | Bezeichnung in der Quelle | Partei |
| --- | --- | --- |
| 5762 | Sozialdemokratische Partei (SP) | `sp` |
| 5759 | Schweizerische Volkspartei (SVP) | `svp` |
| 5753 | FDP.Die Liberalen (FDP) | `fdp` |
| 5771 | Grüne Partei (Grüne) | `gruene` |
| 5756 | Grünliberale Partei (GLP) | `glp` |
| 5774 | Evangelische Volkspartei (EVP) | `evp` |
| 5777 | Eidgenössisch-Demokratische Union (EDU) | `edu` |
| 5780 | Alternative Linke (AL; früher: Alternative Liste) | `al` |
| 5920 | Christliche Volkspartei (CVP; heute: Die Mitte) | `mitte` |
| 5750 | Die Mitte | `mitte` |
| 8263 | Schweizer Demokraten (früher Nationale Aktion) | `sd` |

`sd` ist mit `historical: true` gekennzeichnet und hat keine Fraktion. Sitzplan und
Mehrheitsrechner filtern Parteien ohne Sitze bereits heraus und bleiben unverändert.
Personen ohne Partei-Link in der Quelle werden über `data/people-overrides.json`
zugeordnet (derzeit ein Fall: Urs Glättli → GLP).

### Zuordnung Verfasser → Person → Partei

Alle 3 153 Verfassernennungen in 1 531 Geschäften lassen sich auflösen: 930 über die
`personId` aus dem Geschäft, 2 223 über den Namen im Verzeichnis, **keine offen**.

### Grenzen der Daten

Die Seite weist sie unter «Datengrundlage» aus:

* **Verfasserangaben** führen nur Vorstösse. Verwaltungsgeschäfte (Wahlen, Kreditantrag,
  Bericht, Budget, Jahresrechnung, Verordnung) nennen keine Person — rund 1 460 Geschäfte.
* **2000 enthält keine einzige Verfasserangabe, 2001 genau eine.** Partei-Auswertungen
  beginnen deshalb bei **2002**.
* **Keine Partei-Historie:** die Quelle hinterlegt je Person nur die zuletzt erfasste
  Partei. Parteiwechsel werden rückwirkend der letzten Partei zugerechnet.
* **Beschlussarten** sind erst ab rund **2017** erfasst (522 Geschäfte im Auswertungs-
  zeitraum) — Auswertungen zum Ausgang gelten nur für diese Jahre.
* **Behandlungsdauer** liegt für 1 853 Geschäfte vor, brauchbar ab etwa 2007.
* **Sitzzahlen je Jahr** werden aus den Mandatsperioden abgeleitet. Ab 2007 ergeben sich
  Totale von 59–63 (Soll 60), davor ist das Verzeichnis lückenhaft (2000: 20 von 60);
  wer vor 2003 ausschied, fehlt ganz. Die Normalisierung «je Ratsmitglied» rechnet
  deshalb erst ab **2007** und nur mit plausiblen Jahren.

### `data/inquiry-facts.json`

Eine Zeile je Geschäft, kurze Feldnamen, leere Felder entfallen — rund 355 kB statt der
6 MB der Jahres-Shards. Die Feldbeschreibung steht im Kopf der Datei selbst (`fields`):

```jsonc
{
  "i": "2777389",              // ID; URL = https://parlament.winterthur.ch/politbusiness/<i>
  "y": 2024,                   // Jahr des Eingangs
  "t": "interpellation",       // Geschäftsart, siehe "types"
  "s": "erledigt",             // Status
  "d": 288,                    // Behandlungsdauer in Tagen
  "o": "angenommen",           // Gruppe der Beschlussart, siehe "outcomeGroups"
  "b": "Überweisung",          // Beschlussart im Wortlaut
  "p": "sp",                   // Partei der erstunterzeichnenden Person
  "a": [["281057", "glp", 1]]  // [Personen-ID, Partei-ID, Rolle]
}
```

Rolle: `1` = Erstunterzeichnung, `2` = Mitunterzeichnung, `3` = übrige Beteiligung.
Der Kopf enthält zusätzlich `types`, `parties`, `outcomeGroups`, `people` (nur die
verfassenden Personen), `seats` (abgeleitete Besetzung je Jahr und Partei), `coverage`
(Abdeckung je Jahr) und `dataQuality`.

Das Frontend lädt **ausschliesslich** diese Datei — weder die Jahres-Shards noch
`data/inquiries/index.json`.

## Datenschema

`data/members.json` (`schemaVersion: 2`):

```jsonc
{
  "schemaVersion": 2,
  "generatedAt": "2026-07-01T00:00:00Z",   // Zeitpunkt des Scraper-Laufs
  "generatedBy": "scripts/scrape-members.mjs",
  "source": "https://parlament.winterthur.ch",
  "sources": { /* verwendete URLs */ },
  "dataQuality": { "complete": true, "note": "…", "warnings": 0 },
  "parties":     [{ "id": "svp", "abbr": "SVP", "name": "…", "color": "#…", "seats": 10 }],
  "fractions":   [{ "id": "evp-edu", "shortName": "EVP/EDU", "name": "…", "partyIds": ["evp", "edu"] }],
  "commissions": [{ "id": "…", "name": "…", "shortName": "…" }],
  "members": [{
    "id": "angele-philipp",          // slug aus Nachname+Vorname, stabil
    "firstName": "Philipp",
    "lastName": "Angele",
    "displayName": "Philipp Angele",
    "email": null,                   // null = von der Quelle nicht publiziert
    "address": null,
    "partyId": "svp",
    "fractionId": "svp",
    "birthYear": null,
    "profession": null,
    "firstEntryDate": null,          // erster Eintritt ins Parlament (ISO-Datum)
    "currentMandateStart": null,
    "mandateEnd": null,              // Austritt (ISO-Datum), null = weiterhin im Amt
    "district": null,                // Stadtkreis
    "gender": "m",                   // m | w | d | unbekannt
    "genderSource": "override",      // override | heuristik | unbekannt
    "commissions": [{ "id": "…", "name": "…", "role": "Mitglied" }],
    "inquiryCount": 0,               // Anzahl Vorstösse (nur die Anzahl, keine Details)
    "profileUrl": null,
    "photoUrl": null
  }]
}
```

Ergänzend:

* `data/party-meta.json` — verbindliche Kurznamen, Farben, Reihenfolge (rechts → links:
  SVP, FDP, Mitte, GLP, EDU, EVP, SP, Grüne, AL), Fraktionszuordnung und Aliasnamen für
  die Zuordnung der Schreibweisen aus der Quelle.
* `data/gender-overrides.json` — das Merkmal Geschlecht wird von der Quelle **nicht**
  publiziert. Es wird ausschliesslich für Statistiken verwendet, manuell gepflegt und bei
  fehlender Grundlage als `unbekannt` geführt. Korrekturen sind über die im Impressum
  genannten Kontaktwege willkommen.
* `data/seating.json` — Sitzordnung inkl. Koordinatenabbildung aus dem Sitzplan-PDF.
  Nebst den 60 Ratssitzen enthält die Datei die Stadtratssitze (`frontSeats`) und die
  fünf Plätze des Präsidiums/Büros (`presidiumSeats`: Protokollführung, Parlamentsschreiber,
  Parlamentspräsidium, 1. Vizepräsidium, Parlamentssekretär). Beide vorderen Reihen sind im
  Tool nicht verschiebbar. Einzelne Koordinaten sind gegenüber dem PDF minimal verschoben,
  damit sich die Sitzsymbole in der Darstellung nicht überlappen.

## Umsetzungsstand der Ideenliste

| Idee | Stand |
| --- | --- |
| Sitzordnung | umgesetzt (`tools/sitzplan.html`) |
| Mehrheitsrechner | umgesetzt (`tools/mehrheitsrechner.html`), inkl. möglicher Allianzen |
| Statistik zur aktuellen Zusammensetzung | umgesetzt (`tools/statistik.html`, «Zusammensetzung»); Alter, Beruf, Stadtkreis und Amtsdauer erscheinen, sobald der Scraper gelaufen ist |
| Historische Statistik (Vorstösse) | umgesetzt (`tools/vorstoesse.html`): Auswertungen nach Partei auf Basis von `data/inquiries/`, `data/people.json` und `data/inquiry-facts.json` |
| Zusammenfassung der nächsten Sitzung | offen (nächste Ausbaustufe) |
| Traktandenliste als Excel/CSV | umgesetzt (`scripts/scrape-agenda.mjs`, Download auf der Startseite) |

## Rahmenbedingungen des Rats

* 60 Mitglieder, Sitzungen in der Regel am Montagabend.
* Die Sitzverteilung gilt für die **Legislatur 2026–2030** und bleibt über die ganze
  Legislatur konstant; einzelne Namen können durch Rücktritte und Nachrückende wechseln
  (Namensstand der Tools: **1. August 2026**).
* Das **Ratspräsidium stimmt nicht mit** (Legislatur 2026–2030: Samuel Kocher, GLP) und hat
  bei Stimmengleichheit den Stichentscheid. Der Mehrheitsrechner rechnet deshalb mit
  **59 stimmberechtigten Sitzen**; die GLP hat dort einen Sitz weniger als im Rat.
* Parteien von rechts nach links: SVP, FDP, Mitte, GLP, EDU, EVP, SP, Grüne, AL.
* Parteien mit weniger als vier Sitzen bilden gemeinsame Fraktionen: EVP + EDU sowie
  Grüne + AL. Es gibt daher **7 Fraktionen bei 9 Parteien** — Mehrheiten lassen sich in
  beiden Sichten berechnen.
* Absolutes Mehr: 30 von 59 stimmberechtigten Sitzen. Das einfache Mehr bezieht sich auf die
  abgegebenen Stimmen, nicht auf die Ratsgrösse.

## Abweichungen vom ursprünglichen Vorschlag

* **`package.json` trotz „kein Build-Tool“** — es werden keine Abhängigkeiten installiert
  und nichts gebündelt. Die Datei dient nur den npm-Skripten und `"type": "module"`,
  damit `node --test` die Browser-Module direkt importieren kann.
* **Zusätzliches Modul** `paths.js` für die Basis-URL des GitHub-Pages-Unterpfads samt
  `fetchJson`.
* **Vorläufige `data/members.json`** — die Datei wurde aus `data/seating.json` und
  `data/gender-overrides.json` erzeugt (`scripts/bootstrap-members.mjs`), weil die
  Entwicklungsumgebung keinen Netzwerkzugriff auf `parlament.winterthur.ch` hat. Sie
  enthält ausschliesslich bereits im Repository vorhandene Angaben (Name, Partei,
  Fraktion); alle weiteren Felder sind `null` und `dataQuality.complete` ist `false`.
  Der erste Lauf von `npm run scrape` ersetzt die Datei vollständig.
* **Scraper nicht gegen die Live-Seite getestet** — aus demselben Grund. Das Parsen des
  i-web-CMS (JSON in `data-entities`, doppelt escaped) ist nach bestem Wissen umgesetzt,
  inklusive Browser-User-Agent, mehrerer Erkennungsstrategien und Warnungen bei
  unerwarteter Struktur. **Der erste Lauf der GitHub Action muss daher kontrolliert
  werden**; der Commit des Workflows macht die Änderungen sichtbar. Der erste Lauf des
  Traktanden-Workflows fand denn auch keine Sitzung, weil die Übersicht Sitzungen als
  `/_rte/anlass/<id>` verlinkt und nicht als `/sitzung/<id>`; die Tests bilden das
  Quell-Markup seither nach.
* **Amtsdauer** = Zeit seit dem ersten Eintritt ins Parlament (Anzeige in Jahren und Monaten,
  CSV in Jahren); Unterbrüche werden nicht abgezogen, weil die Quelle nur Eintrittsdaten publiziert.
* **Alter** ist auf ±1 Jahr genau, da die Quelle nur das Geburtsjahr nennt.
* **Chart.js** wird von jsDelivr mit fester Version und SRI-Hash geladen. Ist das CDN
  nicht erreichbar, zeigen die Diagramme automatisch eine Wertetabelle.

## Weitere Datenquellen für spätere Ausbaustufen

* Vorstösse/Geschäfte: `https://parlament.winterthur.ch/politbusiness` — erschlossen, siehe
  [Politische Geschäfte](#politische-geschäfte) und
  [Historische Auswertungen](#historische-auswertungen-vorstösse)
* Personenverzeichnis (aktive und ausgeschiedene Mitglieder):
  `https://parlament.winterthur.ch/stadtparlament/27428` — erschlossen, siehe
  `scripts/scrape-people.mjs`
* Sitzungen und Protokolle: `https://parlament.winterthur.ch/sitzung`
* Kommissionen: `https://parlament.winterthur.ch/kommissionen`
