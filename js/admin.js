/**
 * Pokorní z Příbora — Visual CMS Logic (js/admin.js)
 * Works seamlessly with both `api.php` (Czech PHP webhosting) and `server.js` (Node.js local server).
 */

let cmsData = null;
let serverFiles = [];
let csrfToken = '';
let activeTab = 'pages';
let activePageSubtab = 'home';
let activeVaclavSubtab = 'photos';
let activeTreeSubtab = 'members';
let selectedPersonId = 'vaclav-6';
let archiveFilterCategory = 'all';
let isDirty = false;
let hasUnpublishedDraft = false;
let currentFilePickerCallback = null;
let currentFilePickerFilter = null; // 'image' | 'pdf' | 'audio' | null

document.addEventListener('DOMContentLoaded', () => {
  cmsData = JSON.parse(JSON.stringify(typeof SITE_DATA !== 'undefined' ? SITE_DATA : {}));
  ensureDataDefaults();
  initAuthAndStatus();
  wireGlobalControls();
});

function ensureDataDefaults() {
  if (!cmsData.pageText) cmsData.pageText = { global: {}, home: {}, lekarna: {}, vaclav: {} };
  if (!cmsData.pageText.global) cmsData.pageText.global = {};
  if (!cmsData.pageText.home) cmsData.pageText.home = {};
  if (!cmsData.pageText.lekarna) cmsData.pageText.lekarna = {};
  if (!cmsData.pageText.vaclav) cmsData.pageText.vaclav = {};
  if (!Array.isArray(cmsData.pharmacyTimeline)) cmsData.pharmacyTimeline = [];
  if (!Array.isArray(cmsData.vaclavTimeline)) cmsData.vaclavTimeline = [];
  if (!Array.isArray(cmsData.vaclavInteractivePhotos)) cmsData.vaclavInteractivePhotos = [];
  if (!Array.isArray(cmsData.archiveItems)) cmsData.archiveItems = [];
  if (!Array.isArray(cmsData.audioTracks)) cmsData.audioTracks = [];
  if (!Array.isArray(cmsData.personLinks)) cmsData.personLinks = [];
  if (!cmsData.familyTree) cmsData.familyTree = { treeRoot: {}, pharmacistsLine: [], brozikConnection: {} };
}

function markDirty(state = true, draftSaved = hasUnpublishedDraft) {
  isDirty = state;
  hasUnpublishedDraft = draftSaved;
  // Sync current working draft to localStorage so Live Preview tab always reflects latest edits
  try {
    localStorage.setItem('pokorny_cms_draft_data', JSON.stringify(cmsData));
  } catch (e) {}

  const pill = document.getElementById('cms-dirty-indicator');
  if (!pill) return;
  if (isDirty) {
    pill.textContent = '● Neuložené úpravy (uložte rozpracované nebo publikujte)';
    pill.className = 'cms-status-pill dirty';
  } else if (hasUnpublishedDraft) {
    pill.textContent = '📝 Uloženo jako koncept (zatím nepublikováno na web)';
    pill.className = 'cms-status-pill dirty';
  } else {
    pill.textContent = '✓ Publikováno naživo';
    pill.className = 'cms-status-pill saved';
  }
}

function showToast(msg) {
  const toast = document.getElementById('cms-toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toast.hidden = true;
  }, 3600);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ==========================================================================
// Authentication & Server Status
// ==========================================================================
async function initAuthAndStatus() {
  try {
    const res = await fetch('api.php?action=status');
    const data = await res.json();
    if (data && data.authenticated) {
      serverFiles = data.files || [];
      csrfToken = data.csrfToken || '';
      if (data.hasDraft && data.draftData) {
        cmsData = data.draftData;
        ensureDataDefaults();
        markDirty(false, true);
        showToast('Načteny vaše dříve uložené rozpracované úpravy.');
      }
      showCmsApp();
    } else {
      showLoginScreen();
    }
  } catch (err) {
    // Fallback if opened via file:// protocol without server running
    showLoginScreen('Upozornění: Pro přímé ukládání na disk spusťte server (node server.js) nebo otevřete administraci na webhostingu. Přesto si můžete úpravy vyzkoušet a exportovat jako zálohu.');
  }
}

function showLoginScreen(notice) {
  document.getElementById('cms-login-screen').hidden = false;
  document.getElementById('cms-app').hidden = true;
  if (notice) {
    const errEl = document.getElementById('cms-login-error');
    errEl.textContent = notice;
    errEl.hidden = false;
  }
}

function showCmsApp() {
  document.getElementById('cms-login-screen').hidden = true;
  document.getElementById('cms-app').hidden = false;
  renderActiveTab();
}

function wireGlobalControls() {
  // Login Form
  document.getElementById('cms-login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pwd = document.getElementById('cms-password-input').value;
    const errEl = document.getElementById('cms-login-error');
    errEl.hidden = true;

    try {
      const res = await fetch('api.php?action=login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd })
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        serverFiles = data.files || [];
        csrfToken = data.csrfToken || '';
        if (data.hasDraft && data.draftData) {
          cmsData = data.draftData;
          ensureDataDefaults();
          markDirty(false, true);
        }
        showCmsApp();
        showToast(data.hasDraft ? 'Přihlášeno — načten rozpracovaný koncept.' : 'Přihlášení proběhlo úspěšně.');
      } else {
        errEl.textContent = data.error || 'Nesprávné heslo.';
        errEl.hidden = false;
      }
    } catch (err) {
      // Offline preview fallback if password matches default
      if (pwd === 'pribor1756') {
        showCmsApp();
        showToast('Offline režim: Změny můžete uložit pomocí tlačítka Stáhnout zálohu.');
      } else {
        errEl.textContent = 'Server není dostupný (spusťte node server.js nebo nahrajte na PHP hosting).';
        errEl.hidden = false;
      }
    }
  });

  // Logout
  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    try { await fetch('api.php?action=logout'); } catch (e) {}
    showLoginScreen();
  });

  // Save Draft (without publishing live) & Publish Live
  document.getElementById('btn-save-draft')?.addEventListener('click', saveDraftToServer);
  document.getElementById('btn-publish-live')?.addEventListener('click', publishChangesLiveToServer);

  // Open Live Preview in a New Tab
  document.getElementById('btn-preview-changes')?.addEventListener('click', openPreviewInNewTab);

  // Ensure clicking "Veřejný web" clears preview session flag so the user sees the real published version
  document.getElementById('link-live-site')?.addEventListener('click', () => {
    sessionStorage.removeItem('pokorny_cms_preview_active');
  });

  // Export JSON Backup
  document.getElementById('btn-export-json')?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(cmsData, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pokorni-web-zaloha-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    showToast('Záloha byla stažena do vašeho počítače.');
  });

  // Import JSON Backup
  document.getElementById('input-import-json')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (parsed && (parsed.pharmacyTimeline || parsed.familyTree)) {
          cmsData = parsed;
          ensureDataDefaults();
          markDirty(true);
          renderActiveTab();
          showToast('Záloha byla načtena. Nezapomeňte kliknout na „Uložit a publikovat změny“.');
        } else {
          alert('Soubor neobsahuje platná data webu Pokorní z Příbora.');
        }
      } catch (err) {
        alert('Chyba při čtení JSON souboru: ' + err.message);
      }
    };
    reader.readAsText(file);
  });

  // Sidebar Tabs
  document.querySelectorAll('.cms-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cms-nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.getAttribute('data-tab');
      renderActiveTab();
    });
  });

  // File Picker Modal
  document.getElementById('cms-file-modal-close')?.addEventListener('click', closeFilePickerModal);
  document.getElementById('cms-file-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'cms-file-modal') closeFilePickerModal();
  });
  document.getElementById('cms-modal-file-input')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadFileToServer(file, true);
    e.target.value = '';
  });

  window.addEventListener('beforeunload', (e) => {
    if (isDirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

function openPreviewInNewTab() {
  try {
    localStorage.setItem('pokorny_cms_draft_data', JSON.stringify(cmsData));
  } catch (e) {}

  // Open the page matching the currently edited tab in a new browser tab
  let targetUrl = 'index.html?cms_preview=1';
  if (activeTab === 'pharmacy-timeline' || (activeTab === 'pages' && activePageSubtab === 'lekarna')) {
    targetUrl = 'historie-lekarny.html?cms_preview=1';
  } else if (activeTab === 'vaclav-content' || (activeTab === 'pages' && activePageSubtab === 'vaclav')) {
    targetUrl = 'vaclav-pokorny.html?cms_preview=1';
  } else if (activeTab === 'tree') {
    targetUrl = 'rodokmen.html?cms_preview=1';
  }

  window.open(targetUrl, '_blank');
}

async function saveDraftToServer() {
  const btn = document.getElementById('btn-save-draft');
  const origText = btn.textContent;
  btn.textContent = '⏳ Ukládám koncept...';
  btn.disabled = true;

  try {
    localStorage.setItem('pokorny_cms_draft_data', JSON.stringify(cmsData));
  } catch (e) {}

  try {
    const res = await fetch('api.php?action=save_draft', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
      },
      body: JSON.stringify({ siteData: cmsData })
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      markDirty(false, true);
      showToast('💾 Rozpracované úpravy byly uloženy na později (veřejný web zůstává beze změny).');
    } else {
      alert('Chyba při ukládání konceptu: ' + (data.error || 'Neznámá chyba'));
    }
  } catch (err) {
    markDirty(false, true);
    showToast('💾 Koncept uložen v prohlížeči.');
  } finally {
    btn.textContent = origText;
    btn.disabled = false;
  }
}

async function publishChangesLiveToServer() {
  const btn = document.getElementById('btn-publish-live');
  const origText = btn.textContent;
  btn.textContent = '⏳ Publikuji...';
  btn.disabled = true;

  try {
    const res = await fetch('api.php?action=save', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
      },
      body: JSON.stringify({ siteData: cmsData })
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      markDirty(false, false);
      showToast('🚀 Všechny změny byly úspěšně publikovány na veřejný web!');
    } else {
      alert('Chyba při publikování: ' + (data.error || 'Neznámá chyba'));
    }
  } catch (err) {
    alert('Nepodařilo se spojit se serverem. Ujistěte se, že běží server (node server.js) nebo PHP hosting.');
  } finally {
    btn.textContent = origText;
    btn.disabled = false;
  }
}

// ==========================================================================
// Workspace Tab Router
// ==========================================================================
function renderActiveTab() {
  const ws = document.getElementById('cms-workspace');
  if (!ws) return;

  if (activeTab === 'pages') renderPagesTab(ws);
  else if (activeTab === 'pharmacy-timeline') renderPharmacyTimelineTab(ws);
  else if (activeTab === 'vaclav-content') renderVaclavContentTab(ws);
  else if (activeTab === 'archive') renderArchiveTab(ws);
  else if (activeTab === 'audio') renderAudioTab(ws);
  else if (activeTab === 'tree') renderTreeTab(ws);
  else if (activeTab === 'media') renderMediaLibraryTab(ws);
  else if (activeTab === 'settings') renderSettingsTab(ws);
}

// ==========================================================================
// TAB 1: Texty a nadpisy stránek (pageText)
// ==========================================================================
function renderPagesTab(ws) {
  ws.innerHTML = `
    <div class="cms-section-header">
      <div>
        <h2>1. Texty, nadpisy a úvodní boxy stránek</h2>
        <p>Zde můžete upravit veškeré nadpisy, podtitulky, popisky sekcí a obrázky na všech stránkách webu.</p>
      </div>
    </div>

    <div class="cms-subtabs">
      <button type="button" class="cms-subtab-btn ${activePageSubtab === 'home' ? 'active' : ''}" data-sub="home">Úvodní stránka (index.html)</button>
      <button type="button" class="cms-subtab-btn ${activePageSubtab === 'lekarna' ? 'active' : ''}" data-sub="lekarna">Historie lékárny</button>
      <button type="button" class="cms-subtab-btn ${activePageSubtab === 'vaclav' ? 'active' : ''}" data-sub="vaclav">PhMr. Václav Pokorný</button>
      <button type="button" class="cms-subtab-btn ${activePageSubtab === 'global' ? 'active' : ''}" data-sub="global">Hlavička a horní menu (všechny stránky)</button>
    </div>

    <div id="cms-pages-subcontent"></div>
  `;

  ws.querySelectorAll('.cms-subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activePageSubtab = btn.getAttribute('data-sub');
      renderPagesTab(ws);
    });
  });

  const sub = document.getElementById('cms-pages-subcontent');
  if (activePageSubtab === 'global') {
    const g = cmsData.pageText.global;
    sub.innerHTML = `
      <div class="cms-card">
        <div class="cms-card-header"><span class="cms-card-title">Horní lišta a navigace (společné pro celý web)</span></div>
        <div class="cms-grid-2">
          ${renderTextField('Hlavní název vlevo nahoře', 'global.brandTitle', g.brandTitle)}
          ${renderTextField('Podtitulek pod názvem', 'global.brandSubtitle', g.brandSubtitle)}
        </div>
        <div class="cms-grid-3">
          ${renderTextField('Odkaz 1 (Úvod)', 'global.navHome', g.navHome)}
          ${renderTextField('Odkaz 2 (Rodokmen)', 'global.navTree', g.navTree)}
          ${renderTextField('Odkaz 3 (Historie lékárny)', 'global.navPharmacy', g.navPharmacy)}
          ${renderTextField('Odkaz 4 (Václav Pokorný)', 'global.navVaclav', g.navVaclav)}
          ${renderTextField('Odkaz 5 (Archiv)', 'global.navArchive', g.navArchive)}
        </div>
      </div>
    `;
  } else if (activePageSubtab === 'home') {
    const h = cmsData.pageText.home;
    sub.innerHTML = `
      <div class="cms-card">
        <div class="cms-card-header"><span class="cms-card-title">Hlavní hlavička (Hero sekce na Úvodu)</span></div>
        ${renderTextField('Hlavní velký nadpis (H1)', 'home.heroTitle', h.heroTitle)}
        ${renderTextareaField('Úvodní odstavec pod nadpisem', 'home.heroSubtitle', h.heroSubtitle)}
      </div>

      <div class="cms-card">
        <div class="cms-card-header"><span class="cms-card-title">4 rozcestníkové karty v úvodu</span></div>
        <div class="cms-grid-2">
          <div>
            ${renderTextField('Karta 1: Nadpis (Rodokmen)', 'home.cardTreeTitle', h.cardTreeTitle)}
            ${renderTextField('Karta 1: Podtitulek', 'home.cardTreeSub', h.cardTreeSub)}
            ${renderFileField('Karta 1: Obrázek na pozadí (volitelné)', 'home.cardTreeImg', h.cardTreeImg, 'image')}
          </div>
          <div>
            ${renderTextField('Karta 2: Nadpis (Historie lékárny)', 'home.cardPharmacyTitle', h.cardPharmacyTitle)}
            ${renderTextField('Karta 2: Podtitulek', 'home.cardPharmacySub', h.cardPharmacySub)}
            ${renderFileField('Karta 2: Obrázek na pozadí (volitelné)', 'home.cardPharmacyImg', h.cardPharmacyImg, 'image')}
          </div>
          <div>
            ${renderTextField('Karta 3: Nadpis (Václav Pokorný)', 'home.cardVaclavTitle', h.cardVaclavTitle)}
            ${renderTextField('Karta 3: Podtitulek', 'home.cardVaclavSub', h.cardVaclavSub)}
            ${renderFileField('Karta 3: Obrázek na pozadí (volitelné)', 'home.cardVaclavImg', h.cardVaclavImg, 'image')}
          </div>
          <div>
            ${renderTextField('Karta 4: Nadpis (Archiv)', 'home.cardArchiveTitle', h.cardArchiveTitle)}
            ${renderTextField('Karta 4: Podtitulek', 'home.cardArchiveSub', h.cardArchiveSub)}
            ${renderFileField('Karta 4: Obrázek na pozadí (volitelné)', 'home.cardArchiveImg', h.cardArchiveImg, 'image')}
          </div>
        </div>
      </div>

      <div class="cms-card">
        <div class="cms-card-header"><span class="cms-card-title">Sekce 1: Přehled historie lékárny na Úvodu</span></div>
        <div class="cms-grid-2">
          ${renderTextField('Nadtitulek (Eyebrow)', 'home.lekarnaEyebrow', h.lekarnaEyebrow)}
          ${renderTextField('Nadpis sekce', 'home.lekarnaTitle', h.lekarnaTitle)}
        </div>
        ${renderTextareaField('Popis sekce', 'home.lekarnaDesc', h.lekarnaDesc)}
      </div>

      <div class="cms-card">
        <div class="cms-card-header"><span class="cms-card-title">Sekce 2: Tmavá sekce PhMr. Václava Pokorného a hudební panel</span></div>
        <div class="cms-grid-2">
          ${renderTextField('Nadtitulek sekce', 'home.vaclavEyebrow', h.vaclavEyebrow)}
          ${renderTextField('Nadpis sekce', 'home.vaclavTitle', h.vaclavTitle)}
        </div>
        <div class="cms-grid-2">
          ${renderFileField('Portrétní fotografie vlevo (volitelné)', 'home.vaclavPortraitImg', h.vaclavPortraitImg, 'image')}
          ${renderTextField('Popisek pod portrétem', 'home.vaclavPortraitCaption', h.vaclavPortraitCaption)}
        </div>
        ${renderTextareaField('Hlavní plovoucí text uprostřed (jména se automaticky prorežou do rodokmenu)', 'home.vaclavLeadSentence', h.vaclavLeadSentence)}
        <div class="cms-grid-3">
          ${renderTextField('Text tlačítka Více', 'home.vaclavCtaLabel', h.vaclavCtaLabel)}
          ${renderTextField('Nadpis hudebního boxu vpravo', 'home.audioTitle', h.audioTitle)}
          ${renderTextField('Podtitulek hudebního boxu', 'home.audioSubtitle', h.audioSubtitle)}
        </div>
      </div>

      <div class="cms-card">
        <div class="cms-card-header"><span class="cms-card-title">Sekce 3: Archiv na Úvodu</span></div>
        <div class="cms-grid-2">
          ${renderTextField('Nadtitulek archivu', 'home.archiveEyebrow', h.archiveEyebrow)}
          ${renderTextField('Nadpis archivu', 'home.archiveTitle', h.archiveTitle)}
        </div>
        ${renderTextareaField('Popis archivu', 'home.archiveDesc', h.archiveDesc)}
      </div>
    `;
  } else if (activePageSubtab === 'lekarna') {
    const l = cmsData.pageText.lekarna;
    sub.innerHTML = `
      <div class="cms-card">
        <div class="cms-card-header"><span class="cms-card-title">Úvodní hlavička podstránky Historie lékárny</span></div>
        <div class="cms-grid-2">
          ${renderTextField('Nadtitulek (Eyebrow)', 'lekarna.heroEyebrow', l.heroEyebrow)}
          ${renderTextField('Hlavní nadpis (H1)', 'lekarna.heroTitle', l.heroTitle)}
        </div>
        ${renderTextareaField('Úvodní odstavec (jména v textu se automaticky propojí s rodokmenem)', 'lekarna.heroDesc', l.heroDesc)}
      </div>

      <div class="cms-card">
        <div class="cms-card-header"><span class="cms-card-title">Nadpisy sekce: Časová osa a 6 generací lékárníků</span></div>
        <div class="cms-grid-2">
          ${renderTextField('Časová osa – Nadtitulek', 'lekarna.timelineEyebrow', l.timelineEyebrow)}
          ${renderTextField('Časová osa – Nadpis', 'lekarna.timelineTitle', l.timelineTitle)}
        </div>
        ${renderTextareaField('Časová osa – Popis', 'lekarna.timelineDesc', l.timelineDesc)}
        <hr style="border:none; border-top:1px solid #eee7da; margin: 1rem 0;" />
        <div class="cms-grid-2">
          ${renderTextField('6 generací – Nadtitulek', 'lekarna.generationsEyebrow', l.generationsEyebrow)}
          ${renderTextField('6 generací – Nadpis', 'lekarna.generationsTitle', l.generationsTitle)}
        </div>
        ${renderTextareaField('6 generací – Popis', 'lekarna.generationsDesc', l.generationsDesc)}
      </div>

      <div class="cms-card">
        <div class="cms-card-header"><span class="cms-card-title">Spodní sekce: Archiv k lékárně</span></div>
        <div class="cms-grid-2">
          ${renderTextField('Archiv – Nadtitulek', 'lekarna.archiveEyebrow', l.archiveEyebrow)}
          ${renderTextField('Archiv – Nadpis', 'lekarna.archiveTitle', l.archiveTitle)}
        </div>
        ${renderTextareaField('Archiv – Popis', 'lekarna.archiveDesc', l.archiveDesc)}
      </div>
    `;
  } else if (activePageSubtab === 'vaclav') {
    const v = cmsData.pageText.vaclav;
    sub.innerHTML = `
      <div class="cms-card">
        <div class="cms-card-header"><span class="cms-card-title">Hlavní životopisný úvod vlevo nahoře (PhMr. Václav Pokorný)</span></div>
        <div class="cms-grid-2">
          ${renderTextField('Nadtitulek (Eyebrow)', 'vaclav.introEyebrow', v.introEyebrow)}
          ${renderTextField('Hlavní nadpis (H1)', 'vaclav.introTitle', v.introTitle)}
        </div>
        ${renderTextareaField('1. odstavec (zvýrazněný úvodní text)', 'vaclav.introLeadParagraph', v.introLeadParagraph, true)}
        ${renderTextareaField('2. odstavec (pokračování životopisu)', 'vaclav.introSecondParagraph', v.introSecondParagraph, true)}
        ${renderTextField('Text tlačítka pro přechod do rodokmenu', 'vaclav.treeBtnLabel', v.treeBtnLabel)}
      </div>

      <div class="cms-card">
        <div class="cms-card-header"><span class="cms-card-title">Nadpisy časové osy a archivu na stránce Václava Pokorného</span></div>
        <div class="cms-grid-2">
          ${renderTextField('Časová osa – Nadtitulek', 'vaclav.timelineEyebrow', v.timelineEyebrow)}
          ${renderTextField('Časová osa – Nadpis', 'vaclav.timelineTitle', v.timelineTitle)}
        </div>
        ${renderTextareaField('Časová osa – Popis', 'vaclav.timelineDesc', v.timelineDesc)}
        <hr style="border:none; border-top:1px solid #eee7da; margin: 1rem 0;" />
        <div class="cms-grid-2">
          ${renderTextField('Archiv – Nadtitulek', 'vaclav.archiveEyebrow', v.archiveEyebrow)}
          ${renderTextField('Archiv – Nadpis', 'vaclav.archiveTitle', v.archiveTitle)}
        </div>
        ${renderTextareaField('Archiv – Popis', 'vaclav.archiveDesc', v.archiveDesc)}
      </div>
    `;
  }

  wirePageTextInputs(sub);
}

function renderTextField(label, pathKey, val) {
  return `
    <div class="cms-field">
      <label>${escapeHtml(label)}</label>
      <input type="text" class="cms-input" data-page-key="${pathKey}" value="${escapeHtml(val)}" />
    </div>
  `;
}

function renderTextareaField(label, pathKey, val, isTall = false) {
  return `
    <div class="cms-field">
      <label>${escapeHtml(label)}</label>
      <textarea class="cms-textarea ${isTall ? 'tall' : ''}" data-page-key="${pathKey}">${escapeHtml(val)}</textarea>
    </div>
  `;
}

function renderFileField(label, pathKey, val, filterType = null) {
  return `
    <div class="cms-field">
      <label>${escapeHtml(label)}</label>
      <div class="cms-input-with-btn">
        <input type="text" class="cms-input" data-page-key="${pathKey}" value="${escapeHtml(val)}" placeholder="Cesta k souboru (např. uploads/foto.jpg)" />
        <button type="button" class="cms-btn cms-btn-light cms-btn-sm" data-pick-for-page="${pathKey}" data-pick-type="${filterType || ''}">📁 Vybrat / Nahrát</button>
      </div>
    </div>
  `;
}

function wirePageTextInputs(container) {
  container.querySelectorAll('[data-page-key]').forEach(input => {
    input.addEventListener('input', () => {
      const [section, key] = input.getAttribute('data-page-key').split('.');
      cmsData.pageText[section][key] = input.value;
      markDirty(true);
    });
  });

  container.querySelectorAll('[data-pick-for-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      const pathKey = btn.getAttribute('data-pick-for-page');
      const filterType = btn.getAttribute('data-pick-type') || null;
      openFilePickerModal(filterType, (chosenPath) => {
        const [section, key] = pathKey.split('.');
        cmsData.pageText[section][key] = chosenPath;
        const input = container.querySelector(`[data-page-key="${pathKey}"]`);
        if (input) input.value = chosenPath;
        markDirty(true);
      });
    });
  });
}

// ==========================================================================
// TAB 2: Časová osa – Historie lékárny (pharmacyTimeline)
// ==========================================================================
function renderPharmacyTimelineTab(ws) {
  ws.innerHTML = `
    <div class="cms-section-header">
      <div>
        <h2>2. Časová osa – Historie lékárny</h2>
        <p>Přidávejte, mažte, přesouvejte nebo upravujte milníky historie lékárny (zobrazují se na Úvodu i na podstránce Historie lékárny).</p>
      </div>
      <button type="button" id="btn-add-pharmacy-milestone" class="cms-btn cms-btn-primary">+ Přidat nový milník</button>
    </div>
    <div id="pharmacy-timeline-editor-list"></div>
  `;

  document.getElementById('btn-add-pharmacy-milestone')?.addEventListener('click', () => {
    cmsData.pharmacyTimeline.push({
      id: 'lekarna-' + Date.now(),
      year: 'Nové období',
      title: 'Nový milník lékárny',
      person: 'Jméno osobnosti',
      personIds: [],
      description: 'Krátký popis zobrazovaný přímo v kartě na stránce...',
      longDescription: 'Podrobné vyprávění, které se otevře ve vyskakovacím okně po kliknutí na tlačítko Více.\n\nDruhý odstavec vyprávění...',
      photos: [
        { url: null, caption: 'Popisek fotografie', detail: 'Doplňující detail snímku' }
      ]
    });
    markDirty(true);
    renderPharmacyTimelineTab(ws);
    showToast('Přidán nový milník na konec časové osy.');
  });

  const listEl = document.getElementById('pharmacy-timeline-editor-list');
  renderTimelineCardsEditor(listEl, cmsData.pharmacyTimeline, 'year', true, () => renderPharmacyTimelineTab(ws));
}

// Shared Timeline Editor for Pharmacy & Václav
function renderTimelineCardsEditor(container, listArray, timeFieldKey, hasPersonField, rerenderFn) {
  container.innerHTML = listArray.map((item, idx) => `
    <div class="cms-card" data-idx="${idx}">
      <div class="cms-card-header">
        <span class="cms-card-title">${idx + 1}. ${escapeHtml(item[timeFieldKey] || '')} — ${escapeHtml(item.title || '')}</span>
        <div class="cms-card-controls">
          <button type="button" class="cms-btn cms-btn-light cms-btn-sm" data-move="-1" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''} title="Posunout výše">↑ Výše</button>
          <button type="button" class="cms-btn cms-btn-light cms-btn-sm" data-move="1" data-idx="${idx}" ${idx === listArray.length - 1 ? 'disabled' : ''} title="Posunout níže">↓ Níže</button>
          <button type="button" class="cms-btn cms-btn-danger cms-btn-sm" data-del="${idx}">🗑️ Odstranit milník</button>
        </div>
      </div>

      <div class="${hasPersonField ? 'cms-grid-3' : 'cms-grid-2'}">
        <div class="cms-field">
          <label>Období / Rok</label>
          <input type="text" class="cms-input" data-tl-field="${timeFieldKey}" data-idx="${idx}" value="${escapeHtml(item[timeFieldKey])}" />
        </div>
        <div class="cms-field">
          <label>Nadpis milníku</label>
          <input type="text" class="cms-input" data-tl-field="title" data-idx="${idx}" value="${escapeHtml(item.title)}" />
        </div>
        ${hasPersonField ? `
          <div class="cms-field">
            <label>Osobnost / Generace (podtitulek)</label>
            <input type="text" class="cms-input" data-tl-field="person" data-idx="${idx}" value="${escapeHtml(item.person || '')}" />
          </div>
        ` : ''}
      </div>

      <div class="cms-field">
        <label>Krátký popis (zobrazený přímo v boxu na stránce)</label>
        <textarea class="cms-textarea" data-tl-field="description" data-idx="${idx}">${escapeHtml(item.description)}</textarea>
      </div>

      <div class="cms-field">
        <label>Dlouhý popis ve vyskakovacím okně (odstavce oddělujte prázdným řádkem)</label>
        <textarea class="cms-textarea tall" data-tl-field="longDescription" data-idx="${idx}">${escapeHtml(item.longDescription)}</textarea>
      </div>

      ${renderPhotosSubEditorHtml(item.photos || [], `tl-${idx}`)}
    </div>
  `).join('');

  // Inputs
  container.querySelectorAll('[data-tl-field]').forEach(inp => {
    inp.addEventListener('input', () => {
      const idx = parseInt(inp.getAttribute('data-idx'), 10);
      const field = inp.getAttribute('data-tl-field');
      listArray[idx][field] = inp.value;
      markDirty(true);
    });
  });

  // Move Up / Down
  container.querySelectorAll('[data-move]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      const dir = parseInt(btn.getAttribute('data-move'), 10);
      const target = idx + dir;
      if (target < 0 || target >= listArray.length) return;
      const temp = listArray[idx];
      listArray[idx] = listArray[target];
      listArray[target] = temp;
      markDirty(true);
      rerenderFn();
    });
  });

  // Delete
  container.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-del'), 10);
      if (confirm(`Opravdu chcete odstranit milník „${listArray[idx].title}“?`)) {
        listArray.splice(idx, 1);
        markDirty(true);
        rerenderFn();
      }
    });
  });

  // Wire Photo Carousel inside each timeline item
  listArray.forEach((item, idx) => {
    if (!Array.isArray(item.photos)) item.photos = [];
    wirePhotosSubEditor(container, item.photos, `tl-${idx}`, rerenderFn);
  });
}

function renderPhotosSubEditorHtml(photos, prefix) {
  return `
    <div class="cms-photos-box" data-photos-box="${prefix}">
      <div class="cms-photos-header">
        <strong>🖼️ Fotografie v karuselu (${photos.length})</strong>
        <button type="button" class="cms-btn cms-btn-light cms-btn-sm" data-add-photo="${prefix}">+ Přidat fotografii do karuselu</button>
      </div>
      ${photos.map((p, pIdx) => `
        <div class="cms-photo-row">
          <div class="cms-photo-thumb">
            ${p.url ? `<img src="${escapeHtml(p.url)}" alt="" />` : '🖼️'}
          </div>
          <div class="cms-grid-2" style="margin-bottom:0;">
            <div>
              <label style="font-size:0.72rem; font-weight:600;">Soubor obrázku (URL)</label>
              <div class="cms-input-with-btn">
                <input type="text" class="cms-input" data-photo-prefix="${prefix}" data-photo-idx="${pIdx}" data-photo-field="url" value="${escapeHtml(p.url || '')}" placeholder="Prázdné = dobový zástupný symbol" />
                <button type="button" class="cms-btn cms-btn-light cms-btn-sm" data-pick-photo="${prefix}" data-photo-idx="${pIdx}">📁 Nahrát / Vybrat</button>
              </div>
            </div>
            <div>
              <label style="font-size:0.72rem; font-weight:600;">Popisek fotografie (Caption)</label>
              <input type="text" class="cms-input" data-photo-prefix="${prefix}" data-photo-idx="${pIdx}" data-photo-field="caption" value="${escapeHtml(p.caption || '')}" />
            </div>
          </div>
          <div style="display:flex; gap:0.3rem;">
            <button type="button" class="cms-btn cms-btn-danger cms-btn-sm" data-remove-photo="${prefix}" data-photo-idx="${pIdx}" title="Odebrat snímek">✕</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function wirePhotosSubEditor(rootContainer, photosArray, prefix, rerenderFn) {
  const box = rootContainer.querySelector(`[data-photos-box="${prefix}"]`);
  if (!box) return;

  box.querySelector(`[data-add-photo="${prefix}"]`)?.addEventListener('click', () => {
    photosArray.push({ url: '', caption: 'Nová fotografie', detail: '' });
    markDirty(true);
    rerenderFn();
  });

  box.querySelectorAll(`[data-photo-prefix="${prefix}"]`).forEach(inp => {
    inp.addEventListener('input', () => {
      const pIdx = parseInt(inp.getAttribute('data-photo-idx'), 10);
      const field = inp.getAttribute('data-photo-field');
      photosArray[pIdx][field] = inp.value.trim() === '' && field === 'url' ? null : inp.value;
      markDirty(true);
    });
  });

  box.querySelectorAll(`[data-pick-photo="${prefix}"]`).forEach(btn => {
    btn.addEventListener('click', () => {
      const pIdx = parseInt(btn.getAttribute('data-photo-idx'), 10);
      openFilePickerModal('image', (chosenPath) => {
        photosArray[pIdx].url = chosenPath;
        markDirty(true);
        rerenderFn();
      });
    });
  });

  box.querySelectorAll(`[data-remove-photo="${prefix}"]`).forEach(btn => {
    btn.addEventListener('click', () => {
      const pIdx = parseInt(btn.getAttribute('data-photo-idx'), 10);
      photosArray.splice(pIdx, 1);
      markDirty(true);
      rerenderFn();
    });
  });
}

// ==========================================================================
// TAB 3: PhMr. Václav Pokorný – Rámečky s fotografiemi & Časová osa
// ==========================================================================
function renderVaclavContentTab(ws) {
  ws.innerHTML = `
    <div class="cms-section-header">
      <div>
        <h2>3. PhMr. Václav Pokorný – Fotografie a časová osa</h2>
        <p>Spravujte zarámované rozklikávací fotografie (vpravo nahoře a vlevo podél osy) i jednotlivé kapitoly životní časové osy.</p>
      </div>
    </div>

    <div class="cms-subtabs">
      <button type="button" class="cms-subtab-btn ${activeVaclavSubtab === 'photos' ? 'active' : ''}" data-vsub="photos">🖼️ Zarámované fotografie na stránce (${cmsData.vaclavInteractivePhotos.length})</button>
      <button type="button" class="cms-subtab-btn ${activeVaclavSubtab === 'timeline' ? 'active' : ''}" data-vsub="timeline">⏳ Časová osa života (${cmsData.vaclavTimeline.length})</button>
    </div>

    <div id="vaclav-subcontent"></div>
  `;

  ws.querySelectorAll('[data-vsub]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeVaclavSubtab = btn.getAttribute('data-vsub');
      renderVaclavContentTab(ws);
    });
  });

  const sub = document.getElementById('vaclav-subcontent');
  if (activeVaclavSubtab === 'timeline') {
    sub.innerHTML = `
      <div style="display:flex; justify-content:flex-end; margin-bottom:1rem;">
        <button type="button" id="btn-add-vaclav-milestone" class="cms-btn cms-btn-primary">+ Přidat kapitolu na časovou osu</button>
      </div>
      <div id="vaclav-timeline-list"></div>
    `;
    document.getElementById('btn-add-vaclav-milestone')?.addEventListener('click', () => {
      cmsData.vaclavTimeline.push({
        id: 'vaclav-' + Date.now(),
        period: 'Nové období',
        title: 'Nová kapitola života',
        description: 'Krátký popis na stránce...',
        longDescription: 'Podrobné vyprávění v okně po kliknutí...',
        photos: [{ url: null, caption: 'Popisek fotografie' }]
      });
      markDirty(true);
      renderVaclavContentTab(ws);
    });
    renderTimelineCardsEditor(
      document.getElementById('vaclav-timeline-list'),
      cmsData.vaclavTimeline,
      'period',
      false,
      () => renderVaclavContentTab(ws)
    );
  } else {
    sub.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
        <p style="color:var(--text-secondary);">Každému rámečku můžete nastavit umístění (<strong>Vpravo nahoře vedle úvodu</strong> nebo <strong>Vlevo podél časové osy</strong>) a režim po rozkliknutí (<strong>Fotografie + text vpravo</strong> nebo <strong>Pouze fotogalerie</strong>).</p>
        <button type="button" id="btn-add-vaclav-photo" class="cms-btn cms-btn-primary">+ Přidat zarámovanou fotografii</button>
      </div>
      <div id="vaclav-photos-list"></div>
    `;

    document.getElementById('btn-add-vaclav-photo')?.addEventListener('click', () => {
      cmsData.vaclavInteractivePhotos.push({
        id: 'vp-photo-' + Date.now(),
        placement: 'timeline-left',
        mode: 'split',
        title: 'Nová zarámovaná fotografie',
        date: 'Rok / období',
        author: 'Rodinný archiv',
        caption: 'Krátký popisek pod rámečkem',
        description: 'Delší popis zobrazovaný v pravém panelu po rozkliknutí...',
        photos: [{ url: null, caption: 'Hlavní snímek' }]
      });
      markDirty(true);
      renderVaclavContentTab(ws);
    });

    const listEl = document.getElementById('vaclav-photos-list');
    listEl.innerHTML = cmsData.vaclavInteractivePhotos.map((item, idx) => `
      <div class="cms-card">
        <div class="cms-card-header">
          <span class="cms-card-title">${idx + 1}. ${escapeHtml(item.title)} (${item.placement === 'top-right' ? 'Vpravo nahoře' : 'Vlevo u osy'})</span>
          <div class="cms-card-controls">
            <button type="button" class="cms-btn cms-btn-light cms-btn-sm" data-vp-move="-1" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''}>↑</button>
            <button type="button" class="cms-btn cms-btn-light cms-btn-sm" data-vp-move="1" data-idx="${idx}" ${idx === cmsData.vaclavInteractivePhotos.length - 1 ? 'disabled' : ''}>↓</button>
            <button type="button" class="cms-btn cms-btn-danger cms-btn-sm" data-vp-del="${idx}">🗑️ Smazat rámeček</button>
          </div>
        </div>

        <div class="cms-grid-2">
          <div class="cms-field">
            <label>Umístění na stránce</label>
            <select class="cms-select" data-vp-field="placement" data-idx="${idx}">
              <option value="top-right" ${item.placement === 'top-right' ? 'selected' : ''}>Vpravo nahoře (2 větší fotky vedle hlavního textu)</option>
              <option value="timeline-left" ${item.placement === 'timeline-left' ? 'selected' : ''}>Vlevo podél časové osy</option>
            </select>
          </div>
          <div class="cms-field">
            <label>Zobrazení po rozkliknutí (typ vyskakovacího okna)</label>
            <select class="cms-select" data-vp-field="mode" data-idx="${idx}">
              <option value="split" ${item.mode === 'split' ? 'selected' : ''}>Verze 1: Fotokarusel vlevo + textový popis vpravo</option>
              <option value="carousel" ${item.mode === 'carousel' ? 'selected' : ''}>Verze 2: Pouze velký fotokarusel s krátkým popiskem</option>
            </select>
          </div>
        </div>

        <div class="cms-grid-3">
          <div class="cms-field">
            <label>Název / Titulek</label>
            <input type="text" class="cms-input" data-vp-field="title" data-idx="${idx}" value="${escapeHtml(item.title)}" />
          </div>
          <div class="cms-field">
            <label>Datum / Období</label>
            <input type="text" class="cms-input" data-vp-field="date" data-idx="${idx}" value="${escapeHtml(item.date)}" />
          </div>
          <div class="cms-field">
            <label>Autor / Zdroj</label>
            <input type="text" class="cms-input" data-vp-field="author" data-idx="${idx}" value="${escapeHtml(item.author || '')}" />
          </div>
        </div>

        <div class="cms-field">
          <label>Popisek pod rámečkem na stránce</label>
          <input type="text" class="cms-input" data-vp-field="caption" data-idx="${idx}" value="${escapeHtml(item.caption)}" />
        </div>

        <div class="cms-field">
          <label>Podrobný text v pravém panelu (pro Verzi 1 – rozdělené okno)</label>
          <textarea class="cms-textarea" data-vp-field="description" data-idx="${idx}">${escapeHtml(item.description || '')}</textarea>
        </div>

        ${renderPhotosSubEditorHtml(item.photos || [], `vp-${idx}`)}
      </div>
    `).join('');

    listEl.querySelectorAll('[data-vp-field]').forEach(inp => {
      inp.addEventListener('input', () => {
        const idx = parseInt(inp.getAttribute('data-idx'), 10);
        const f = inp.getAttribute('data-vp-field');
        cmsData.vaclavInteractivePhotos[idx][f] = inp.value;
        markDirty(true);
      });
    });

    listEl.querySelectorAll('[data-vp-move]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        const dir = parseInt(btn.getAttribute('data-vp-move'), 10);
        const target = idx + dir;
        if (target < 0 || target >= cmsData.vaclavInteractivePhotos.length) return;
        const tmp = cmsData.vaclavInteractivePhotos[idx];
        cmsData.vaclavInteractivePhotos[idx] = cmsData.vaclavInteractivePhotos[target];
        cmsData.vaclavInteractivePhotos[target] = tmp;
        markDirty(true);
        renderVaclavContentTab(ws);
      });
    });

    listEl.querySelectorAll('[data-vp-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-vp-del'), 10);
        if (confirm(`Opravdu smazat rámeček „${cmsData.vaclavInteractivePhotos[idx].title}“?`)) {
          cmsData.vaclavInteractivePhotos.splice(idx, 1);
          markDirty(true);
          renderVaclavContentTab(ws);
        }
      });
    });

    cmsData.vaclavInteractivePhotos.forEach((item, idx) => {
      if (!Array.isArray(item.photos)) item.photos = [];
      wirePhotosSubEditor(listEl, item.photos, `vp-${idx}`, () => renderVaclavContentTab(ws));
    });
  }
}

// ==========================================================================
// TAB 4: Archiv a multimédia (archiveItems)
// ==========================================================================
function renderArchiveTab(ws) {
  const filtered = archiveFilterCategory === 'all'
    ? cmsData.archiveItems.map((item, idx) => ({ item, idx }))
    : cmsData.archiveItems.map((item, idx) => ({ item, idx })).filter(x => x.item.category === archiveFilterCategory);

  ws.innerHTML = `
    <div class="cms-section-header">
      <div>
        <h2>4. Archiv a multimédia (${cmsData.archiveItems.length} položek)</h2>
        <p>Přidávejte a upravujte archivní kroniky, PDF dokumenty, notové záznamy, zvukové nahrávky a fotogalerie.</p>
      </div>
      <button type="button" id="btn-add-archive-item" class="cms-btn cms-btn-primary">+ Přidat položku do archivu</button>
    </div>

    <div class="cms-subtabs">
      <button type="button" class="cms-subtab-btn ${archiveFilterCategory === 'all' ? 'active' : ''}" data-acat="all">Vše (${cmsData.archiveItems.length})</button>
      <button type="button" class="cms-subtab-btn ${archiveFilterCategory === 'kroniky' ? 'active' : ''}" data-acat="kroniky">Kroniky</button>
      <button type="button" class="cms-subtab-btn ${archiveFilterCategory === 'dokumenty' ? 'active' : ''}" data-acat="dokumenty">Diplomy a dokumenty</button>
      <button type="button" class="cms-subtab-btn ${archiveFilterCategory === 'noty' ? 'active' : ''}" data-acat="noty">Notové záznamy</button>
      <button type="button" class="cms-subtab-btn ${archiveFilterCategory === 'hudba' ? 'active' : ''}" data-acat="hudba">Hudba a rozhlas</button>
      <button type="button" class="cms-subtab-btn ${archiveFilterCategory === 'fotografie' ? 'active' : ''}" data-acat="fotografie">Fotografie</button>
    </div>

    <div id="archive-editor-list"></div>
  `;

  ws.querySelectorAll('[data-acat]').forEach(btn => {
    btn.addEventListener('click', () => {
      archiveFilterCategory = btn.getAttribute('data-acat');
      renderArchiveTab(ws);
    });
  });

  document.getElementById('btn-add-archive-item')?.addEventListener('click', () => {
    cmsData.archiveItems.unshift({
      id: 'doc-' + Date.now(),
      category: archiveFilterCategory === 'all' ? 'fotografie' : archiveFilterCategory,
      mediaType: 'photo',
      tileSize: 'normal',
      pages: ['main', 'lekarna', 'vaclav'],
      title: 'Nová archivní položka',
      date: 'Rok / období',
      author: 'Rodinný archiv',
      description: 'Popis archivního materiálu...',
      transcription: '',
      photos: [{ url: null, caption: 'Popisek snímku' }]
    });
    markDirty(true);
    renderArchiveTab(ws);
    showToast('Přidána nová položka na začátek archivu.');
  });

  const listEl = document.getElementById('archive-editor-list');
  listEl.innerHTML = filtered.map(({ item, idx }) => {
    const pages = Array.isArray(item.pages) ? item.pages : ['main'];
    return `
      <div class="cms-card">
        <div class="cms-card-header">
          <span class="cms-card-title">${escapeHtml(item.title)} <small style="font-weight:400; color:var(--text-secondary);">(${escapeHtml(item.category)} • ${escapeHtml(item.mediaType)})</small></span>
          <div class="cms-card-controls">
            <button type="button" class="cms-btn cms-btn-light cms-btn-sm" data-arch-move="-1" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''}>↑</button>
            <button type="button" class="cms-btn cms-btn-light cms-btn-sm" data-arch-move="1" data-idx="${idx}" ${idx === cmsData.archiveItems.length - 1 ? 'disabled' : ''}>↓</button>
            <button type="button" class="cms-btn cms-btn-danger cms-btn-sm" data-arch-del="${idx}">🗑️ Smazat z archivu</button>
          </div>
        </div>

        <div class="cms-grid-3">
          <div class="cms-field">
            <label>Název položky</label>
            <input type="text" class="cms-input" data-arch-field="title" data-idx="${idx}" value="${escapeHtml(item.title)}" />
          </div>
          <div class="cms-field">
            <label>Datum / Období</label>
            <input type="text" class="cms-input" data-arch-field="date" data-idx="${idx}" value="${escapeHtml(item.date)}" />
          </div>
          <div class="cms-field">
            <label>Autor / Zdroj</label>
            <input type="text" class="cms-input" data-arch-field="author" data-idx="${idx}" value="${escapeHtml(item.author)}" />
          </div>
        </div>

        <div class="cms-grid-3">
          <div class="cms-field">
            <label>Kategorie filtru</label>
            <select class="cms-select" data-arch-field="category" data-idx="${idx}">
              <option value="kroniky" ${item.category === 'kroniky' ? 'selected' : ''}>Kroniky a knihy</option>
              <option value="dokumenty" ${item.category === 'dokumenty' ? 'selected' : ''}>Diplomy a dokumenty</option>
              <option value="noty" ${item.category === 'noty' ? 'selected' : ''}>Notové záznamy</option>
              <option value="hudba" ${item.category === 'hudba' ? 'selected' : ''}>Hudba a rozhlas</option>
              <option value="fotografie" ${item.category === 'fotografie' ? 'selected' : ''}>Fotografie</option>
            </select>
          </div>
          <div class="cms-field">
            <label>Typ média po otevření</label>
            <select class="cms-select" data-arch-type="${idx}">
              <option value="photo" ${item.mediaType === 'photo' ? 'selected' : ''}>🖼️ Fotogalerie (karusel snímků)</option>
              <option value="pdf" ${item.mediaType === 'pdf' ? 'selected' : ''}>📄 PDF Dokument / Partitura / Kronika</option>
              <option value="audio" ${item.mediaType === 'audio' ? 'selected' : ''}>🎵 Audio nahrávka (MP3 / WMA / WAV)</option>
            </select>
          </div>
          <div class="cms-field">
            <label>Velikost dlaždice v koláži</label>
            <select class="cms-select" data-arch-field="tileSize" data-idx="${idx}">
              <option value="normal" ${item.tileSize === 'normal' ? 'selected' : ''}>Normální (čtvercová)</option>
              <option value="wide" ${item.tileSize === 'wide' ? 'selected' : ''}>Široká (obdélník naležato)</option>
              <option value="tall" ${item.tileSize === 'tall' ? 'selected' : ''}>Vysoká (obdélník nastojato)</option>
              <option value="large" ${item.tileSize === 'large' ? 'selected' : ''}>Velká (zvýrazněná)</option>
            </select>
          </div>
        </div>

        <div class="cms-grid-2">
          <div class="cms-field">
            <label>Zobrazit v archivu na těchto stránkách:</label>
            <div class="cms-checkbox-row">
              <label class="cms-checkbox-label">
                <input type="checkbox" data-arch-page="main" data-idx="${idx}" ${pages.includes('main') ? 'checked' : ''} />
                Úvodní stránka
              </label>
              <label class="cms-checkbox-label">
                <input type="checkbox" data-arch-page="lekarna" data-idx="${idx}" ${pages.includes('lekarna') ? 'checked' : ''} />
                Historie lékárny
              </label>
              <label class="cms-checkbox-label">
                <input type="checkbox" data-arch-page="vaclav" data-idx="${idx}" ${pages.includes('vaclav') ? 'checked' : ''} />
                PhMr. Václav Pokorný
              </label>
            </div>
          </div>
          <div class="cms-field">
            <label>Náhledový obrázek dlaždice v koláži (volitelné)</label>
            <div class="cms-input-with-btn">
              <input type="text" class="cms-input" data-arch-field="thumbnailUrl" data-idx="${idx}" value="${escapeHtml(item.thumbnailUrl || '')}" placeholder="Cesta k obrázku (nebo se použije 1. fotka)" />
              <button type="button" class="cms-btn cms-btn-light cms-btn-sm" data-arch-pick="thumbnailUrl" data-pick-type="image" data-idx="${idx}">📁 Vybrat</button>
            </div>
          </div>
        </div>

        <div class="cms-field">
          <label>Popis archiválie (zobrazený v pravém panelu po rozkliknutí)</label>
          <textarea class="cms-textarea" data-arch-field="description" data-idx="${idx}">${escapeHtml(item.description)}</textarea>
        </div>

        ${item.mediaType === 'pdf' ? `
          <div class="cms-photos-box">
            <strong>📄 Nastavení PDF dokumentu</strong>
            <div class="cms-grid-3" style="margin-top:0.65rem;">
              <div class="cms-field">
                <label>Skutečný soubor PDF (volitelné)</label>
                <div class="cms-input-with-btn">
                  <input type="text" class="cms-input" data-arch-field="pdfUrl" data-idx="${idx}" value="${escapeHtml(item.pdfUrl || '')}" placeholder="např. uploads/kronika.pdf" />
                  <button type="button" class="cms-btn cms-btn-light cms-btn-sm" data-arch-pick="pdfUrl" data-pick-type="pdf" data-idx="${idx}">📁 Nahrát PDF</button>
                </div>
              </div>
              <div class="cms-field">
                <label>Zobrazovaný název souboru v liště</label>
                <input type="text" class="cms-input" data-arch-field="fileLabel" data-idx="${idx}" value="${escapeHtml(item.fileLabel || '')}" />
              </div>
              <div class="cms-field">
                <label>Počet stran</label>
                <input type="number" class="cms-input" data-arch-field="pageCount" data-idx="${idx}" value="${escapeHtml(item.pageCount || 1)}" />
              </div>
            </div>
            <div class="cms-field" style="margin-bottom:0;">
              <label>Ukázkový citát na listu (pokud není nahráno PDF)</label>
              <input type="text" class="cms-input" data-arch-field="transcription" data-idx="${idx}" value="${escapeHtml(item.transcription || '')}" />
            </div>
          </div>
        ` : ''}

        ${item.mediaType === 'audio' ? `
          <div class="cms-photos-box">
            <strong>🎵 Nastavení zvukové nahrávky</strong>
            <div class="cms-grid-2" style="margin-top:0.65rem;">
              <div class="cms-field" style="margin-bottom:0;">
                <label>Soubor nahrávky (MP3, WAV, OGG, WMA)</label>
                <div class="cms-input-with-btn">
                  <input type="text" class="cms-input" data-arch-field="audioSrc" data-idx="${idx}" value="${escapeHtml(item.audioSrc || '')}" />
                  <button type="button" class="cms-btn cms-btn-light cms-btn-sm" data-arch-pick="audioSrc" data-pick-type="audio" data-idx="${idx}">📁 Nahrát Audio</button>
                </div>
              </div>
              <div class="cms-field" style="margin-bottom:0;">
                <label>Délka nahrávky (např. 22:03)</label>
                <input type="text" class="cms-input" data-arch-field="duration" data-idx="${idx}" value="${escapeHtml(item.duration || '')}" />
              </div>
            </div>
          </div>
        ` : ''}

        ${item.mediaType === 'photo' ? renderPhotosSubEditorHtml(item.photos || [], `arch-${idx}`) : ''}
      </div>
    `;
  }).join('');

  // Field changes
  listEl.querySelectorAll('[data-arch-field]').forEach(inp => {
    inp.addEventListener('input', () => {
      const idx = parseInt(inp.getAttribute('data-idx'), 10);
      const field = inp.getAttribute('data-arch-field');
      cmsData.archiveItems[idx][field] = field === 'pageCount' ? parseInt(inp.value, 10) || 1 : inp.value;
      markDirty(true);
    });
  });

  // Media Type switch
  listEl.querySelectorAll('[data-arch-type]').forEach(sel => {
    sel.addEventListener('change', () => {
      const idx = parseInt(sel.getAttribute('data-arch-type'), 10);
      cmsData.archiveItems[idx].mediaType = sel.value;
      if (sel.value === 'photo' && !Array.isArray(cmsData.archiveItems[idx].photos)) {
        cmsData.archiveItems[idx].photos = [{ url: null, caption: cmsData.archiveItems[idx].title }];
      }
      markDirty(true);
      renderArchiveTab(ws);
    });
  });

  // Page Checkboxes
  listEl.querySelectorAll('[data-arch-page]').forEach(cb => {
    cb.addEventListener('change', () => {
      const idx = parseInt(cb.getAttribute('data-idx'), 10);
      const pageKey = cb.getAttribute('data-arch-page');
      const set = new Set(cmsData.archiveItems[idx].pages || []);
      if (cb.checked) set.add(pageKey);
      else set.delete(pageKey);
      cmsData.archiveItems[idx].pages = Array.from(set);
      markDirty(true);
    });
  });

  // File pickers for PDF / Audio / Thumbnail
  listEl.querySelectorAll('[data-arch-pick]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      const field = btn.getAttribute('data-arch-pick');
      const fType = btn.getAttribute('data-pick-type') || null;
      openFilePickerModal(fType, (chosenPath) => {
        cmsData.archiveItems[idx][field] = chosenPath;
        if (field === 'pdfUrl' && !cmsData.archiveItems[idx].fileLabel) {
          cmsData.archiveItems[idx].fileLabel = chosenPath.split('/').pop();
        }
        markDirty(true);
        renderArchiveTab(ws);
      });
    });
  });

  // Move / Delete
  listEl.querySelectorAll('[data-arch-move]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      const dir = parseInt(btn.getAttribute('data-arch-move'), 10);
      const target = idx + dir;
      if (target < 0 || target >= cmsData.archiveItems.length) return;
      const tmp = cmsData.archiveItems[idx];
      cmsData.archiveItems[idx] = cmsData.archiveItems[target];
      cmsData.archiveItems[target] = tmp;
      markDirty(true);
      renderArchiveTab(ws);
    });
  });

  listEl.querySelectorAll('[data-arch-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-arch-del'), 10);
      if (confirm(`Opravdu smazat archivní položku „${cmsData.archiveItems[idx].title}“?`)) {
        cmsData.archiveItems.splice(idx, 1);
        markDirty(true);
        renderArchiveTab(ws);
      }
    });
  });

  // Photo carousels inside photo archive items
  filtered.forEach(({ item, idx }) => {
    if (item.mediaType === 'photo') {
      if (!Array.isArray(item.photos)) item.photos = [];
      wirePhotosSubEditor(listEl, item.photos, `arch-${idx}`, () => renderArchiveTab(ws));
    }
  });
}

// ==========================================================================
// TAB 5: Hudební přehrávač na Úvodu (audioTracks)
// ==========================================================================
function renderAudioTab(ws) {
  ws.innerHTML = `
    <div class="cms-section-header">
      <div>
        <h2>5. Hudební a rozhlasový přehrávač na Úvodu</h2>
        <p>Spravujte skladby a rozhlasové pořady v panelu „Hudební a rozhlasový archiv“ na hlavní stránce (zobrazují se první 3 skladby).</p>
      </div>
      <button type="button" id="btn-add-track" class="cms-btn cms-btn-primary">+ Přidat nahrávku</button>
    </div>
    <div id="audio-tracks-list"></div>
  `;

  document.getElementById('btn-add-track')?.addEventListener('click', () => {
    cmsData.audioTracks.push({
      id: 'track-' + Date.now(),
      title: 'Nová zvuková nahrávka',
      subtitle: 'PhMr. Václav Pokorný',
      duration: '3:00',
      src: '',
      year: 'Rok'
    });
    markDirty(true);
    renderAudioTab(ws);
  });

  const listEl = document.getElementById('audio-tracks-list');
  listEl.innerHTML = cmsData.audioTracks.map((t, idx) => `
    <div class="cms-card">
      <div class="cms-card-header">
        <span class="cms-card-title">${idx + 1}. ${escapeHtml(t.title)}</span>
        <div class="cms-card-controls">
          <button type="button" class="cms-btn cms-btn-light cms-btn-sm" data-tr-move="-1" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="cms-btn cms-btn-light cms-btn-sm" data-tr-move="1" data-idx="${idx}" ${idx === cmsData.audioTracks.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="cms-btn cms-btn-danger cms-btn-sm" data-tr-del="${idx}">🗑️ Odebrat</button>
        </div>
      </div>

      <div class="cms-grid-2">
        <div class="cms-field">
          <label>Název skladby / pořadu</label>
          <input type="text" class="cms-input" data-tr-field="title" data-idx="${idx}" value="${escapeHtml(t.title)}" />
        </div>
        <div class="cms-field">
          <label>Podtitulek / Interpret</label>
          <input type="text" class="cms-input" data-tr-field="subtitle" data-idx="${idx}" value="${escapeHtml(t.subtitle)}" />
        </div>
      </div>

      <div class="cms-grid-3">
        <div class="cms-field">
          <label>Zvukový soubor (MP3 / WAV / WMA)</label>
          <div class="cms-input-with-btn">
            <input type="text" class="cms-input" data-tr-field="src" data-idx="${idx}" value="${escapeHtml(t.src)}" />
            <button type="button" class="cms-btn cms-btn-light cms-btn-sm" data-tr-pick="${idx}">📁 Vybrat</button>
          </div>
        </div>
        <div class="cms-field">
          <label>Rok</label>
          <input type="text" class="cms-input" data-tr-field="year" data-idx="${idx}" value="${escapeHtml(t.year)}" />
        </div>
        <div class="cms-field">
          <label>Stopáž (např. 22:03)</label>
          <input type="text" class="cms-input" data-tr-field="duration" data-idx="${idx}" value="${escapeHtml(t.duration)}" />
        </div>
      </div>
    </div>
  `).join('');

  listEl.querySelectorAll('[data-tr-field]').forEach(inp => {
    inp.addEventListener('input', () => {
      const idx = parseInt(inp.getAttribute('data-idx'), 10);
      const f = inp.getAttribute('data-tr-field');
      cmsData.audioTracks[idx][f] = inp.value;
      markDirty(true);
    });
  });

  listEl.querySelectorAll('[data-tr-pick]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-tr-pick'), 10);
      openFilePickerModal('audio', (chosenPath) => {
        cmsData.audioTracks[idx].src = chosenPath;
        markDirty(true);
        renderAudioTab(ws);
      });
    });
  });

  listEl.querySelectorAll('[data-tr-move]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      const dir = parseInt(btn.getAttribute('data-tr-move'), 10);
      const target = idx + dir;
      if (target < 0 || target >= cmsData.audioTracks.length) return;
      const tmp = cmsData.audioTracks[idx];
      cmsData.audioTracks[idx] = cmsData.audioTracks[target];
      cmsData.audioTracks[target] = tmp;
      markDirty(true);
      renderAudioTab(ws);
    });
  });

  listEl.querySelectorAll('[data-tr-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-tr-del'), 10);
      if (confirm(`Odebrat skladbu „${cmsData.audioTracks[idx].title}“?`)) {
        cmsData.audioTracks.splice(idx, 1);
        markDirty(true);
        renderAudioTab(ws);
      }
    });
  });
}

// ==========================================================================
// TAB 6: Interaktivní rodokmen a lékárníci (familyTree)
// ==========================================================================
function flattenTreeMembers(node, parentNode = null, isSpouse = false, acc = []) {
  if (!node) return acc;
  acc.push({ member: node, parentNode, isSpouse });
  if (node.spouse) {
    acc.push({ member: node.spouse, parentNode: node, isSpouse: true });
  }
  if (Array.isArray(node.children)) {
    node.children.forEach(child => flattenTreeMembers(child, node, false, acc));
  }
  return acc;
}

function renderTreeTab(ws) {
  ws.innerHTML = `
    <div class="cms-section-header">
      <div>
        <h2>6. Interaktivní rodokmen a posloupnost lékárníků</h2>
        <p>Upravujte medailonky osob v rodokmenu (jména, data, životopisy, fotografie), přidávejte potomky nebo upravte pás 6 generací lékárníků.</p>
      </div>
    </div>

    <div class="cms-subtabs">
      <button type="button" class="cms-subtab-btn ${activeTreeSubtab === 'members' ? 'active' : ''}" data-tsub="members">🌳 Osoby v rodokmenu</button>
      <button type="button" class="cms-subtab-btn ${activeTreeSubtab === 'lineage' ? 'active' : ''}" data-tsub="lineage">🏛️ Pás 6 generací lékárníků a box Brožíkových</button>
    </div>

    <div id="tree-subcontent"></div>
  `;

  ws.querySelectorAll('[data-tsub]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTreeSubtab = btn.getAttribute('data-tsub');
      renderTreeTab(ws);
    });
  });

  const sub = document.getElementById('tree-subcontent');
  if (activeTreeSubtab === 'lineage') {
    const line = cmsData.familyTree.pharmacistsLine || [];
    const brozik = cmsData.familyTree.brozikConnection || {};
    sub.innerHTML = `
      <div class="cms-card">
        <div class="cms-card-header"><span class="cms-card-title">Box: Větev Brožíkových z Plzně (na stránce Historie lékárny)</span></div>
        <div class="cms-grid-2">
          <div class="cms-field">
            <label>Nadpis boxu</label>
            <input type="text" class="cms-input" id="brozik-title" value="${escapeHtml(brozik.title || '')}" />
          </div>
          <div class="cms-field">
            <label>Jméno osobnosti (odkaz do rodokmenu)</label>
            <input type="text" class="cms-input" id="brozik-spouse" value="${escapeHtml(brozik.spouse || '')}" />
          </div>
        </div>
        <div class="cms-field">
          <label>Text popisu</label>
          <textarea class="cms-textarea" id="brozik-details">${escapeHtml(brozik.details || '')}</textarea>
        </div>
      </div>

      <div class="cms-card">
        <div class="cms-card-header"><span class="cms-card-title">Posloupnost 6 generací příborských lékárníků</span></div>
        ${line.map((node, idx) => `
          <div class="cms-grid-3" style="margin-bottom:0.75rem; padding-bottom:0.75rem; border-bottom:1px solid #f0e8da;">
            <div class="cms-field" style="margin-bottom:0;">
              <label>Generace</label>
              <input type="number" class="cms-input" data-line-field="gen" data-idx="${idx}" value="${escapeHtml(node.gen)}" />
            </div>
            <div class="cms-field" style="margin-bottom:0;">
              <label>Jméno lékárníka</label>
              <input type="text" class="cms-input" data-line-field="name" data-idx="${idx}" value="${escapeHtml(node.name)}" />
            </div>
            <div class="cms-field" style="margin-bottom:0;">
              <label>Role / Popisek</label>
              <input type="text" class="cms-input" data-line-field="role" data-idx="${idx}" value="${escapeHtml(node.role)}" />
            </div>
          </div>
        `).join('')}
      </div>
    `;

    sub.querySelector('#brozik-title')?.addEventListener('input', (e) => {
      cmsData.familyTree.brozikConnection.title = e.target.value;
      markDirty(true);
    });
    sub.querySelector('#brozik-spouse')?.addEventListener('input', (e) => {
      cmsData.familyTree.brozikConnection.spouse = e.target.value;
      markDirty(true);
    });
    sub.querySelector('#brozik-details')?.addEventListener('input', (e) => {
      cmsData.familyTree.brozikConnection.details = e.target.value;
      markDirty(true);
    });

    sub.querySelectorAll('[data-line-field]').forEach(inp => {
      inp.addEventListener('input', () => {
        const idx = parseInt(inp.getAttribute('data-idx'), 10);
        const f = inp.getAttribute('data-line-field');
        cmsData.familyTree.pharmacistsLine[idx][f] = f === 'gen' ? parseInt(inp.value, 10) || 1 : inp.value;
        markDirty(true);
      });
    });
    return;
  }

  // Tree Members Editor
  const allEntries = flattenTreeMembers(cmsData.familyTree.treeRoot);
  let activeEntry = allEntries.find(x => x.member.id === selectedPersonId) || allEntries[0];
  if (activeEntry) selectedPersonId = activeEntry.member.id;
  const p = activeEntry?.member;

  sub.innerHTML = `
    <div class="cms-tree-split">
      <div class="cms-person-list">
        <div style="padding:0.4rem 0.5rem 0.6rem; font-weight:700; font-size:0.8rem; color:var(--text-secondary);">
          Vyberte osobu k úpravě (${allEntries.length}):
        </div>
        ${allEntries.map(({ member, isSpouse }) => `
          <button type="button" class="cms-person-item ${member.id === selectedPersonId ? 'active' : ''}" data-select-person="${member.id}">
            <span>${isSpouse ? '⚭ ' : ''}${escapeHtml(member.name)}</span>
            <span class="cms-person-gen-badge">${member.gen}. gen</span>
          </button>
        `).join('')}
      </div>

      <div id="cms-person-detail-editor">
        ${p ? `
          <div class="cms-card">
            <div class="cms-card-header">
              <span class="cms-card-title">${escapeHtml(p.name)} (${p.gen}. generace)</span>
              <div class="cms-card-controls">
                ${!activeEntry.isSpouse ? `
                  <button type="button" class="cms-btn cms-btn-light cms-btn-sm" id="btn-tree-add-child">+ Přidat dítě</button>
                  ${!p.spouse ? `<button type="button" class="cms-btn cms-btn-light cms-btn-sm" id="btn-tree-add-spouse">+ Přidat manžela/manželku</button>` : ''}
                ` : ''}
                ${activeEntry.parentNode ? `
                  <button type="button" class="cms-btn cms-btn-danger cms-btn-sm" id="btn-tree-delete-person">🗑️ Odebrat osobu</button>
                ` : ''}
              </div>
            </div>

            <div class="cms-grid-3">
              <div class="cms-field">
                <label>Jméno a tituly</label>
                <input type="text" class="cms-input" data-p-field="name" value="${escapeHtml(p.name)}" />
              </div>
              <div class="cms-field">
                <label>Generace (číslo)</label>
                <input type="number" class="cms-input" data-p-field="gen" value="${escapeHtml(p.gen)}" />
              </div>
              <div class="cms-field">
                <label>Barevná větev karty</label>
                <select class="cms-select" data-p-field="branch">
                  <option value="pharmacist" ${p.branch === 'pharmacist' ? 'selected' : ''}>Zelená – Lékárnická linie</option>
                  <option value="brozik" ${p.branch === 'brozik' ? 'selected' : ''}>Zlatá – Větev Brožíkových</option>
                  <option value="family" ${p.branch === 'family' ? 'selected' : ''}>Olivová – Rodinná větev</option>
                  <option value="modern" ${p.branch === 'modern' ? 'selected' : ''}>Olivová – Nejmladší generace</option>
                </select>
              </div>
            </div>

            <div class="cms-grid-3">
              <div class="cms-field">
                <label>Role / Povolání (zobrazeno na kartě i v záhlaví okna)</label>
                <input type="text" class="cms-input" data-p-field="role" value="${escapeHtml(p.role)}" />
              </div>
              <div class="cms-field">
                <label>Datum a místo narození</label>
                <input type="text" class="cms-input" data-p-field="birthDate" value="${escapeHtml(p.birthDate || '')}" />
              </div>
              <div class="cms-field">
                <label>Datum a místo úmrtí (nebo —)</label>
                <input type="text" class="cms-input" data-p-field="deathDate" value="${escapeHtml(p.deathDate || '')}" />
              </div>
            </div>

            <div class="cms-field">
              <label>Životopis a působení (zobrazeno ve velkém poli Životopis v okně osobnosti)</label>
              <textarea class="cms-textarea tall" data-p-field="description">${escapeHtml(p.description || '')}</textarea>
            </div>

            ${renderPhotosSubEditorHtml(p.photos || [], 'person-photos')}
          </div>
        ` : ''}
      </div>
    </div>
  `;

  sub.querySelectorAll('[data-select-person]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedPersonId = btn.getAttribute('data-select-person');
      renderTreeTab(ws);
    });
  });

  if (!p) return;

  const detailEl = document.getElementById('cms-person-detail-editor');
  detailEl.querySelectorAll('[data-p-field]').forEach(inp => {
    inp.addEventListener('input', () => {
      const f = inp.getAttribute('data-p-field');
      p[f] = f === 'gen' ? parseInt(inp.value, 10) || 1 : inp.value;
      markDirty(true);
    });
  });

  if (!Array.isArray(p.photos)) p.photos = [];
  wirePhotosSubEditor(detailEl, p.photos, 'person-photos', () => renderTreeTab(ws));

  // Add Child
  document.getElementById('btn-tree-add-child')?.addEventListener('click', () => {
    if (!Array.isArray(p.children)) p.children = [];
    const newId = 'osoba-' + Date.now();
    const newGen = (parseInt(p.gen, 10) || 1) + 1;
    p.children.push({
      id: newId,
      gen: newGen,
      name: 'Nový člen rodiny',
      role: `${newGen}. gen. • Člen rodiny`,
      branch: newGen >= 8 ? 'modern' : 'family',
      birthDate: '* doplnit datum',
      deathDate: '—',
      photo: null,
      photoCaption: 'Fotografie',
      photos: [{ url: null, caption: 'Portrétní fotografie' }],
      description: 'Doplňte životopisné údaje...',
      children: []
    });
    selectedPersonId = newId;
    markDirty(true);
    renderTreeTab(ws);
    showToast('Přidán nový potomek v rodokmenu.');
  });

  // Add Spouse
  document.getElementById('btn-tree-add-spouse')?.addEventListener('click', () => {
    const newId = 'manzel-' + Date.now();
    p.spouse = {
      id: newId,
      gen: p.gen,
      name: 'Jméno manžela / manželky',
      role: 'Manžel / Manželka',
      branch: 'family',
      birthDate: '* doplnit datum',
      deathDate: '—',
      photo: null,
      photoCaption: 'Fotografie',
      photos: [{ url: null, caption: 'Portrétní fotografie' }],
      description: 'Doplňte životopisné údaje...'
    };
    selectedPersonId = newId;
    markDirty(true);
    renderTreeTab(ws);
    showToast('Přidán manželský partner.');
  });

  // Delete Person
  document.getElementById('btn-tree-delete-person')?.addEventListener('click', () => {
    if (!confirm(`Opravdu chcete z rodokmenu odebrat osobu „${p.name}“?`)) return;
    if (activeEntry.isSpouse && activeEntry.parentNode) {
      delete activeEntry.parentNode.spouse;
      selectedPersonId = activeEntry.parentNode.id;
    } else if (activeEntry.parentNode && Array.isArray(activeEntry.parentNode.children)) {
      activeEntry.parentNode.children = activeEntry.parentNode.children.filter(ch => ch.id !== p.id);
      selectedPersonId = activeEntry.parentNode.id;
    }
    markDirty(true);
    renderTreeTab(ws);
  });
}

// ==========================================================================
// TAB 7: Správce souborů (Media Library)
// ==========================================================================
function renderMediaLibraryTab(ws) {
  ws.innerHTML = `
    <div class="cms-section-header">
      <div>
        <h2>7. Správce souborů (Obrázky, PDF dokumenty, Audio)</h2>
        <p>Nahrávejte nové soubory z počítače do složky <code>uploads/</code> nebo spravujte stávající soubory na serveru.</p>
      </div>
    </div>

    <div class="cms-card">
      <div class="cms-upload-dropzone">
        <div class="cms-upload-dropzone-info">
          <strong>☁️ Nahrát nový soubor na web</strong>
          <span>Vyberte z počítače fotografii (JPG, PNG, WEBP), dokument (PDF) nebo nahrávku (MP3, WAV, OGG, WMA)</span>
        </div>
        <label class="cms-btn cms-btn-primary">
          + Nahrát soubor z počítače
          <input type="file" id="media-tab-file-input" hidden />
        </label>
      </div>
    </div>

    <div class="cms-card">
      <div class="cms-card-header">
        <span class="cms-card-title">Soubory uložené na serveru (${serverFiles.length})</span>
      </div>
      <div class="cms-file-picker-grid">
        ${serverFiles.length === 0 ? `<p style="color:var(--text-secondary);">Zatím nebyly načteny žádné soubory nebo nejste připojeni k serveru.</p>` : ''}
        ${serverFiles.map(f => renderMediaCardHtml(f, false)).join('')}
      </div>
    </div>
  `;

  document.getElementById('media-tab-file-input')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadFileToServer(file, false);
    renderMediaLibraryTab(ws);
  });

  ws.querySelectorAll('[data-copy-path]').forEach(btn => {
    btn.addEventListener('click', () => {
      const pathStr = btn.getAttribute('data-copy-path');
      navigator.clipboard?.writeText(pathStr);
      showToast(`Cesta zkopírována: ${pathStr}`);
    });
  });

  ws.querySelectorAll('[data-del-file]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const pathStr = btn.getAttribute('data-del-file');
      if (!confirm(`Opravdu smazat soubor „${pathStr}“ ze serveru?`)) return;
      try {
        const res = await fetch('api.php?action=delete_file', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken
          },
          body: JSON.stringify({ path: pathStr })
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          serverFiles = data.files || [];
          renderMediaLibraryTab(ws);
          showToast('Soubor byl smazán.');
        } else {
          alert(data.error || 'Chyba při mazání souboru.');
        }
      } catch (err) {
        alert('Chyba spojení se serverem.');
      }
    });
  });
}

function renderMediaCardHtml(f, isPickerMode) {
  const icon = f.type === 'image' ? '🖼️' : f.type === 'pdf' ? '📄' : f.type === 'audio' ? '🎵' : '📁';
  const sizeKb = Math.round((f.size || 0) / 1024);
  return `
    <div class="cms-file-card">
      <div>
        <div class="cms-file-preview">
          ${f.type === 'image' ? `<img src="${escapeHtml(f.path)}" alt="${escapeHtml(f.name)}" />` : icon}
        </div>
        <div class="cms-file-meta">
          <div class="cms-file-name">${escapeHtml(f.name)}</div>
          <div class="cms-file-sub">${escapeHtml(f.folder)}/ • ${sizeKb} KB</div>
        </div>
      </div>
      <div class="cms-file-actions">
        ${isPickerMode
          ? `<button type="button" class="cms-btn cms-btn-primary cms-btn-sm" style="width:100%;" data-choose-file="${escapeHtml(f.path)}">✓ Vybrat tento soubor</button>`
          : `
            <button type="button" class="cms-btn cms-btn-light cms-btn-sm" data-copy-path="${escapeHtml(f.path)}">📋 Kopírovat cestu</button>
            ${f.folder === 'uploads' ? `<button type="button" class="cms-btn cms-btn-danger cms-btn-sm" data-del-file="${escapeHtml(f.path)}">🗑️</button>` : ''}
          `
        }
      </div>
    </div>
  `;
}

// ==========================================================================
// Universal File Picker & Uploader Modal
// ==========================================================================
function openFilePickerModal(filterType, onSelectCallback) {
  currentFilePickerFilter = filterType;
  currentFilePickerCallback = onSelectCallback;
  const modal = document.getElementById('cms-file-modal');
  const statusEl = document.getElementById('cms-file-modal-status');
  if (statusEl) statusEl.hidden = true;
  renderFilePickerModalList();
  modal.hidden = false;
}

function closeFilePickerModal() {
  document.getElementById('cms-file-modal').hidden = true;
  currentFilePickerCallback = null;
}

function renderFilePickerModalList() {
  const listEl = document.getElementById('cms-file-modal-list');
  if (!listEl) return;
  const filtered = currentFilePickerFilter
    ? serverFiles.filter(f => f.type === currentFilePickerFilter)
    : serverFiles;

  if (filtered.length === 0) {
    listEl.innerHTML = `<p style="color:var(--text-secondary);">Žádné odpovídající soubory zatím nejsou nahrány. Nahrajte nový soubor tlačítkem výše.</p>`;
    return;
  }

  listEl.innerHTML = filtered.map(f => renderMediaCardHtml(f, true)).join('');
  listEl.querySelectorAll('[data-choose-file]').forEach(btn => {
    btn.addEventListener('click', () => {
      const pathStr = btn.getAttribute('data-choose-file');
      if (currentFilePickerCallback) currentFilePickerCallback(pathStr);
      closeFilePickerModal();
    });
  });
}

async function uploadFileToServer(file, autoSelectInModal) {
  const statusEl = document.getElementById('cms-file-modal-status');
  if (statusEl) {
    statusEl.textContent = `⏳ Nahrávám soubor ${file.name}...`;
    statusEl.hidden = false;
  }

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('api.php?action=upload', {
      method: 'POST',
      headers: {
        'X-CSRF-Token': csrfToken
      },
      body: formData
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      serverFiles = data.files || serverFiles;
      showToast(`✓ Soubor ${data.name} byl nahrán.`);
      if (autoSelectInModal && currentFilePickerCallback) {
        currentFilePickerCallback(data.path);
        closeFilePickerModal();
      } else {
        renderFilePickerModalList();
      }
    } else {
      alert('Chyba při nahrávání: ' + (data.error || 'Neznámá chyba'));
    }
  } catch (err) {
    alert('Nepodařilo se nahrát soubor. Ujistěte se, že běží server.');
  } finally {
    if (statusEl) statusEl.hidden = true;
  }
}

// ==========================================================================
// TAB 8: Nastavení a změna hesla
// ==========================================================================
function renderSettingsTab(ws) {
  ws.innerHTML = `
    <div class="cms-section-header">
      <div>
        <h2>8. Nastavení administrace a změna hesla</h2>
        <p>Zde můžete změnit přístupové heslo do redakčního systému nebo zkontrolovat informace o nasazení na webhosting.</p>
      </div>
    </div>

    <div class="cms-grid-2">
      <div class="cms-card">
        <div class="cms-card-header"><span class="cms-card-title">🔑 Změna přístupového hesla</span></div>
        <form id="cms-password-change-form">
          <div class="cms-field">
            <label>Nové heslo (minimálně 4 znaky)</label>
            <input type="password" id="new-admin-pwd" class="cms-input" required minlength="4" placeholder="Zadejte nové heslo..." />
          </div>
          <div class="cms-field">
            <label>Potvrzení nového hesla</label>
            <input type="password" id="new-admin-pwd-confirm" class="cms-input" required minlength="4" placeholder="Zopakujte nové heslo..." />
          </div>
          <button type="submit" class="cms-btn cms-btn-primary">Uložit nové heslo</button>
        </form>
      </div>

      <div class="cms-card">
        <div class="cms-card-header"><span class="cms-card-title">ℹ️ Návod pro správce a nasazení na český hosting</span></div>
        <ul style="padding-left:1.2rem; display:flex; flex-direction:column; gap:0.55rem; color:var(--text-secondary);">
          <li><strong>Adresa administrace:</strong> Kdykoliv otevřete <code>vase-domena.cz/admin.html</code>.</li>
          <li><strong>Automatické zálohy:</strong> Při každém kliknutí na <em>Uložit a publikovat změny</em> se předchozí verze automaticky uloží do složky <code>data/backups/</code>.</li>
          <li><strong>Propojení jmen s rodokmenem:</strong> Kdykoliv v textech napíšete jméno člena rodiny (např. <em>Ferdinand Pokorný</em> nebo <em>PhMr. Václav Pokorný</em>), na webu se z něj automaticky stane odkaz do interaktivního rodokmenu.</li>
          <li><strong>Nasazení na český webhosting (Wedos, Forpsi, Active24):</strong> Stačí nahrát celou složku přes FTP na jakýkoliv standardní PHP hosting – skript <code>api.php</code> se automaticky postará o ukládání i nahrávání souborů.</li>
        </ul>
      </div>
    </div>
  `;

  document.getElementById('cms-password-change-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const p1 = document.getElementById('new-admin-pwd').value;
    const p2 = document.getElementById('new-admin-pwd-confirm').value;
    if (p1 !== p2) {
      alert('Zadaná hesla se neshodují.');
      return;
    }
    try {
      const res = await fetch('api.php?action=change_password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify({ newPassword: p1 })
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        showToast('✓ Přístupové heslo bylo úspěšně změněno.');
        e.target.reset();
      } else {
        alert(data.error || 'Chyba při změně hesla.');
      }
    } catch (err) {
      alert('Nepodařilo se spojit se serverem.');
    }
  });
}
