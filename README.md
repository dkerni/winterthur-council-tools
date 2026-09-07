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
| `tools/mehrheitsrechner.html` | Mehrheiten je Fraktion/Partei, Absenzen, mögliche Allianzen, teilbarer Link |
| `tools/statistik.html` | Sitzverteilung, Alter, Geschlecht, Amtsdauer, Stadtkreise (gesamt/Partei/Fraktion) |
| `tools/mitglieder.html` | Durchsuchbare, sortierbare Mitgliederliste mit Link auf das Profil und CSV-Export |
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
│       ├── charts.js       Chart.js-Wrapper mit Tabellen-Fallback
│       ├── members-ui.js   Mitgliederliste
│       ├── agenda-ui.js    Download der Traktandenliste (Startseite)
│       └── csv.js          CSV-Export
├── data/
│   ├── members.json        Mitgliederdatenbank (vom Scraper erzeugt)
│   ├── party-meta.json     Parteien, Farben, Reihenfolge, Fraktionszuordnung
│   ├── gender-overrides.json  manuell gepflegtes Merkmal Geschlecht
│   ├── seating.json        Sitzordnung aus dem offiziellen Sitzplan-PDF
│   ├── agenda.json         Stand der Traktandenliste (vom Traktanden-Workflow erzeugt)
│   └── traktandenliste.xlsx  Traktanden der nächsten Sitzung (Download der Startseite)
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
npm run validate        # data/*.json prüfen
npm test                # Unit-Tests der Mehrheits- und Traktandenlogik
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

* **Kopfbereich** (Zeilen 1–3): Titel der Sitzung, Datum und Ort, darunter der Link auf
  die Sitzungsseite; rechts steht das Logo der Mitte-Fraktion (`media/Logo Mitte
  Fraktion.png`, als Bild in die Mappe eingebettet). Den Ort führt erst die Sitzungsseite
  als Label/Wert-Paar («Ort: …»); fehlt er, bleibt die Angabe weg.
* **Kopfzeile der Tabelle** (Zeile 5): weisse Schrift auf dem Dunkelblau des Logos, mit
  Autofilter und fixiert, damit sie beim Blättern stehen bleibt.
* **Datenzeilen**: klassische Tabellenoptik mit Zellrahmen und abwechselnd weissem und
  hellblauem Hintergrund.

`data/agenda.json` hält den Stand fest:

```jsonc
{
  "schemaVersion": 2,
  "status": "ok",                       // ok = Datei vorhanden, none = keine Traktanden
  "session": { "id": "7603498", "title": "…", "url": "…",
               "date": "2026-09-21", "dates": ["2026-09-21", "2026-10-05"],
               "location": "Grosser Rathaussaal",  // null, wenn die Quelle keinen Ort nennt
               "itemCount": 42 },
  "file": "data/traktandenliste.xlsx",  // null, wenn keine Traktanden publiziert sind
  "fileName": "traktandenliste_2026-09-21.xlsx",
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
  Einzelne Koordinaten sind gegenüber dem PDF minimal verschoben, damit sich die
  Sitzsymbole in der Darstellung nicht überlappen.

## Umsetzungsstand der Ideenliste

| Idee | Stand |
| --- | --- |
| Sitzordnung | umgesetzt (`tools/sitzplan.html`) |
| Mehrheitsrechner | umgesetzt (`tools/mehrheitsrechner.html`), inkl. möglicher Allianzen |
| Statistik zur aktuellen Zusammensetzung | umgesetzt (`tools/statistik.html`); Alter, Beruf, Stadtkreis und Amtsdauer erscheinen, sobald der Scraper gelaufen ist |
| Historische Statistik (Vorstösse) | Je Person wird nur die **Anzahl** Vorstösse gespeichert; eine detaillierte Auswertung folgt |
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
* **Zusätzliche Module** `paths.js` (Basis-URL für den GitHub-Pages-Unterpfad samt
  `fetchJson`) und `csv.js` (gemeinsamer CSV-Export von Statistik und Mitgliederliste).
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

* Vorstösse/Geschäfte: `https://parlament.winterthur.ch/politbusiness`
* Sitzungen und Protokolle: `https://parlament.winterthur.ch/sitzung`
* Kommissionen: `https://parlament.winterthur.ch/kommissionen`
