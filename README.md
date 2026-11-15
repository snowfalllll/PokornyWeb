# Webové stránky: Rod Pokorných z Příbora (`PokornyWeb`)

Historická a archivní webová prezentace šesti generací lékárníků Pokorných z Příbora (lékárna „U Panny Marie pomocné“, zal. 1756), města Příbora a hudebního skladatele a lékárníka PhMr. Václava Pokorného (1918–2011).

Web obsahuje vestavěný **vizuální redakční systém (in-place WYSIWYG CMS)** na adrese `/admin.html` (nebo přidáním `?cms=1` za libovolnou stránku), který umožňuje upravovat veškeré texty, nadpisy, časové osy, fotografie, archiválie, zvukové nahrávky i interaktivní rodokmen **přímo v živém zobrazení stránek** bez nutnosti zásahu do kódu.

---

## Struktura projektu

### Veřejné stránky
- **`index.html`** – Hlavní stránka (*Úvod*): rozcestník se 4 kartami, sekce o městě Příboře s rozklikávacími zarámovanými fotografiemi a detailním oknem, přehledová časová osa lékárny, tmavá sekce PhMr. Václava Pokorného s hudebním přehrávačem a kolážový multimediální archiv.
- **`rodokmen.html`** – Interaktivní rodokmen (*1.–9. generace*) na nekonečném plátně s posouváním (drag & edge-panning), přibližováním a detailními medailonky osobností.
- **`historie-lekarny.html`** – Podstránka dějin lékárny „U Panny Marie pomocné“ s rozklikávací časovou osou, posloupností 6 generací lékárníků, větví rodiny Brožíkových z Plzně a tematickým archivem.
- **`vaclav-pokorny.html`** – Podstránka PhMr. Václava Pokorného s životopisným úvodem, zarámovanými rozklikávacími fotografiemi (režim rozděleného okna s popisem i režim čisté fotogalerie), časovou osou života a hudebním archivem.

### Redakční systém (CMS) a data
- **`admin.html`** – Vstupní bod vizuální administrace (aktivuje režim úprav a přesměruje přímo na živý web v režimu `?cms=1`).
- **`css/admin.css`** & **`js/admin.js`** – Styly a logika in-place vizuálního editoru, flowchart editoru rodokmenu, drag-and-drop časových os, historie uložení a správce souborů se složkami.
- **`data/content.js`** – Hlavní datový soubor (`SITE_DATA`), do kterého CMS ukládá veškeré publikované texty, časové osy, rodokmen, audio stopy a položky archivu.
- **`data/draft-data.json`** – Rozpracovaná verze dat uložená přes tlačítko *„💾 Uložit rozpracované“*.
- **`data/backups/`** – Složka s automatickými pojmenovatelnými a obnovitelnými zálohami (včetně indexu `backups-index.json`).
- **`uploads/`** – Složka pro soubory a podsložky nahrané přes CMS (fotografie, PDF dokumenty, MP3/WAV/OGG nahrávky).
- **`api.php`** – Backend skript pro jakýkoliv standardní český PHP webhosting (Wedos, Forpsi, Active24, Webglobe apod.).
- **`server.js`** – Lokální Node.js server se stejnými API endpointy jako `api.php` (pro spuštění a testování na vlastním počítači bez PHP).

---

## Jak spustit web a redakční systém (CMS)

### A) Nasazení na český webhosting (Wedos, Forpsi, Active24, Webglobe...)
1. Nahrajte celý obsah této složky přes FTP/SFTP do kořenového adresáře webu (např. `www/`).
2. Ujistěte se, že složky `data/` a `uploads/` mají právo zápisu (`chmod 755` nebo `775`).
3. Veřejný web poběží ihned na `https://vase-domena.cz`.
4. Redakční systém (CMS) je dostupný na adrese **`https://vase-domena.cz/admin.html`**.

### B) Lokální spuštění na počítači (Node.js)
V kořenové složce projektu spusťte:
```bash
node server.js
```
- **Veřejný web:** `http://localhost:3000/index.html`
- **CMS Administrace:** `http://localhost:3000/admin.html`

---

## Práce ve vizuálním CMS (`/admin.html` / `?cms=1`)

1. **Přímá úprava textů na stránce** – Kliknutím na libovolný nadpis, podtitulek nebo odstavec přímo na stránce se otevře rychlý editor daného textu (s podporou automatického prolinkování jmen z rodokmenu a Markdown odkazů `[text](url)` i `[url](text)`).
2. **Interaktivní prvky (`▶ Kliknout` | `✏️ Upravit`)** – Kliknutím na interaktivní prvky (rozklikávací karty, zarámované fotografie, milníky časové osy, dlaždice archivu, stopy přehrávače, karty osob v rodokmenu) se nad prvkem zobrazí plovoucí mini-nabídka:
   - **`▶ Kliknout`** – provede běžnou akci prvku jako na veřejném webu (otevře detail, přejde na odkaz apod.).
   - **`✏️ Upravit`** – otevře editační okno se všemi parametry prvku, fotokaruselem a tlačítkem pro smazání.
3. **Drag & Drop řazení časových os** – Nad každou časovou osou se v režimu CMS zobrazuje přehledová lišta s medailonky milníků, které lze myší přetahovat a měnit tak jejich pořadí.
4. **Flowchart editor rodokmenu (`rodokmen.html?cms=1`)**:
   - Karty osob lze přetahovat a propojovat tažením myší z **dolního bodu** (rodič → dítě), **horního bodu** (dítě → rodič) nebo **bočního bodu `⚭`** (partner / manžel).
   - Tlačítko **`✨ Uspořádat strom`** v pravém horním rohu (a automaticky také při přepnutí na veřejný web či publikování) srovná generace a přizpůsobí velikost plátna všem kartám.
5. **Správce souborů se složkami a přímým nahráváním (`📁 Soubory a složky`)**:
   - Umožňuje vytvářet podsložky (přímo odrážené na disku ve složce `uploads/`), přesouvat soubory mezi složkami a nahrávat nové soubory.
   - Při výběru souboru do libovolného prvku je přímo v okně výběru k dispozici tlačítko **`⬆️ Nahrát soubory sem`** i možnost vytvoření nové složky, takže není nutné okno opouštět.
6. **Historie uložení (`🕒 Historie uložení`) a kontrola neuložených změn**:
   - Každé uložení konceptu i publikování vytvoří na serveru zálohu, kterou lze v okně *Historie uložení* pojmenovat, obnovit nebo stáhnout/nahrát jako `.json`.
   - Při pokusu o opuštění stránky s neuloženými změnami web upozorní na neuložené úpravy a zobrazí přesný čas od posledního uložení.
