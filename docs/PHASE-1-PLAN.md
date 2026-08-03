# Phase 1 — Umbau zur Tool-Plattform + Mehrheitsrechner + Statistiken

## Problemstellung

Das Repo besteht heute aus **einer einzigen `index.html`** (31 KB, CSS + JS + Sitzdaten inline) mit
dem Tool "Sitzplan Parlamentssaal". Es gibt keine Navigation, keine gemeinsame Datenbasis und keine
Möglichkeit, weitere Tools sinnvoll zu ergänzen.

In Phase 1 sollen umgesetzt werden:

1. **Umbau der Website** zu einer statischen Multi-Page-Site mit Landing Page und Tool-Navigation
2. **Member-Datenbank** (`data/members.json`) inkl. Aktualisierungs-Mechanismus
3. **Mehrheitsrechner** (neues Tool)
4. **Allgemeine Präsenz-Statistiken** (neues Tool)
5. **Mitglieder-Übersicht** (neues Tool, macht die Datenbank sichtbar/prüfbar)
6. **Disclaimer / Impressum** (Datenquelle + Autor)

Nicht in Phase 1: Inquiries-Datenbank als eigenständiges Tool, historische Statistiken,
Sitzungs-Zusammenfassung, Excel-Export.

---

## Getroffene Entscheidungen

| Thema | Entscheidung |
|---|---|
| Architektur | Statische Multi-Page-Site, **kein Build-Tool**. `index.html` + `tools/*.html`, geteilte `assets/css` + `assets/js` (ES-Module), `data/*.json` |
| Datenbeschaffung | **Node-Scraper im Repo** + GitHub Action (manuell + wöchentlich), committet `data/members.json`. Website liest nur das JSON |
| Geschlecht | Nicht in der Quelle vorhanden → manuell gepflegte `data/gender-overrides.json`, Rest = `unbekannt`, in der UI transparent ausgewiesen |
| Landing Page | Tool-Kacheln + kompaktes Mehrheitsrechner-Widget eingebettet |
| Mehrheitsrechner | Umschaltbar **Partei / Fraktion**, plus Absenzen pro Gruppe |
| Diagramme | **Chart.js via CDN** (mit SRI-Hash und `defer`) |
| Mitglieder-Tool | Ja — Suche, Filter (Partei/Fraktion/Kommission/Stadtkreis), Detailansicht |
| Personendaten | Alle Felder inkl. E-Mail und Adresse (auf parlament.winterthur.ch öffentlich) |

---

## Kritische Prüfung des Datenbank-Vorschlags aus dem README

> Der umsetzende Agent **muss** diesen Abschnitt lesen und die Datenmodell-Entscheidungen
> selbst noch einmal gegen die echten Seiten verifizieren, bevor er den Scraper schreibt.

### Recherche-Ergebnisse (bereits verifiziert)

* Die Website läuft auf dem **i-web CMS**. Listenseiten enthalten die kompletten Daten als
  **HTML-escaped JSON im Attribut `data-entities`** einer `<table class="icms-dt">`. Das ist
  wesentlich robuster zu parsen als das gerenderte HTML.
* Die Seite liefert **keinen `Access-Control-Allow-Origin`-Header** (verifiziert per
  `curl -I` mit `Origin`-Header) und setzt `X-Frame-Options: DENY`.
  → **Ein Aktualisieren der Datenbank direkt aus dem Browser ist technisch unmöglich.**
  Das ist der Hauptgrund für den Scraper + GitHub Action.
* Ein User-Agent-Filter ist aktiv: ohne Browser-`User-Agent` kommt eine
  "veraltete Browserversion"-Fehlerseite (622 Bytes). Der Scraper **muss** einen
  Browser-UA setzen.

### Korrekturen am README-Vorschlag

| README sagt | Realität | Konsequenz |
|---|---|---|
| Member-Details unter `/behoerdenmitglieder/XXXXXX` | Stimmt, aber die IDs stehen in der Liste als `/_rte/person/{id}` (redirectet auf `/behoerdenmitglieder/{id}`) | IDs aus dem `data-entities`-JSON der Liste ziehen, nicht aus HTML-Links |
| "Refresh der Datenbank" (impliziert Browser) | CORS blockiert das | Refresh = GitHub Action / lokaler Node-Lauf. In der UI stattdessen: Anzeige des Datenstands + Link zum Action-Workflow |
| Feld "Gender" (in Ideen für Statistik) | Existiert nicht in der Quelle | Separate Override-Datei, Default `unbekannt` |
| Feld "Fraction" am Mitglied | Steht nicht auf der Personenseite | Muss über `/fraktionen` → `/_rte/behoerde/{id}` (Mitgliederliste je Fraktion) gemappt werden |
| Feld "Inquiries" (Anzahl?) | Personenseite enthält die **komplette Vorstoss-Tabelle** mit Titel, Typ, Datum, Nummer, Rolle (Erst-/Mitunterzeichner) | Als strukturierte Liste speichern, nicht nur als Zahl — kostet nichts extra und ist die Basis für Phase 2 |
| Feld "Links of Interest" | Unspezifisch | Weglassen bzw. auf die kanonische Profil-URL reduzieren |
| Feld "Start Date" | Es gibt **zwei** Werte: erster Eintritt jemals (`_mandatPersonFirstDatumVon`) und Beginn des aktuellen Mandats (`_mandatPersonDatumVon`) | Beide speichern; "Amtsdauer" muss definiert werden (Vorschlag: erster Eintritt, kumuliert) |
| "Alle Mitglieder" | Die Liste enthält **auch alle ehemaligen** Mitglieder (seit 1990er) | Nach aktivem Mandat filtern (`_funktionAktiv` gesetzt bzw. `datumBis` leer). Erwartetes Ergebnis: **60 aktive Mitglieder** — das ist die Plausibilitätsprüfung |

### Verifizierte Feldquellen

**Listenseite** `https://parlament.winterthur.ch/stadtparlament/27428`
→ Tabelle `id="icmsTable-personList"`, Attribut `data-entities` (JSON):
`wahlkreis`, `_nameVorname` (enthält `/_rte/person/{id}`), `_funktionAktiv`, `_partei`
(enthält `/_rte/partei/{id}` + Klartext `Sozialdemokratische Partei (SP)`),
`_mandatPersonFirstDatumVon`, `_mandatPersonDatumVon`, `_mandatPersonDatumBis`, `_kontakt`,
`_taetigInAktiv` / `_taetigInAlle` (Kommissionen als `/_rte/behoerde/{id}` + Rolle), `_thumbnail`.

**Personenseite** `https://parlament.winterthur.ch/behoerdenmitglieder/{id}`
→ Kontakt (Vorname, Nachname, Strasse, PLZ/Ort, E-Mail), Partei, Personalien
(**Geburtsjahr**, **Beruf**), **Eintritt/Austritt**, **Stadtkreis**, sowie die Tabelle
"Politische Vorstösse" (erneut als `data-entities`-JSON mit `name`, `kategorieId`,
`geschaeftsdatum`, `nummer`, `_rolle`).

**Fraktionsseite** `https://parlament.winterthur.ch/fraktionen`
→ `data-entities` mit allen Fraktionen (`/_rte/behoerde/{id}`, `datumBis` leer = aktiv).
Je Fraktion die Mitgliederliste von `/_rte/behoerde/{id}` holen.

**Kommissionen** `https://parlament.winterthur.ch/kommissionen` — analog; alternativ direkt
aus `_taetigInAktiv` der Personenliste ableiten (bevorzugt, spart Requests).

### Vorgeschlagenes Schema `data/members.json`

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "2026-08-03T10:00:00Z",
  "source": "https://parlament.winterthur.ch",
  "legislature": "2026-2030",
  "parties":    [ { "id": "sp", "abbr": "SP", "name": "Sozialdemokratische Partei",
                    "color": "#e8001a", "order": 7, "seats": 17 } ],
  "fractions":  [ { "id": "sp", "name": "SP-Fraktion", "partyIds": ["sp"], "seats": 17 } ],
  "commissions":[ { "id": "27440", "name": "Sachkommission Bau und Betriebe",
                    "shortName": "SK BB" } ],
  "members": [
    {
      "id": "281225",
      "firstName": "Gabriela",
      "lastName": "Stritt",
      "displayName": "Gabriela Stritt",
      "email": "…",
      "address": { "street": "…", "zip": "8400", "city": "Winterthur" },
      "partyId": "sp",
      "fractionId": "sp",
      "birthYear": 1960,
      "profession": "Sozialarbeiterin FH",
      "firstEntryDate": "2015-05-01",
      "currentMandateStart": "2015-05-01",
      "district": "Mattenbach",
      "gender": "w",                 // "m" | "w" | "d" | "unbekannt"
      "genderSource": "override",    // "override" | "unknown"
      "commissions": [ { "id": "27440", "role": "Mitglied" } ],
      "inquiries": [ { "id": "2830231", "title": "…", "type": "Schriftliche Anfrage",
                       "number": "2026.29", "date": "2026-04-13",
                       "role": "Erstunterzeichner/-in" } ],
      "inquiryCounts": { "total": 42, "first": 12, "co": 30 },
      "profileUrl": "https://parlament.winterthur.ch/behoerdenmitglieder/281225",
      "photoUrl": null
    }
  ]
}
```

**Bewusste Abweichungen vom README:**
Namen aufgeteilt in `firstName`/`lastName`; Adresse strukturiert statt als Freitext;
Partei/Fraktion/Kommission als **normalisierte IDs** mit eigenen Stammdaten-Listen
(statt Strings am Mitglied) — nötig für Mehrheitsrechner (Reihenfolge links↔rechts, Farben)
und um Tippfehler/Umbenennungen zu überstehen. Vorstösse als Liste **plus** vorberechnete
Zähler, damit die Statistik-Seite nicht rechnen muss.

> Der Agent darf dieses Schema anpassen, **muss** Abweichungen aber im README begründen.

---

## Zielstruktur des Repos

```
/
├─ index.html                     Landing Page (Kacheln + Mehrheitsrechner-Widget)
├─ impressum.html                 Impressum / Datenquellen / Haftungsausschluss
├─ tools/
│  ├─ sitzplan.html               (bestehendes Tool, ausgelagert)
│  ├─ mehrheitsrechner.html
│  ├─ statistik.html
│  └─ mitglieder.html
├─ assets/
│  ├─ css/main.css                Design-Tokens, Layout, Header/Footer, Karten, Buttons
│  ├─ css/seating.css             Sitzplan-spezifisch
│  └─ js/
│     ├─ layout.js                Header/Footer/Nav/Disclaimer injizieren (1 Quelle)
│     ├─ data.js                  Laden + Cachen von members.json, Helper/Selektoren
│     ├─ parties.js               Partei-Reihenfolge (links↔rechts), Farben, Kurznamen
│     ├─ majority.js              Reine Rechenlogik Mehrheiten (ohne DOM)
│     ├─ majority-ui.js           UI, auch als Widget auf der Landing Page
│     ├─ stats.js                 Aggregationen (Alter, Geschlecht, Amtsdauer, Kreis …)
│     ├─ charts.js                Chart.js-Wrapper mit einheitlichem Theme
│     ├─ members-ui.js            Mitglieder-Tabelle, Suche, Filter, Detail
│     └─ seating.js               Sitzplan-Logik (aus index.html extrahiert)
├─ data/
│  ├─ members.json                generiert
│  ├─ gender-overrides.json       manuell gepflegt
│  ├─ party-meta.json             Farben, Reihenfolge, Kurznamen (manuell)
│  └─ seating.json                Sitzkoordinaten (aus index.html extrahiert)
├─ scripts/
│  ├─ scrape-members.mjs          Scraper (Node ≥20, nur stdlib: fetch)
│  ├─ lib/icms.mjs                data-entities-Parser, HTML-Helper, Rate-Limiting
│  └─ validate-members.mjs        Schema-/Plausibilitätsprüfung
├─ .github/workflows/
│  ├─ update-members.yml          workflow_dispatch + schedule, öffnet PR
│  └─ validate.yml                validiert data/*.json bei PRs
├─ media/
└─ README.md
```

---

## Todos

### A. Fundament

1. **`repo-scaffold`** — Ordnerstruktur `assets/`, `data/`, `scripts/`, `tools/`,
   `.github/workflows/` anlegen. `.gitignore` (node_modules, .idea) und `.nojekyll` ergänzen.
2. **`extract-shared-css`** — CSS aus `index.html` nach `assets/css/main.css` +
   `assets/css/seating.css` auslagern. Design-Tokens (`:root`) vereinheitlichen,
   Partei-Farben aus `data/party-meta.json` als CSS-Custom-Properties spiegeln.
3. **`shared-layout`** — `assets/js/layout.js`: gemeinsamer Header (Wappen + Titel),
   Navigation über alle Tools, Footer mit Disclaimer. Auf allen Seiten identisch eingebunden,
   aktiver Nav-Punkt automatisch markiert.
4. **`extract-seating-tool`** — Sitzplan aus `index.html` nach `tools/sitzplan.html` +
   `assets/js/seating.js` + `data/seating.json` verschieben. **Funktionsgleichheit prüfen:**
   Drag&Drop, Reset, JSON-Export, JSON-Import müssen unverändert funktionieren.

### B. Datenbank

5. **`review-db-design`** — Der Agent prüft den Abschnitt "Kritische Prüfung" oben gegen die
   Live-Seiten nach, passt das Schema wo nötig an und dokumentiert Abweichungen im README.
6. **`scraper-lib`** — `scripts/lib/icms.mjs`: HTTP-Fetch mit Browser-User-Agent,
   Retry + Backoff, Rate-Limit (≥300 ms zwischen Requests, sequenziell — die Seite ist ein
   öffentlicher Dienst, nicht hämmern), Extraktion und Entschärfung des
   `data-entities`-Attributs, HTML-Entity-Decoding, Link-/Text-Extraktion.
7. **`scraper-members`** — `scripts/scrape-members.mjs`:
   Liste → aktive Mitglieder filtern → Personenseiten (60 Requests) → Fraktionen →
   Normalisierung → `data/members.json` schreiben (stabil sortiert, deterministisch,
   damit Diffs lesbar bleiben). `--dry-run`-Flag.
8. **`gender-overrides`** — `data/gender-overrides.json` anlegen und für die aktuellen
   60 Mitglieder befüllen; Scraper mergt sie ein und setzt sonst `unbekannt`.
9. **`party-meta`** — `data/party-meta.json` mit Reihenfolge rechts→links
   (SVP, FDP, Mitte, GLP, EDU, EVP, SP, Grüne, AL), Farben (aus bestehendem
   `PARTY_COLORS`) und Fraktionszuordnung (EDU+EVP, Grüne+AL).
10. **`validate-data`** — `scripts/validate-members.mjs`: prüft u.a. genau 60 aktive
    Mitglieder, Summe der Parteisitze = 60, jedes Mitglied hat Partei + Fraktion,
    Pflichtfelder vorhanden, Datumsformate ISO, keine doppelten IDs.
    Exit-Code ≠ 0 bei Fehler.
11. **`github-action-update`** — `.github/workflows/update-members.yml`:
    `workflow_dispatch` + `schedule` (wöchentlich), führt Scraper + Validierung aus und
    öffnet bei Änderungen einen **Pull Request** (kein direkter Push auf `main`),
    damit Änderungen sichtbar geprüft werden können.
12. **`data-loader`** — `assets/js/data.js`: lädt `members.json` einmalig (Promise-Cache),
    stellt Selektoren bereit (nach Partei/Fraktion/Kommission gruppieren, Alter berechnen,
    Amtsdauer berechnen). Fehler-/Ladezustände sauber behandeln.

### C. Tools

13. **`majority-core`** — `assets/js/majority.js`, reine Logik ohne DOM:
    Eingabe = Stimmverhalten je Gruppe (Ja / Nein / Enthaltung / frei) + Absenzen je Gruppe.
    Ausgabe = Ja/Nein/Enthaltung/Anwesend/Total, benötigtes Mehr, Ergebnis.
    Zusätzlich: **minimale Gewinn-Koalitionen** (alle minimalen Parteikombinationen, die das
    erforderliche Mehr erreichen — bei 9 Parteien sind 2^9 Kombinationen trivial berechenbar).
    Konfigurierbare Mehrheitsart: einfaches Mehr der Stimmenden (Default), absolutes Mehr (31),
    Zweidrittelmehr. Enthaltungen wahlweise zählend/nicht zählend.
14. **`majority-ui`** — `tools/mehrheitsrechner.html` + `assets/js/majority-ui.js`:
    Umschalter Partei/Fraktion, je Gruppe Ja/Nein/Enthaltung + Absenzen-Spinner,
    Live-Balken der Stimmverteilung, Ergebnis-Badge (angenommen/abgelehnt/Patt),
    Liste der minimalen Gewinn-Koalitionen, Zurücksetzen, Permalink über URL-Parameter
    (teilbares Szenario).
15. **`majority-widget`** — Kompakte Variante desselben Moduls für die Landing Page
    (nur Partei-Modus, ohne Absenzen, mit Link "Alle Optionen →").
16. **`stats-core`** — `assets/js/stats.js`: Aggregationen je Partei / Fraktion / gesamt für
    Alter (Ø, Median, Histogramm, Jüngste/Älteste), Geschlecht (inkl. Anteil `unbekannt`),
    Amtsdauer (Ø, Verteilung, längstdienend), Stadtkreis (Verteilung), Berufe (Häufigkeiten),
    Sitzverteilung.
17. **`charts-wrapper`** — `assets/js/charts.js`: Chart.js (CDN, feste Version + SRI),
    einheitliches Theme, Partei-Farben, sinnvolle Defaults, Fallback-Text falls das CDN
    nicht erreichbar ist.
18. **`stats-ui`** — `tools/statistik.html`: Kennzahlen-Kacheln oben, darunter Diagramme;
    Umschalter gesamt / nach Partei / nach Fraktion; Hinweis-Box zur
    Geschlechts-Datenqualität; Export der Rohdaten als CSV.
19. **`members-ui`** — `tools/mitglieder.html` + `assets/js/members-ui.js`: sortierbare
    Tabelle, Volltextsuche, Filter (Partei, Fraktion, Kommission, Stadtkreis),
    Detail-Panel mit allen Feldern inkl. Vorstoss-Liste und Link aufs offizielle Profil,
    CSV-Export der gefilterten Auswahl.
20. **`landing-page`** — `index.html` neu: Intro, Tool-Kacheln (Sitzplan, Mehrheitsrechner,
    Statistik, Mitglieder) mit Icon/Kurzbeschreibung, eingebettetes Mehrheitsrechner-Widget,
    Anzeige des Datenstands (`generatedAt`), Ausblick auf geplante Tools.

### D. Rechtliches & Abschluss

21. **`disclaimer-footer`** — Footer auf **allen** Seiten (über `layout.js`):
    * "Datenquelle: [parlament.winterthur.ch](https://parlament.winterthur.ch) — Stadt Winterthur.
      Alle Angaben ohne Gewähr. Dieses Projekt ist ein privates Angebot und steht in keiner
      Verbindung zur Stadt Winterthur oder zum Parlamentsdienst."
    * "Erstellt von [Dominik Kern](https://dominik-kern.ch/)."
    * Datenstand + Link zum Repo.
22. **`impressum-page`** — `impressum.html` mit ausführlicher Fassung: Betreiber, Kontakt,
    Datenquellen (alle verwendeten URLs), Aktualisierungsintervall, Haftungsausschluss,
    Hinweis auf Personendaten aus öffentlicher Quelle und Kontaktmöglichkeit für
    Korrektur-/Löschanfragen.
23. **`readme-update`** — README aktualisieren: Projektstruktur, lokale Ausführung
    (`npx serve .` o.ä. wegen `fetch` auf `file://`), Scraper-Nutzung, Datenschema,
    Umsetzungsstand der Ideen-Liste, begründete Abweichungen vom ursprünglichen DB-Vorschlag.
24. **`verify-all`** — Abschlussprüfung: alle Seiten laden ohne Konsolenfehler, Navigation
    zwischen allen Tools funktioniert, Sitzplan verhält sich wie vorher, Mehrheitsrechner
    liefert bei bekannten Szenarien korrekte Ergebnisse (z.B. SP+Grüne+AL = 26 → abgelehnt;
    + GLP + Mitte = 38 → angenommen), Statistik zeigt 60 Mitglieder, mobile Darstellung ok,
    relative Pfade funktionieren auch unter GitHub Pages im Unterpfad
    `/winterthur-council-tools/`.

---

## Hinweise & Fallstricke

* **Relative Pfade:** Unter GitHub Pages liegt die Seite unter
  `https://<user>.github.io/winterthur-council-tools/`. Von `tools/*.html` aus muss
  `../data/members.json` geladen werden. Keine absoluten `/`-Pfade verwenden.
* **`fetch` auf `file://`** schlägt fehl — im README einen lokalen Server dokumentieren.
* **`.nojekyll`** anlegen, damit GitHub Pages keine Dateien mit Unterstrich ausblendet.
* **Encoding:** Die Quellseiten liefern UTF-8, i-web escaped JSON doppelt
  (`&quot;` → `"`, danach `\/` → `/`, `\uXXXX`). Sorgfältig dekodieren, sonst kommen
  Umlaute kaputt an (in der Recherche sichtbar: `Gr\u00fcze`).
* **Schonender Umgang mit der Quelle:** sequenzielle Requests mit Pause; der Scraper läuft
  wöchentlich, nicht stündlich.
* **Fraktion ≠ Partei:** EDU+EVP und Grüne+AL bilden je eine Fraktion. Der Mehrheitsrechner
  muss beide Sichten korrekt aus denselben Mitgliederdaten ableiten.
* **Amtsdauer:** Definition festlegen und in der UI erklären (Vorschlag: seit erstem Eintritt,
  Unterbrüche nicht abgezogen).
* **Sitzplan-Namen vs. Datenbank:** Die Namen in `INITIAL_SEATS` sind Freitext und enthalten
  Zusätze wie `(VP)` / `(Pärs.)`. In Phase 1 **nicht** zwingend mit der Mitglieder-DB
  verknüpfen; falls doch, über normalisierten Namensabgleich mit expliziter Mapping-Datei
  und Report über nicht zuordenbare Einträge.
* **Regressionsrisiko:** Der Sitzplan ist das einzige bestehende Feature — nach dem
  Auslagern gründlich testen.
