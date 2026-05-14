# Bukovar — Pokladna | Historie vývoje

## V7.10 — Merch: Sklenice 105 Kč
**Soubor:** `bukovar-pokladna.html`

- Do kategorie Merch přidána položka **Sklenice** za 105 Kč

---

## V7.6 — Tržby report: sloupcový graf prodeje piv
**Soubor:** `bukovar-pokladna.html`

- Pod každou sekci tržeb (Dnes, Tento týden, Minulý týden, Posledních 7 dní, Tento měsíc) přidán **sloupcový graf** s 8 sloupci (jeden per druh piva), seřazeno dle celkového prodeje
- Sloupce dvojbarevné: tmavá = čepované, světlá = PET. Barvy dle víček (zelená, hnědá, šedá, zlatá, žlutá, oranžová, modrá, tmavě zelená)
- Litry zobrazeny uvnitř segmentů (pokud se vejdou), pod osou jméno piva + celkový součet
- **Radler a Pivo s sebou do džbánku 2l/5l**: do účtenky se nově ukládá popisek (vybrané pivo), takže se přiřadí do správného sloupce. Staré účtenky bez popisku spadnou jen do celkového souhrnu vpravo.
- **Bugfix:** Radler obsahuje 0,2 l piva (nikoliv 0,4 l) — opraveno v součtu čepovaných litrů

## V7.6 — Tržby report: Minulý týden, Posledních 7 dní, pivo v litrech
**Soubor:** `bukovar-pokladna.html`

- Přidány dvě nové sekce v Administraci → Tržby: **Minulý týden** (po–ne minulého týdne) a **Posledních 7 dní** (dnes − 6 dní → dnes)
- V každé sekci tržeb nově vpravo přehled prodaného piva v litrech, členěno na **Čepované** (8 piv × 0,4 l + Radler + džbánky 2 l/5 l) a **PET** (8 piv „v PET" × 1 l)
- Sekce dostala 2sloupcový layout: vlevo rozpad plateb, vpravo pivo

---

## V5 — Auto-rozpoznání, kategorie, potvrzení nejistých položek
**Soubor:** `bukovar-pokladna-V5.html`

- Po vyfocení se AI rozpoznávání spustí **automaticky** (bez dalšího kliknutí)
- Tlačítko **Znovu nafotit** přidáno přímo v účtence
- Rychlé přidání strukturováno **podle kategorií** — kliknutí na kategorii rozbalí položky s cenou
- Nejisté položky jdou přes **potvrzovací krok** — vidíš originál z lístku, návrh AI, upravíš a potvrdíš nebo zahodíš
- **Náhled před tiskem** — modal se souhrnem, teprve pak tisk
- **Zvukový signál** po dokončení rozpoznávání (Web Audio API)
- Aktualizovaný AI prompt — rozlišuje `polozky` (jisté), `nejiste` (k potvrzení), `nerozpoznano`
- AbortController — přerušení fetch při kliknutí na Znovu vyfotit

---

## V4 — Opravy bugů + rychlostní vylepšení
**Soubor:** `bukovar-pokladna-V4.html`

### Opravy bugů
- Záporné množství blokováno — minimum je 1
- Enter naviguje mezi poli: qty → název → cena → přidat
- Varování při prázdné ceně (červeně pod řádkem)
- Živý náhled součtu při psaní (např. `2 × 49 Kč = 98 Kč`)

### Nové funkce
- Kamera se spustí automaticky po načtení stránky
- Autocomplete z menu — stačí napsat část názvu, kliknout → vyplní název i cenu (šipky ↑↓ + Enter)
- +/− tlačítka u každé položky v účtence
- Auto-focus na pole název po přidání položky
- Rychlá tlačítka pro nejčastější položky: Bukovar z tanku, Kohoutí 12°, Chipsy, Točená kofola 0,5l, Mojito, Aperol Spritz
- Tlačítko **Zadat ručně** — přeskočí kameru

---

## V3 — Persistence API klíče + aktuální model
**Soubor:** `bukovar-pokladna-V3.html`

- API klíč se ukládá do `localStorage` — po zadání se načte automaticky při dalším otevření
- Model aktualizován na `claude-sonnet-4-6`

---

## V2 — Základ aplikace
**Soubor:** `bukovar-pokladna-V2.html`

- Kamera + foto objednávky
- AI rozpoznávání přes Anthropic API (Claude)
- Mapování na menu Bukovaru
- Editovatelná účtenka (množství, název, mazání)
- Ruční přidání položky
- Tisk účtenky

---

## V1 — První verze
**Soubor:** `bukovar-pokladna.html`

- Původní verze aplikace
