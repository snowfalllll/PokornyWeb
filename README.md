# Webové stránky: Rod Pokorných z Příbora

Kompletní statický web bez závislostí na externích frameworcích (čisté HTML5, CSS3 a modulární JavaScript).

## Struktura projektu
- `index.html` – Hlavní stránka rozdělená do 4 tematických sekcí + modální prohlížeč archiválií a přehrávač.
- `data/content.js` – Veškerá data, texty, časové osy, rodokmen, audio stopy a položky archivu na jednom místě.
- `css/styles.css` – Historický editoriální vzhled (pergamenový podklad, typografie Cormorant Garamond & Inter).
- `js/app.js` – Vykreslování dat, filtrování archivu, prohlížeč dokumentů a ovládání audio přehrávače.

## Jak přidat nové fotky, kroniky a nahrávky
1. Vytvořte složky `assets/audio/` a `assets/images/`.
2. Nahrajte MP3 soubory (např. nahrávky ČS rozhlasu nebo písně ze Semaforu) do `assets/audio/` a upravte cestu `src` v souboru `data/content.js` v poli `audioTracks`.
3. Pro přidání nových naskenovaných kronik, diplomů či fotografií přidejte nový objekt do pole `archiveItems` v souboru `data/content.js`.
