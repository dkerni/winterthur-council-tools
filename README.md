# Winterthur Council Tools

Werkzeuge rund um das **Stadtparlament Winterthur** — eine statische Website ohne Backend,
ohne Login und ohne Tracking. Alle Daten stammen aus den öffentlich zugänglichen
Publikationen des Parlamentsdienstes und liegen als JSON im Repository.

> Privates Projekt ohne Verbindung zur Stadt Winterthur. Alle Angaben ohne Gewähr.
> Details im [Impressum](impressum.html).

## Werkzeuge

| Seite | Beschreibung |
| --- | --- |
| `index.html` | Startseite mit Tool-Kacheln, kompaktem Mehrheitsrechner und Datenstand |
| `tools/sitzplan.html` | Interaktive Sitzordnung (Drag & Drop, Fraktionspräsidien, Export/Import) |
| `tools/mehrheitsrechner.html` | Mehrheiten je Partei/Fraktion, Absenzen, minimale Gewinn-Koalitionen, teilbarer Link |
| `tools/statistik.html` | Sitzverteilung, Alter, Geschlecht, Amtsdauer, Stadtkreise, Berufe (gesamt/Partei/Fraktion) |
| `tools/mitglieder.html` | Durchsuchbare, sortierbare Mitgliederliste mit Detailbereich und CSV-Export |
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
│       ├── paths.js        Basis-URL aus import.meta.url (funktioniert im Unterpfad)
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
│       └── csv.js          CSV-Export
├── data/
│   ├── members.json        Mitgliederdatenbank (vom Scraper erzeugt)
│   ├── party-meta.json     Parteien, Farben, Reihenfolge, Fraktionszuordnung
│   ├── gender-overrides.json  manuell gepflegtes Merkmal Geschlecht
│   └── seating.json        Sitzordnung aus dem offiziellen Sitzplan-PDF
├── scripts/                Node-Skripte (Scraper, Validierung, Tests)
├── media/                  Wappen, Sitzplan-PDF
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

## Daten aktualisieren

```bash
npm run scrape          # Mitgliederdaten abrufen und data/members.json schreiben
npm run scrape:dry      # nur abrufen und Ergebnis anzeigen, nichts schreiben
npm run validate        # data/*.json prüfen
npm test                # Unit-Tests der Mehrheitslogik
```

Nützliche Flags: `--limit=N` (nur die ersten N Personen), `--verbose` (jede abgerufene URL),
`--strict` (Validierung: Warnungen gelten als Fehler), `--expect-members=60`.

Der Scraper ruft die Quelle sequenziell mit Pause zwischen den Anfragen ab (rund
2 Minuten für 60 Personen) und verwendet folgende Seiten:

* Mitgliederliste — `https://parlament.winterthur.ch/stadtparlament/27428`
* Personenseiten — `https://parlament.winterthur.ch/behoerdenmitglieder/<id>`
* Fraktionen — `https://parlament.winterthur.ch/fraktionen`
* Kommissionen — `https://parlament.winterthur.ch/kommissionen`

Automatisiert läuft das Ganze wöchentlich über
`.github/workflows/update-members.yml`: Scraper → strenge Validierung → Tests → **Pull
Request** (kein direkter Push auf `main`), damit jede Datenänderung sichtbar geprüft wird.
`.github/workflows/validate.yml` prüft Tests und Daten bei jedem Push und Pull Request.

## Datenschema

`data/members.json` (`schemaVersion: 1`):

```jsonc
{
  "schemaVersion": 1,
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
    "district": null,                // Stadtkreis
    "gender": "m",                   // m | w | d | unbekannt
    "genderSource": "override",      // override | heuristik | unbekannt
    "commissions": [{ "id": "…", "name": "…", "role": "Mitglied" }],
    "inquiries":   [{ "title": "…", "type": "…", "date": "…", "url": "…", "role": "first" }],
    "inquiryCounts": { "total": 0, "first": 0, "co": 0 },
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
  fehlender Grundlage als `unbekannt` geführt. Korrekturen sind über Issues willkommen.
* `data/seating.json` — Sitzordnung inkl. Koordinatenabbildung aus dem Sitzplan-PDF.

## Umsetzungsstand der Ideenliste

| Idee | Stand |
| --- | --- |
| Sitzordnung | umgesetzt (`tools/sitzplan.html`) |
| Mehrheitsrechner | umgesetzt (`tools/mehrheitsrechner.html`), inkl. minimaler Gewinn-Koalitionen |
| Statistik zur aktuellen Zusammensetzung | umgesetzt (`tools/statistik.html`); Alter, Beruf, Stadtkreis und Amtsdauer erscheinen, sobald der Scraper gelaufen ist |
| Historische Statistik (Vorstösse) | Grundlage gelegt: Vorstösse werden je Person strukturiert gespeichert; eigene Auswertung folgt |
| Zusammenfassung der nächsten Sitzung | offen (nächste Ausbaustufe) |
| Traktandenliste als Excel/CSV | offen; CSV-Export besteht bereits für Mitglieder und Statistik |

## Rahmenbedingungen des Rats

* 60 Mitglieder, Sitzungen in der Regel am Montagabend.
* Parteien von rechts nach links: SVP, FDP, Mitte, GLP, EDU, EVP, SP, Grüne, AL.
* Parteien mit weniger als vier Sitzen bilden gemeinsame Fraktionen: EVP + EDU sowie
  Grüne + AL. Es gibt daher **7 Fraktionen bei 9 Parteien** — Mehrheiten lassen sich in
  beiden Sichten berechnen.
* Absolutes Mehr: 31 von 60 Sitzen. Das einfache Mehr bezieht sich auf die abgegebenen
  Stimmen, nicht auf die Ratsgrösse.

## Abweichungen vom ursprünglichen Vorschlag

* **`package.json` trotz „kein Build-Tool“** — es werden keine Abhängigkeiten installiert
  und nichts gebündelt. Die Datei dient nur den npm-Skripten und `"type": "module"`,
  damit `node --test` die Browser-Module direkt importieren kann.
* **Zusätzliche Module** `paths.js` (Basis-URL für den GitHub-Pages-Unterpfad) und
  `csv.js` (gemeinsamer CSV-Export von Statistik und Mitgliederliste).
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
  werden**; der erzeugte Pull Request macht die Änderungen sichtbar.
* **Amtsdauer** = Jahre seit dem ersten Eintritt ins Parlament; Unterbrüche werden nicht
  abgezogen, weil die Quelle nur Eintrittsdaten publiziert.
* **Alter** ist auf ±1 Jahr genau, da die Quelle nur das Geburtsjahr nennt.
* **Chart.js** wird von jsDelivr mit fester Version und SRI-Hash geladen. Ist das CDN
  nicht erreichbar, zeigen die Diagramme automatisch eine Wertetabelle.

## Weitere Datenquellen für spätere Ausbaustufen

* Vorstösse/Geschäfte: `https://parlament.winterthur.ch/politbusiness`
* Sitzungen und Protokolle: `https://parlament.winterthur.ch/sitzung`
* Kommissionen: `https://parlament.winterthur.ch/kommissionen`
