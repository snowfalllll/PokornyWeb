# Webové stránky: Rod Pokorných z Příbora (`PokornyWeb`)

Historická a archivní webová prezentace šesti generací lékárníků Pokorných z Příbora (lékárna „U Panny Marie pomocné“, zal. 1756) a hudebního skladatele a lékárníka PhMr. Václava Pokorného (1918–2011).

Web obsahuje vestavěný **vizuální redakční systém (CMS)** na adrese `/admin.html`, který umožňuje kompletní správu veškerých textů, nadpisů, časových os, fotografií, archiválií, zvukových nahrávek i interaktivního rodokmenu bez nutnosti zásahu do kódu.

---

## Struktura projektu

### Veřejné stránky
- **`index.html`** – Hlavní stránka (*Úvod*): rozcestník со 4 kartami, přehledová časová osa lékárny, tmavá sekce PhMr. Václava Pokorného s hudebním přehrávačem a kolážový multimediální archiv.
- **`rodokmen.html`** – Interaktivní rodokmen (*1.–9. generace*) na nekonečném plátně s posouváním (drag & edge-panning), přibližováním a detailními medailonky osobností.
- **`historie-lekarny.html`** – Podstránka dějin lékárny „U Panny Marie pomocné“ s rozklikávací časovou osou, posloupností 6 generací lékárníků, větví rodiny Brožíkových z Plzně a tematickým archivem.
- **`vaclav-pokorny.html`** – Podstránka PhMr. Václava Pokorného s životopisným úvodem, zarámovanými rozklikávacími fotografiemi (režim rozděleného okna s popisem i režim čisté fotogalerie), časovou osou života a hudebním archivem.

### Redakční systém (CMS) a data
- **`admin.html`** – Vizuální administrace (CMS) v češtině pro správce webu.
- **`css/admin.css`** & **`js/admin.js`** – Styly a logika redakčního systému.
- **`data/content.js`** – Hlavní datový soubor (`SITE_DATA`), do kterého CMS automaticky ukládá veškeré texty, časové osy, rodokmen, audio stopy a položky archivu.
- **`data/backups/`** – Složka s automatickými časovanými zálohami (vytváří se při každém uložení v CMS).
- **`uploads/`** – Složka pro soubory nahrané přes CMS (fotografie, PDF dokumenty, MP3/WAV/OGG nahrávky).
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

## Přihlášení a práce v CMS (`/admin.html`)

- **Co vše lze v CMS upravovat bez programování:**
  1. **Texty a nadpisy stránek** – veškeré nadpisy, podtitulky, odstavce a obrázky karet na všech stránkách i v horní liště.
  2. **Časová osa: Lékárna** – přidávání, mazání, změna pořadí a úprava milníků lékárny včetně jejich fotokaruselů.
  3. **Václav Pokorný: Osa a fotky** – správa zarámovaných fotografií (volba umístění *Vpravo nahoře* / *Vlevo podél osy* a režimu vyskakovacího okna *Fotokarusel + text* / *Pouze fotokarusel*) a kapitol životní časové osy.
  4. **Archiv a multimédia** – přidávání a správa PDF kronik, notových záznamů, rozhlasových nahrávek a fotogalerií, přiřazení na konkrétní podstránky a volba velikosti dlaždice v koláži.
  5. **Hudební přehrávač (Úvod)** – správa skladeb v přehrávači na hlavní stránce.
  6. **Rodokmen a lékárníci** – úprava medailonků, životopisů, dat a fotografií všech osob v rodokmenu (1.–9. generace), přidávání dětí či partnerů a úprava pásu 6 generací lékárníků.
  7. **Správce souborů** – nahrávání fotografií, PDF a audio souborů z počítače přímo na server.
  8. **Zálohování** – každé kliknutí na *„💾 Uložit a publikovat změny“* automaticky vytvoří zálohu v `data/backups/`. Kdykoliv lze také stáhnout či nahrát kompletní `.json` zálohu jedním tlačítkem v horní liště.
