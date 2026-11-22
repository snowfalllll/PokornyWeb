/**
 * Pokorní z Příbora — In-Place Visual WYSIWYG CMS Engine (js/admin.js)
 * Turns the live website into an interactive visual editor with:
 * - Direct click-to-edit on any text/heading/paragraph (preserving Markdown & family links)
 * - Floating "▶ Kliknout | ✏️ Upravit" popover on all interactive elements
 * - Drag-and-drop Timeline Medallion Overview Bar
 * - Flowchart-style Family Tree Editor with draggable cards, parent/child/spouse ports & auto-organize
 * - Named, restorable Save History & Unsaved Changes prompt with elapsed time since last save
 * - Folder-organized File Manager & direct file upload inside the File Picker
 */

(function () {
  const params = new URLSearchParams(window.location.search);
  if (params.get('cms') === '0') {
    sessionStorage.removeItem('pokorny_cms_mode');
    return;
  }

  const isCmsRequested = params.get('cms') === '1' || sessionStorage.getItem('pokorny_cms_mode') === '1';
  if (!isCmsRequested) return;

  sessionStorage.setItem('pokorny_cms_mode', '1');

  let csrfToken = '';
  let isAuthenticated = false;
  let isDirty = false;
  let hasUnpublishedDraft = false;
  let lastSavedTimestamp = null; // ms epoch or null
  let serverFiles = [];
  let serverFolders = ['uploads'];
  let activeUploadFolder = 'uploads';
  let serverBackups = [];
  let activePopoverCleanup = null;
  let bypassingClickElement = null;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => checkCmsStatusAndInit());
  } else {
    checkCmsStatusAndInit();
  }

  async function checkCmsStatusAndInit() {
    try {
      let data = window.__POKORNY_CMS_INIT_STATUS__;
      if (!data) {
        const res = await fetch('api.php?action=status', { credentials: 'same-origin' });
        data = await res.json();
      }
      if (data && data.authenticated) {
        csrfToken = data.csrfToken || '';
        isAuthenticated = true;
        serverFiles = data.files || [];
        serverFolders = data.folders || ['uploads'];
        serverBackups = data.backups || [];
        if (data.lastSavedAt) {
          lastSavedTimestamp = new Date(data.lastSavedAt).getTime();
        }
        if (data.hasDraft && data.draftData) {
          hasUnpublishedDraft = true;
          Object.assign(SITE_DATA, data.draftData);
          localStorage.setItem('pokorny_cms_draft_data', JSON.stringify(SITE_DATA));
        }
        activateVisualCmsMode();
      } else {
        redirectToSeparateLoginSubpage();
      }
    } catch (err) {
      redirectToSeparateLoginSubpage();
    }
  }

  function redirectToSeparateLoginSubpage() {
    sessionStorage.removeItem('pokorny_cms_mode');
    const pageName = window.location.pathname.split('/').pop() || 'index.html';
    window.location.replace(`admin.html?return=${encodeURIComponent(pageName)}`);
  }

  // ==========================================================================
  // 2. Activate Visual CMS Mode & Top Bar
  // ==========================================================================
  function activateVisualCmsMode() {
    document.body.classList.add('cms-visual-active');
    renderCmsTopBar();
    updateKeepNavLinksInCmsMode();
    setupBeforeUnloadGuard();

    window.onCmsAfterPageRender = function () {
      updateKeepNavLinksInCmsMode();
      injectTimelineDndBars();
      injectSectionAddButtons();
      markInteractableTargets();
      if (document.body.getAttribute('data-page') === 'rodokmen') {
        initTreeFlowchartEditor();
      }
    };

    if (typeof window.refreshPageView === 'function') {
      window.refreshPageView();
    } else {
      window.onCmsAfterPageRender();
    }
    setupGlobalCmsClickInterceptor();

    setInterval(updateLastSaveTimerDisplay, 15000);
  }

  function formatTimeSinceLastSave() {
    if (!lastSavedTimestamp) return 'Zatím žádné uložení v této relaci';
    const diffSec = Math.max(0, Math.floor((Date.now() - lastSavedTimestamp) / 1000));
    if (diffSec < 45) return 'před méně než minutou';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `před ${diffMin} min.`;
    const diffHours = Math.floor(diffMin / 60);
    const remMin = diffMin % 60;
    if (diffHours < 24) return `před ${diffHours} hod. ${remMin > 0 ? `${remMin} min.` : ''}`.trim();
    const diffDays = Math.floor(diffHours / 24);
    return `před ${diffDays} dny`;
  }

  function updateLastSaveTimerDisplay() {
    const timerEl = document.getElementById('cms-last-save-timer');
    if (timerEl) {
      timerEl.textContent = lastSavedTimestamp
        ? `Poslední uložení: ${formatTimeSinceLastSave()}`
        : 'Dosud neuloženo';
    }
  }

  function markDirty(state = true, draftSaved = hasUnpublishedDraft) {
    isDirty = state;
    hasUnpublishedDraft = draftSaved;
    try {
      localStorage.setItem('pokorny_cms_draft_data', JSON.stringify(SITE_DATA));
    } catch (e) {}

    const statusEl = document.getElementById('cms-save-status');
    if (statusEl) {
      if (isDirty) {
        statusEl.textContent = '● Neuložené úpravy';
        statusEl.className = 'cms-save-status dirty';
      } else if (hasUnpublishedDraft) {
        statusEl.textContent = '📝 Uloženo jako koncept';
        statusEl.className = 'cms-save-status dirty';
      } else {
        statusEl.textContent = '✓ Publikováno naživo';
        statusEl.className = 'cms-save-status saved';
      }
    }
    updateLastSaveTimerDisplay();
  }

  function renderCmsTopBar() {
    if (document.getElementById('cms-top-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'cms-top-bar';
    bar.className = 'cms-top-bar';
    bar.setAttribute('data-ui-panel', 'true');
    bar.innerHTML = `
      <div class="cms-top-left">
        <span class="cms-mode-badge">✏️ Editor webu (CMS)</span>
        <span id="cms-save-status" class="cms-save-status saved">✓ Publikováno naživo</span>
        <span id="cms-last-save-timer" class="cms-last-save-timer"></span>
      </div>
      <div class="cms-top-actions">
        <button type="button" id="cms-btn-live-view" class="cms-btn cms-btn-outline" title="Přepnout na veřejný pohled stránky">
          👁️ Veřejný web
        </button>
        <button type="button" id="cms-btn-backups" class="cms-btn cms-btn-outline" title="Zobrazit historii všech předchozích uložení a obnovit libovolnou verzi">
          🕒 Historie uložení
        </button>
        <button type="button" id="cms-btn-files" class="cms-btn cms-btn-outline" title="Správa nahraných souborů, složek v /uploads a hesla">
          📁 Soubory a složky
        </button>
        <button type="button" id="cms-btn-save-draft" class="cms-btn cms-btn-primary" title="Uložit rozpracovanou verzi a vytvořit pojmenovanou zálohu">
          💾 Uložit rozpracované
        </button>
        <button type="button" id="cms-btn-publish" class="cms-btn cms-btn-publish" title="Publikovat všechny změny na veřejný web">
          🚀 Publikovat na web
        </button>
        <button type="button" id="cms-btn-logout" class="cms-btn cms-btn-ghost" title="Odhlásit se z CMS">
          Odhlásit
        </button>
      </div>
    `;
    document.body.prepend(bar);
    markDirty(false, hasUnpublishedDraft);

    bar.querySelector('#cms-btn-live-view')?.addEventListener('click', () => {
      handleLeaveCmsOrNavigate(() => {
        sessionStorage.removeItem('pokorny_cms_mode');
        const url = new URL(window.location.href);
        url.searchParams.delete('cms');
        window.location.href = url.toString();
      });
    });

    bar.querySelector('#cms-btn-backups')?.addEventListener('click', () => {
      openSaveHistoryModal();
    });

    bar.querySelector('#cms-btn-files')?.addEventListener('click', () => {
      openFileManagerModal(null, null);
    });

    bar.querySelector('#cms-btn-save-draft')?.addEventListener('click', () => {
      promptSaveWithName('draft');
    });

    bar.querySelector('#cms-btn-publish')?.addEventListener('click', () => {
      promptSaveWithName('publish');
    });

    bar.querySelector('#cms-btn-logout')?.addEventListener('click', () => {
      handleLeaveCmsOrNavigate(async () => {
        try {
          await fetch('api.php?action=logout', { credentials: 'same-origin' });
        } catch (e) {}
        sessionStorage.removeItem('pokorny_cms_mode');
        localStorage.removeItem('pokorny_cms_draft_data');
        const pageName = window.location.pathname.split('/').pop() || 'index.html';
        window.location.href = `admin.html?return=${encodeURIComponent(pageName)}`;
      });
    });
  }

  function updateKeepNavLinksInCmsMode() {
    document.querySelectorAll('.site-header a[href]').forEach(a => {
      const rawHref = a.getAttribute('href') || '';
      if (rawHref.startsWith('#') || rawHref.startsWith('http')) return;
      const [pathPart, hashPart] = rawHref.split('#');
      const base = pathPart.split('?')[0];
      a.setAttribute('href', `${base}?cms=1${hashPart ? '#' + hashPart : ''}`);
    });
  }

  // ==========================================================================
  // 3. Unsaved Changes Guard (Browser beforeunload + Custom Modal with Time Since Last Save)
  // ==========================================================================
  function setupBeforeUnloadGuard() {
    window.addEventListener('beforeunload', (e) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = `Máte neuložené úpravy (${formatTimeSinceLastSave()}). Opravdu chcete opustit stránku?`;
        return e.returnValue;
      }
    });
  }

  function handleLeaveCmsOrNavigate(onProceedCallback) {
    if (!isDirty) {
      onProceedCallback();
      return;
    }

    const elapsedStr = lastSavedTimestamp
      ? `Od posledního uložení uplynulo: <strong>${formatTimeSinceLastSave()}</strong>`
      : 'V této relaci jste změny <strong>zatím ještě neuložili</strong>.';

    const modal = createCmsModal('Neuložené změny v editoru', `
      <p style="font-size:0.95rem; line-height:1.55;">
        Na stránce máte neuložené úpravy. Chcete je před opuštěním editoru uložit?
      </p>
      <div style="background:#f2ece1; border-left:4px solid #9e7b42; padding:0.75rem 1rem; border-radius:4px; font-size:0.88rem;">
        ⏱️ ${elapsedStr}
      </div>
    `, `
      <button type="button" class="cms-btn cms-btn-outline" style="color:#1f2421; border-color:#cbbba0;" id="unsaved-cancel">Zůstat v editoru</button>
      <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
        <button type="button" class="cms-btn cms-btn-danger" id="unsaved-discard">Odejít bez uložení</button>
        <button type="button" class="cms-btn cms-btn-primary" id="unsaved-save-draft">💾 Uložit rozpracované a odejít</button>
        <button type="button" class="cms-btn cms-btn-publish" id="unsaved-publish">🚀 Publikovat na web a odejít</button>
      </div>
    `, 'cms-modal-sm');

    modal.querySelector('#unsaved-cancel')?.addEventListener('click', () => modal.remove());
    modal.querySelector('#unsaved-discard')?.addEventListener('click', () => {
      isDirty = false;
      modal.remove();
      onProceedCallback();
    });
    modal.querySelector('#unsaved-save-draft')?.addEventListener('click', async () => {
      const ok = await executeSave('draft', '');
      if (ok) {
        modal.remove();
        onProceedCallback();
      }
    });
    modal.querySelector('#unsaved-publish')?.addEventListener('click', async () => {
      const ok = await executeSave('publish', '');
      if (ok) {
        modal.remove();
        onProceedCallback();
      }
    });
  }

  // ==========================================================================
  // 4. Saving & Named Save History / Restorable Backups Overlay
  // ==========================================================================
  function promptSaveWithName(mode = 'draft') {
    const isPublish = mode === 'publish';
    const nowStr = new Date().toLocaleString('cs-CZ', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    const defaultName = isPublish
      ? `Publikace na web (${nowStr})`
      : `Rozpracované uložení (${nowStr})`;

    const modal = createCmsModal(
      isPublish ? '🚀 Publikovat změny na veřejný web' : '💾 Uložit rozpracovanou verzi',
      `
        <p style="font-size:0.9rem; color:#5a605d;">
          ${isPublish
            ? 'Změny se okamžitě propíší na veřejný web a rodokmen se automaticky zarovná. Současně se vytvoří pojmenovaná záloha v historii uložení.'
            : 'Vaše úpravy se uloží na server a vytvoří se pojmenovaný bod obnovy v historii uložení (veřejný web zatím zůstane beze změny).'}
        </p>
        <div class="cms-field">
          <label for="cms-save-name-input">Název tohoto uložení (pro łatné rozpoznání v historii)</label>
          <input type="text" id="cms-save-name-input" class="cms-input" value="${escapeAttr(defaultName)}" />
        </div>
      `,
      `
        <button type="button" class="cms-btn cms-btn-outline" style="color:#1f2421; border-color:#cbbba0;" data-close-modal>Zrušit</button>
        <button type="button" class="cms-btn ${isPublish ? 'cms-btn-publish' : 'cms-btn-primary'}" id="cms-confirm-save-btn">
          ${isPublish ? '🚀 Potvrdit a publikovat' : '💾 Uložit verzi'}
        </button>
      `,
      'cms-modal-sm'
    );

    const input = modal.querySelector('#cms-save-name-input');
    input?.focus();
    input?.select();

    modal.querySelector('#cms-confirm-save-btn')?.addEventListener('click', async () => {
      const saveName = input.value.trim() || defaultName;
      const btn = modal.querySelector('#cms-confirm-save-btn');
      btn.disabled = true;
      btn.textContent = 'Ukládám…';
      const ok = await executeSave(mode, saveName);
      if (ok) modal.remove();
      else btn.disabled = false;
    });
  }

  async function executeSave(mode, saveName) {
    syncPersonLinksFromTree();

    const action = mode === 'publish' ? 'save' : 'save_draft';
    try {
      const res = await fetch(`api.php?action=${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          siteData: SITE_DATA,
          saveName
        })
      });
      const data = await res.json();
      if (data && data.ok) {
        lastSavedTimestamp = Date.now();
        if (Array.isArray(data.backups)) {
          serverBackups = data.backups;
        }
        if (mode === 'publish') {
          localStorage.removeItem('pokorny_cms_draft_data');
          markDirty(false, false);
          showCmsToast('✓ Změny byly úspěšně publikovány na web a zálohovány!');
          if (typeof window.refreshPageView === 'function') window.refreshPageView();
          if (window.treePanZoomApi) window.treePanZoomApi.centerTree(true);
        } else {
          markDirty(false, true);
          showCmsToast('💾 Rozpracovaná verze byla uložena do historie!');
        }
        return true;
      } else {
        alert(data?.error || 'Nepodařilo se uložit změny.');
        return false;
      }
    } catch (err) {
      alert('Chyba spojení se serverem při ukládání.');
      return false;
    }
  }

  function openSaveHistoryModal() {
    const modal = createCmsModal(
      '🕒 Historie uložení a obnovitelné zálohy',
      `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem;">
          <p style="font-size:0.88rem; color:#5a605d; margin:0;">
            Každé uložení vytvoří obnovitelnou zálohu. Libovolnou verzi můžete přejmenovat nebo jedním kliknutím obnovit.
          </p>
          <span style="font-size:0.8rem; font-weight:600; color:#9e7b42;">
            ⏱️ ${formatTimeSinceLastSave()}
          </span>
        </div>
        <div id="cms-backups-container" class="cms-backups-list"></div>
      `,
      `
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
          <button type="button" class="cms-btn cms-btn-outline" style="color:#1f2421; border-color:#cbbba0;" id="cms-export-json-btn">📦 Stáhnout .json do PC</button>
          <label class="cms-btn cms-btn-outline" style="color:#1f2421; border-color:#cbbba0; cursor:pointer;">
            📂 Nahrát .json z PC
            <input type="file" id="cms-import-json-input" accept=".json" hidden />
          </label>
        </div>
        <button type="button" class="cms-btn cms-btn-primary" data-close-modal>Zavřít historii</button>
      `
    );

    const listEl = modal.querySelector('#cms-backups-container');

    function renderBackupRows() {
      if (!serverBackups || serverBackups.length === 0) {
        listEl.innerHTML = `<div style="padding:1.5rem; text-align:center; color:#5a605d;">Zatím nejsou k dispozici žádná předchozí uložení.</div>`;
        return;
      }
      listEl.innerHTML = serverBackups.map(b => {
        const dt = new Date(b.createdAt).toLocaleString('cs-CZ');
        const badge = b.type === 'published'
          ? `<span style="background:#2c6e49; color:#fff; padding:0.15rem 0.5rem; border-radius:4px; font-size:0.7rem;">Publikováno</span>`
          : `<span style="background:#9e7b42; color:#fff; padding:0.15rem 0.5rem; border-radius:4px; font-size:0.7rem;">Koncept</span>`;
        return `
          <div class="cms-backup-row type-${b.type}" data-bkp-id="${b.id}">
            <div>
              <div class="cms-backup-title">${escapeHtml(b.name)} ${badge}</div>
              <div class="cms-backup-sub">Uloženo: ${dt}</div>
            </div>
            <div style="display:flex; gap:0.4rem; flex-wrap:wrap;">
              <button type="button" class="cms-btn cms-btn-outline" style="color:#1f2421; border-color:#cbbba0;" data-rename-bkp="${b.id}">✏️ Přejmenovat</button>
              <button type="button" class="cms-btn cms-btn-primary" data-restore-bkp="${b.id}">⏪ Obnovit tuto verzi</button>
              <button type="button" class="cms-btn cms-btn-danger" data-delete-bkp="${b.id}" title="Smazat zálohu">🗑️</button>
            </div>
          </div>
        `;
      }).join('');

      listEl.querySelectorAll('[data-rename-bkp]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-rename-bkp');
          const curr = serverBackups.find(x => x.id === id);
          const newName = prompt('Zadejte nový název pro toto uložení:', curr?.name || '');
          if (!newName || !newName.trim()) return;
          const res = await fetch('api.php?action=rename_backup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
            credentials: 'same-origin',
            body: JSON.stringify({ id, name: newName.trim() })
          });
          const data = await res.json();
          if (data?.ok) {
            serverBackups = data.backups || serverBackups;
            renderBackupRows();
            showCmsToast('Název uložení byl upraven.');
          }
        });
      });

      listEl.querySelectorAll('[data-restore-bkp]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-restore-bkp');
          const curr = serverBackups.find(x => x.id === id);
          if (!confirm(`Opravdu chcete obnovit uloženou verzi „${curr?.name || id}“?`)) return;
          const res = await fetch('api.php?action=restore_backup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
            credentials: 'same-origin',
            body: JSON.stringify({ id })
          });
          const data = await res.json();
          if (data?.ok && data.siteData) {
            Object.assign(SITE_DATA, data.siteData);
            markDirty(false, true);
            if (typeof window.refreshPageView === 'function') window.refreshPageView();
            modal.remove();
            showCmsToast(`⏪ Obnovena verze: ${curr?.name || ''}`);
          } else {
            alert(data?.error || 'Obnovení selhalo.');
          }
        });
      });

      listEl.querySelectorAll('[data-delete-bkp]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-delete-bkp');
          if (!confirm('Smazat tuto zálohu z historie?')) return;
          const res = await fetch('api.php?action=delete_backup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
            credentials: 'same-origin',
            body: JSON.stringify({ id })
          });
          const data = await res.json();
          if (data?.ok) {
            serverBackups = data.backups || [];
            renderBackupRows();
          }
        });
      });
    }

    renderBackupRows();

    modal.querySelector('#cms-export-json-btn')?.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(SITE_DATA, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `pokorny-web-zaloha-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
    });

    modal.querySelector('#cms-import-json-input')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          if (parsed && typeof parsed === 'object') {
            Object.assign(SITE_DATA, parsed);
            markDirty(true);
            if (typeof window.refreshPageView === 'function') window.refreshPageView();
            modal.remove();
            showCmsToast('📂 Záloha ze souboru byla načtena.');
          }
        } catch (err) {
          alert('Neplatný JSON soubor.');
        }
      };
      reader.readAsText(file);
    });
  }

  // ==========================================================================
  // 5. In-Place Direct Text Editing & Interactive "Kliknout | Upravit" Popover
  // ==========================================================================
  function markInteractableTargets() {
    const selectors = [
      '.site-header .brand',
      '.site-header .nav-links a',
      '.hero-img-btn',
      '#btn-pribor-more',
      '#vaclav-home-portrait',
      '.vaclav-cta-wrap a',
      '.track-item',
      '.timeline-item-compact',
      '.timeline-item-interactive',
      '.lineage-node-link',
      '#brozik-box',
      '.vaclav-framed-photo',
      '.collage-tile',
      '.tree-person-card'
    ];
    document.querySelectorAll(selectors.join(', ')).forEach(el => {
      el.classList.add('cms-interactable-target');
    });
  }

  function closeActivePopover() {
    if (activePopoverCleanup) {
      activePopoverCleanup();
      activePopoverCleanup = null;
    }
    document.querySelectorAll('.cms-action-popover').forEach(p => p.remove());
  }

  function setupGlobalCmsClickInterceptor() {
    document.addEventListener('click', (e) => {
      if (!document.body.classList.contains('cms-visual-active')) return;

      // Ignore clicks inside CMS UI panels, modals, popovers, or inline text toolbars
      if (e.target.closest('.cms-top-bar, .cms-modal-backdrop, .cms-action-popover, .cms-inline-text-toolbar, .cms-timeline-dnd-bar, .cms-add-item-btn, .cms-tree-port, .tree-couple-ring')) {
        return;
      }
      // Also ignore clicks inside the universal preview modal when opened via "Kliknout"
      if (e.target.closest('#universal-modal')) {
        return;
      }

      // Check if we are intentionally triggering the native click action from the "▶ Kliknout" popover button
      const interactable = findInteractableElement(e.target);
      if (interactable && bypassingClickElement === interactable) {
        bypassingClickElement = null;
        return;
      }

      // If user clicked an interactive element, show the "▶ Kliknout | ✏️ Upravit" popover!
      if (interactable) {
        e.preventDefault();
        e.stopPropagation();
        closeActivePopover();
        showClickOrEditPopover(interactable, e.clientX, e.clientY);
        return;
      }

      // Otherwise, check if user clicked a direct editable text element ([data-cms] or [data-cms-linkify])
      const cmsTextEl = e.target.closest('[data-cms], [data-cms-linkify]');
      if (cmsTextEl && !cmsTextEl.closest('a, button')) {
        e.preventDefault();
        e.stopPropagation();
        closeActivePopover();
        startInlineTextEditing(cmsTextEl);
        return;
      }

      closeActivePopover();
    }, true);
  }

  function findInteractableElement(target) {
    return target.closest(
      '.site-header .brand, .site-header .nav-links a, .hero-img-btn, #btn-pribor-more, #vaclav-home-portrait, .vaclav-cta-wrap a, .track-item, .timeline-item-compact, .timeline-item-interactive, .lineage-node-link, #brozik-box, .vaclav-framed-photo, .collage-tile, .tree-person-card'
    );
  }

  function startInlineTextEditing(el) {
    if (el.getAttribute('data-cms-editing') === 'true') return;

    const cmsKey = el.getAttribute('data-cms-linkify') || el.getAttribute('data-cms');
    if (!cmsKey) return;

    const rawText = el.getAttribute('data-raw-text') ?? getNestedPageText(cmsKey) ?? el.textContent;
    el.setAttribute('data-cms-editing', 'true');
    el.contentEditable = 'true';
    el.textContent = rawText;
    el.focus();

    const rect = el.getBoundingClientRect();
    const toolbar = document.createElement('div');
    toolbar.className = 'cms-inline-text-toolbar';
    toolbar.style.top = `${Math.max(60, rect.top - 42)}px`;
    toolbar.style.left = `${Math.max(16, Math.min(window.innerWidth - 380, rect.left))}px`;
    toolbar.innerHTML = `
      <span class="cms-inline-text-hint">💡 Odkaz: <code>[www.web.cz](Název)</code> • Jména rodu se prolinkují sama</span>
      <button type="button" class="cms-btn cms-btn-primary" id="inline-save-btn" style="padding:0.22rem 0.55rem;">✓ Hotovo</button>
      <button type="button" class="cms-btn cms-btn-ghost" id="inline-cancel-btn" style="padding:0.22rem 0.45rem;">✕</button>
    `;
    document.body.appendChild(toolbar);

    let finished = false;
    function finishEdit(saveChanges) {
      if (finished) return;
      finished = true;
      el.removeAttribute('data-cms-editing');
      el.contentEditable = 'false';
      toolbar.remove();

      if (saveChanges) {
        const newVal = el.innerText.trim();
        setNestedPageText(cmsKey, newVal);
        markDirty(true);
      }
      if (typeof window.refreshPageView === 'function') {
        window.refreshPageView();
      }
    }

    toolbar.querySelector('#inline-save-btn')?.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      finishEdit(true);
    });
    toolbar.querySelector('#inline-cancel-btn')?.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      finishEdit(false);
    });

    el.addEventListener('blur', () => {
      setTimeout(() => finishEdit(true), 120);
    }, { once: true });

    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        finishEdit(false);
      } else if (ev.key === 'Enter' && !ev.shiftKey && el.tagName.toLowerCase().startsWith('h')) {
        ev.preventDefault();
        finishEdit(true);
      }
    });
  }

  function showClickOrEditPopover(el, clickX, clickY) {
    const desc = describeInteractable(el);
    const pop = document.createElement('div');
    pop.className = 'cms-action-popover';
    pop.innerHTML = `
      <span class="cms-popover-label" title="${escapeAttr(desc.label)}">${escapeHtml(desc.label)}</span>
      <button type="button" class="cms-popover-btn" id="pop-do-click">▶ Kliknout</button>
      <button type="button" class="cms-popover-btn edit-btn" id="pop-do-edit">✏️ Upravit</button>
    `;
    document.body.appendChild(pop);

    const rect = el.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    let top = rect.top - popRect.height - 8;
    if (top < 60) top = Math.min(window.innerHeight - 56, clickY + 14);
    let left = rect.left + rect.width / 2 - popRect.width / 2;
    left = Math.max(12, Math.min(window.innerWidth - popRect.width - 12, left));

    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;

    pop.querySelector('#pop-do-click')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      closeActivePopover();
      desc.onClickAction();
    });

    pop.querySelector('#pop-do-edit')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      closeActivePopover();
      desc.onEditAction();
    });

    activePopoverCleanup = () => pop.remove();
  }

  function navigateInCmsMode(rawHref) {
    if (!rawHref) return;
    if (rawHref.startsWith('#')) {
      const target = document.querySelector(rawHref);
      if (target) target.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    const [pathPart, hashPart] = rawHref.split('#');
    const url = new URL(pathPart, window.location.href);
    url.searchParams.set('cms', '1');
    if (hashPart) url.hash = hashPart;
    window.location.href = url.toString();
  }

  function describeInteractable(el) {
    // 0A. Top Bar Brand Block (.site-header .brand)
    if (el.matches('.site-header .brand')) {
      return {
        label: 'Horní lišta: Název a podtitulek webu',
        onClickAction: () => navigateInCmsMode(el.getAttribute('href') || 'index.html'),
        onEditAction: () => openTopBarEditor('brand')
      };
    }

    // 0B. Top Bar Navigation Link (.site-header .nav-links a)
    if (el.matches('.site-header .nav-links a')) {
      const cmsKey = el.getAttribute('data-cms');
      const linkLabel = el.textContent.trim() || 'Odkaz v menu';
      return {
        label: `Horní lišta: ${linkLabel}`,
        onClickAction: () => navigateInCmsMode(el.getAttribute('href')),
        onEditAction: () => openTopBarEditor(cmsKey)
      };
    }

    // 1. Hero Image Card on index.html
    if (el.classList.contains('hero-img-btn')) {
      const bgKey = el.getAttribute('data-cms-bg'); // e.g. home.cardTreeImg
      const titleEl = el.querySelector('[data-cms]');
      const subEl = el.querySelector('small[data-cms]');
      const titleKey = titleEl?.getAttribute('data-cms');
      const subKey = subEl?.getAttribute('data-cms');
      const label = titleEl?.textContent || 'Rozcestník';
      return {
        label,
        onClickAction: () => navigateInCmsMode(el.getAttribute('href')),
        onEditAction: () => openHeroCardEditor({ bgKey, titleKey, subKey, label })
      };
    }

    // 2. "Více o Příboře →" Button on index.html
    if (el.id === 'btn-pribor-more') {
      return {
        label: 'Tlačítko a okno: O Příboře',
        onClickAction: () => window.openPriborMoreOverlay && window.openPriborMoreOverlay(),
        onEditAction: () => openPriborOverlayEditor()
      };
    }

    // 3. Main Page Václav Pokorný Portrait
    if (el.id === 'vaclav-home-portrait') {
      return {
        label: 'Portrét Václava Pokorného',
        onClickAction: () => navigateInCmsMode('vaclav-pokorny.html'),
        onEditAction: () => openVaclavHomePortraitEditor()
      };
    }

    // 4. Main Page Václav Pokorný "Více →" CTA Button
    if (el.matches('.vaclav-cta-wrap a')) {
      return {
        label: el.textContent.trim() || 'Tlačítko Více',
        onClickAction: () => navigateInCmsMode(el.getAttribute('href')),
        onEditAction: () => openSimpleButtonTextEditor('home.vaclavCtaLabel', 'Text tlačítka (Václav Pokorný)')
      };
    }

    // 5. Audio Track Item
    if (el.classList.contains('track-item')) {
      const idx = parseInt(el.getAttribute('data-idx') || '0', 10);
      const track = SITE_DATA.audioTracks?.[idx];
      return {
        label: track ? `Skladba: ${track.title}` : 'Audio stopa',
        onClickAction: () => window.selectShowcaseTrack && window.selectShowcaseTrack(idx, true),
        onEditAction: () => track && openAudioTrackEditor(track, idx)
      };
    }

    // 6. Timeline Item (Compact on index.html or Full on subpages)
    if (el.classList.contains('timeline-item-compact') || el.classList.contains('timeline-item-interactive')) {
      const tType = el.getAttribute('data-timeline-type') || 'pharmacy';
      const id = el.getAttribute('data-id');
      const list = tType === 'vaclav' ? SITE_DATA.vaclavTimeline : SITE_DATA.pharmacyTimeline;
      const entry = list?.find(x => x.id === id);
      return {
        label: entry ? `${entry.year || entry.period}: ${entry.title}` : 'Milník časové osy',
        onClickAction: () => {
          if (el.classList.contains('timeline-item-compact')) {
            navigateInCmsMode(`historie-lekarny.html#${id}`);
          } else if (entry && window.openTimelineOverlay) {
            window.openTimelineOverlay(entry, tType === 'vaclav' ? 'period' : 'year');
          }
        },
        onEditAction: () => entry && openTimelineItemEditor(entry, tType)
      };
    }

    // 7. Framed Photo Card (Příbor section on index.html or Václav Pokorný subpage)
    if (el.classList.contains('vaclav-framed-photo')) {
      const group = el.getAttribute('data-photo-group') || 'vaclav';
      const id = el.getAttribute('data-photo-id');
      const list = group === 'pribor' ? SITE_DATA.priborPhotos : SITE_DATA.vaclavInteractivePhotos;
      const item = list?.find(p => p.id === id);
      return {
        label: item ? `Rámeček: ${item.title}` : 'Fotografie v rámečku',
        onClickAction: () => item && window.openVaclavPhotoOverlay && window.openVaclavPhotoOverlay(item),
        onEditAction: () => item && openFramedPhotoEditor(item, group)
      };
    }

    // 8. Archive Collage Tile
    if (el.classList.contains('collage-tile')) {
      const id = el.getAttribute('data-id');
      const item = SITE_DATA.archiveItems?.find(x => x.id === id);
      return {
        label: item ? `Archiv: ${item.title}` : 'Položka archivu',
        onClickAction: () => item && window.openMediaGalleryOverlay && window.openMediaGalleryOverlay(item),
        onEditAction: () => item && openArchiveItemEditor(item)
      };
    }

    // 9. Lineage Chain Card (6 generations of pharmacists on historie-lekarny.html)
    if (el.classList.contains('lineage-node-link')) {
      const idx = parseInt(el.getAttribute('data-lineage-idx') || '0', 10);
      const node = SITE_DATA.familyTree?.pharmacistsLine?.[idx];
      return {
        label: node ? `${node.gen}. gen.: ${node.name}` : 'Lékárník v posloupnosti',
        onClickAction: () => navigateInCmsMode(el.getAttribute('href')),
        onEditAction: () => node && openLineageNodeEditor(node)
      };
    }

    // 10. Brožík Connection Callout Box
    if (el.id === 'brozik-box') {
      return {
        label: 'Box: Větev Brožíkových z Plzně',
        onClickAction: () => {
          const pid = SITE_DATA.familyTree?.brozikConnection?.personId || 'bozena-brozikova-5';
          navigateInCmsMode(`rodokmen.html?person=${pid}`);
        },
        onEditAction: () => openBrozikBoxEditor()
      };
    }

    // 11. Family Tree Person Card (rodokmen.html)
    if (el.classList.contains('tree-person-card')) {
      const personId = el.getAttribute('data-person-id');
      const member = window.PERSON_MAP?.get(personId);
      return {
        label: member ? member.name : 'Osobnost v rodokmenu',
        onClickAction: () => member && window.openPersonOverlayModal && window.openPersonOverlayModal(member),
        onEditAction: () => member && openTreePersonEditor(member)
      };
    }

    return {
      label: 'Prvek stránky',
      onClickAction: () => {
        bypassingClickElement = el;
        el.click();
      },
      onEditAction: () => {}
    };
  }

  // ==========================================================================
  // 6. Fullscreen / Overlay Editors for Each Interactive Component
  // ==========================================================================
  function openTopBarEditor(focusFieldKey = null) {
    const g = SITE_DATA.pageText?.global || {};
    const modal = createCmsModal('✏️ Upravit horní lištu webu (značku a menu)', `
      <p style="font-size:0.88rem; color:#5a605d; margin:0 0 0.5rem 0;">
        Úpravy horní lišty se automaticky propíší na všechny podstránky webu.
      </p>
      <div class="cms-field-grid">
        <div class="cms-field">
          <label>Hlavní titulek vlevo (značka webu)</label>
          <input type="text" id="edit-tb-brand-title" data-tb-key="global.brandTitle" class="cms-input" value="${escapeAttr(g.brandTitle || 'Pokorní z Příbora')}" />
        </div>
        <div class="cms-field">
          <label>Podtitulek pod názvem vlevo</label>
          <input type="text" id="edit-tb-brand-sub" data-tb-key="global.brandSubtitle" class="cms-input" value="${escapeAttr(g.brandSubtitle || '')}" />
        </div>
        <div class="cms-field">
          <label>1. položka menu (Úvod)</label>
          <input type="text" id="edit-tb-nav-home" data-tb-key="global.navHome" class="cms-input" value="${escapeAttr(g.navHome || 'Úvod')}" />
        </div>
        <div class="cms-field">
          <label>2. položka menu (Interaktivní rodokmen)</label>
          <input type="text" id="edit-tb-nav-tree" data-tb-key="global.navTree" class="cms-input" value="${escapeAttr(g.navTree || 'Interaktivní rodokmen')}" />
        </div>
        <div class="cms-field">
          <label>3. položka menu (Historie lékárny)</label>
          <input type="text" id="edit-tb-nav-pharm" data-tb-key="global.navPharmacy" class="cms-input" value="${escapeAttr(g.navPharmacy || 'Historie lékárny')}" />
        </div>
        <div class="cms-field">
          <label>4. položka menu (PhMr. Václav Pokorný)</label>
          <input type="text" id="edit-tb-nav-vaclav" data-tb-key="global.navVaclav" class="cms-input" value="${escapeAttr(g.navVaclav || 'PhMr. Václav Pokorný')}" />
        </div>
        <div class="cms-field full-width">
          <label>5. položka menu (Archiv)</label>
          <input type="text" id="edit-tb-nav-archive" data-tb-key="global.navArchive" class="cms-input" value="${escapeAttr(g.navArchive || 'Archiv')}" />
        </div>
      </div>
    `, `
      <button type="button" class="cms-btn cms-btn-outline" style="color:#1f2421; border-color:#cbbba0;" data-close-modal>Zrušit</button>
      <button type="button" class="cms-btn cms-btn-primary" id="save-topbar-btn">✓ Použít změny</button>
    `);

    if (focusFieldKey) {
      const targetInput = focusFieldKey === 'brand'
        ? modal.querySelector('#edit-tb-brand-title')
        : modal.querySelector(`[data-tb-key="${focusFieldKey}"]`);
      if (targetInput) {
        setTimeout(() => {
          targetInput.focus();
          targetInput.select();
        }, 50);
      }
    }

    modal.querySelector('#save-topbar-btn')?.addEventListener('click', () => {
      setNestedPageText('global.brandTitle', modal.querySelector('#edit-tb-brand-title').value.trim());
      setNestedPageText('global.brandSubtitle', modal.querySelector('#edit-tb-brand-sub').value.trim());
      setNestedPageText('global.navHome', modal.querySelector('#edit-tb-nav-home').value.trim());
      setNestedPageText('global.navTree', modal.querySelector('#edit-tb-nav-tree').value.trim());
      setNestedPageText('global.navPharmacy', modal.querySelector('#edit-tb-nav-pharm').value.trim());
      setNestedPageText('global.navVaclav', modal.querySelector('#edit-tb-nav-vaclav').value.trim());
      setNestedPageText('global.navArchive', modal.querySelector('#edit-tb-nav-archive').value.trim());
      markDirty(true);
      if (typeof window.refreshPageView === 'function') window.refreshPageView();
      modal.remove();
      showCmsToast('Horní lišta webu byla aktualizována.');
    });
  }

  function openHeroCardEditor({ bgKey, titleKey, subKey, label }) {
    const currTitle = getNestedPageText(titleKey) || '';
    const currSub = getNestedPageText(subKey) || '';
    const currBg = getNestedPageText(bgKey) || '';

    const modal = createCmsModal(`✏️ Upravit kartu rozcestníku: ${label}`, `
      <div class="cms-field-grid">
        <div class="cms-field">
          <label>Hlavní nadpis karty</label>
          <input type="text" id="edit-hero-title" class="cms-input" value="${escapeAttr(currTitle)}" />
        </div>
        <div class="cms-field">
          <label>Podtitulek karty</label>
          <input type="text" id="edit-hero-sub" class="cms-input" value="${escapeAttr(currSub)}" />
        </div>
        <div class="cms-field full-width">
          <label>Obrázek na pozadí karty</label>
          <div class="cms-input-with-btn">
            <input type="text" id="edit-hero-bg" class="cms-input" value="${escapeAttr(currBg)}" placeholder="Cesta k obrázku (např. uploads/...)" />
            <button type="button" class="cms-btn cms-btn-primary" id="pick-hero-bg-btn">📁 Vybrat / Nahrát obrázek</button>
          </div>
        </div>
      </div>
    `, `
      <button type="button" class="cms-btn cms-btn-outline" style="color:#1f2421; border-color:#cbbba0;" data-close-modal>Zrušit</button>
      <button type="button" class="cms-btn cms-btn-primary" id="save-hero-card-btn">✓ Použít změny</button>
    `);

    modal.querySelector('#pick-hero-bg-btn')?.addEventListener('click', () => {
      openFileManagerModal('image', (pickedPath) => {
        modal.querySelector('#edit-hero-bg').value = pickedPath;
      });
    });

    modal.querySelector('#save-hero-card-btn')?.addEventListener('click', () => {
      if (titleKey) setNestedPageText(titleKey, modal.querySelector('#edit-hero-title').value.trim());
      if (subKey) setNestedPageText(subKey, modal.querySelector('#edit-hero-sub').value.trim());
      if (bgKey) setNestedPageText(bgKey, modal.querySelector('#edit-hero-bg').value.trim());
      markDirty(true);
      if (typeof window.refreshPageView === 'function') window.refreshPageView();
      modal.remove();
      showCmsToast('Karta rozcestníku byla upravena.');
    });
  }

  function openPriborOverlayEditor() {
    const home = SITE_DATA.pageText?.home || {};
    const modal = createCmsModal('✏️ Upravit sekci a vyskakovací okno: Město Příbor', `
      <div class="cms-field-grid">
        <div class="cms-field">
          <label>Text tlačítka (např. Více o Příboře →)</label>
          <input type="text" id="edit-pribor-cta" class="cms-input" value="${escapeAttr(home.priborCtaLabel || 'Více o Příboře →')}" />
        </div>
        <div class="cms-field">
          <label>Podtitulek ve vyskakovacím okně</label>
          <input type="text" id="edit-pribor-sub" class="cms-input" value="${escapeAttr(home.priborModalSubtitle || '')}" />
        </div>
        <div class="cms-field full-width">
          <label>Podrobný článek o Příboře ve vyskakovacím okně (odstavce oddělte prázdným řádkem)</label>
          <textarea id="edit-pribor-long" class="cms-textarea" style="min-height:190px;">${escapeHtml(home.priborLongDescription || '')}</textarea>
        </div>
      </div>
    `, `
      <button type="button" class="cms-btn cms-btn-outline" style="color:#1f2421; border-color:#cbbba0;" data-close-modal>Zrušit</button>
      <button type="button" class="cms-btn cms-btn-primary" id="save-pribor-modal-btn">✓ Použít změny</button>
    `);

    modal.querySelector('#save-pribor-modal-btn')?.addEventListener('click', () => {
      setNestedPageText('home.priborCtaLabel', modal.querySelector('#edit-pribor-cta').value.trim());
      setNestedPageText('home.priborModalSubtitle', modal.querySelector('#edit-pribor-sub').value.trim());
      setNestedPageText('home.priborLongDescription', modal.querySelector('#edit-pribor-long').value.trim());
      markDirty(true);
      if (typeof window.refreshPageView === 'function') window.refreshPageView();
      modal.remove();
      showCmsToast('Obsah okna O Příboře byl aktualizován.');
    });
  }

  function openVaclavHomePortraitEditor() {
    const currImg = getNestedPageText('home.vaclavPortraitImg') || '';
    const currCap = getNestedPageText('home.vaclavPortraitCaption') || '';
    const modal = createCmsModal('✏️ Upravit portrét PhMr. Václava Pokorného (Úvod)', `
      <div class="cms-field-grid">
        <div class="cms-field full-width">
          <label>Fotografie portrétu</label>
          <div class="cms-input-with-btn">
            <input type="text" id="edit-vp-home-img" class="cms-input" value="${escapeAttr(currImg)}" placeholder="Cesta k fotografii (např. uploads/...)" />
            <button type="button" class="cms-btn cms-btn-primary" id="pick-vp-home-img">📁 Vybrat / Nahrát foto</button>
          </div>
        </div>
        <div class="cms-field full-width">
          <label>Popisek pod portrétem</label>
          <input type="text" id="edit-vp-home-cap" class="cms-input" value="${escapeAttr(currCap)}" />
        </div>
      </div>
    `, `
      <button type="button" class="cms-btn cms-btn-outline" style="color:#1f2421; border-color:#cbbba0;" data-close-modal>Zrušit</button>
      <button type="button" class="cms-btn cms-btn-primary" id="save-vp-home-btn">✓ Použít změny</button>
    `);

    modal.querySelector('#pick-vp-home-img')?.addEventListener('click', () => {
      openFileManagerModal('image', (picked) => {
        modal.querySelector('#edit-vp-home-img').value = picked;
      });
    });

    modal.querySelector('#save-vp-home-btn')?.addEventListener('click', () => {
      setNestedPageText('home.vaclavPortraitImg', modal.querySelector('#edit-vp-home-img').value.trim());
      setNestedPageText('home.vaclavPortraitCaption', modal.querySelector('#edit-vp-home-cap').value.trim());
      markDirty(true);
      if (typeof window.refreshPageView === 'function') window.refreshPageView();
      modal.remove();
    });
  }

  function openSimpleButtonTextEditor(cmsKey, titleLabel) {
    const curr = getNestedPageText(cmsKey) || '';
    const modal = createCmsModal(`✏️ ${titleLabel}`, `
      <div class="cms-field">
        <label>Text tlačítka</label>
        <input type="text" id="edit-simple-btn-val" class="cms-input" value="${escapeAttr(curr)}" />
      </div>
    `, `
      <button type="button" class="cms-btn cms-btn-outline" style="color:#1f2421; border-color:#cbbba0;" data-close-modal>Zrušit</button>
      <button type="button" class="cms-btn cms-btn-primary" id="save-simple-btn">✓ Uložit</button>
    `, 'cms-modal-sm');

    modal.querySelector('#save-simple-btn')?.addEventListener('click', () => {
      setNestedPageText(cmsKey, modal.querySelector('#edit-simple-btn-val').value.trim());
      markDirty(true);
      if (typeof window.refreshPageView === 'function') window.refreshPageView();
      modal.remove();
    });
  }

  function openAudioTrackEditor(track, idx) {
    const modal = createCmsModal(`✏️ Upravit skladbu v přehrávači: ${track.title}`, `
      <div class="cms-field-grid">
        <div class="cms-field">
          <label>Název skladby / pořadu</label>
          <input type="text" id="edit-track-title" class="cms-input" value="${escapeAttr(track.title || '')}" />
        </div>
        <div class="cms-field">
          <label>Interpret / Podtitulek</label>
          <input type="text" id="edit-track-sub" class="cms-input" value="${escapeAttr(track.subtitle || '')}" />
        </div>
        <div class="cms-field">
          <label>Rok / Období</label>
          <input type="text" id="edit-track-year" class="cms-input" value="${escapeAttr(track.year || '')}" />
        </div>
        <div class="cms-field">
          <label>Délka (např. 28:10)</label>
          <input type="text" id="edit-track-dur" class="cms-input" value="${escapeAttr(track.duration || '')}" />
        </div>
        <div class="cms-field full-width">
          <label>Zvukový soubor (MP3, WAV, OGG, WMA)</label>
          <div class="cms-input-with-btn">
            <input type="text" id="edit-track-src" class="cms-input" value="${escapeAttr(track.src || '')}" />
            <button type="button" class="cms-btn cms-btn-primary" id="pick-track-src">📁 Vybrat / Nahrát audio</button>
          </div>
        </div>
      </div>
    `, `
      <button type="button" class="cms-btn cms-btn-danger" id="delete-track-btn">🗑️ Smazat skladbu</button>
      <div style="display:flex; gap:0.5rem;">
        <button type="button" class="cms-btn cms-btn-outline" style="color:#1f2421; border-color:#cbbba0;" data-close-modal>Zrušit</button>
        <button type="button" class="cms-btn cms-btn-primary" id="save-track-btn">✓ Použít změny</button>
      </div>
    `);

    modal.querySelector('#pick-track-src')?.addEventListener('click', () => {
      openFileManagerModal('audio', (picked) => {
        modal.querySelector('#edit-track-src').value = picked;
      });
    });

    modal.querySelector('#delete-track-btn')?.addEventListener('click', () => {
      if (!confirm(`Opravdu smazat skladbu „${track.title}“?`)) return;
      SITE_DATA.audioTracks.splice(idx, 1);
      markDirty(true);
      if (typeof window.refreshPageView === 'function') window.refreshPageView();
      modal.remove();
    });

    modal.querySelector('#save-track-btn')?.addEventListener('click', () => {
      track.title = modal.querySelector('#edit-track-title').value.trim();
      track.subtitle = modal.querySelector('#edit-track-sub').value.trim();
      track.year = modal.querySelector('#edit-track-year').value.trim();
      track.duration = modal.querySelector('#edit-track-dur').value.trim();
      track.src = modal.querySelector('#edit-track-src').value.trim();
      markDirty(true);
      if (typeof window.refreshPageView === 'function') window.refreshPageView();
      modal.remove();
      showCmsToast('Skladba byla aktualizována.');
    });
  }

  function openTimelineItemEditor(entry, timelineType = 'pharmacy') {
    const isVaclav = timelineType === 'vaclav';
    const timeKey = isVaclav ? 'period' : 'year';
    const workingPhotos = JSON.parse(JSON.stringify(entry.photos && entry.photos.length ? entry.photos : [{ url: null, caption: entry.title }]));

    const modal = createCmsModal(`✏️ Upravit milník časové osy: ${entry.title}`, `
      <div class="cms-field-grid">
        <div class="cms-field">
          <label>${isVaclav ? 'Období / Roky' : 'Rok / Století'}</label>
          <input type="text" id="edit-tl-time" class="cms-input" value="${escapeAttr(entry[timeKey] || '')}" />
        </div>
        <div class="cms-field">
          <label>Nadpis období</label>
          <input type="text" id="edit-tl-title" class="cms-input" value="${escapeAttr(entry.title || '')}" />
        </div>
        ${!isVaclav ? `
          <div class="cms-field full-width">
            <label>Osobnosti / Generace (jména se automaticky prolinkují do rodokmenu)</label>
            <input type="text" id="edit-tl-person" class="cms-input" value="${escapeAttr(entry.person || '')}" />
          </div>
        ` : ''}
        <div class="cms-field full-width">
          <label>Krátký popis na stránce (podporuje odkazy [www.web.cz](Název) i jména rodu)</label>
          <textarea id="edit-tl-short" class="cms-textarea" style="min-height:80px;">${escapeHtml(entry.description || '')}</textarea>
        </div>
        <div class="cms-field full-width">
          <label>Podrobné vyprávění po rozkliknutí tlačítka „Více ↗“ (odstavce oddělte prázdným řádkem)</label>
          <textarea id="edit-tl-long" class="cms-textarea" style="min-height:150px;">${escapeHtml(entry.longDescription || entry.description || '')}</textarea>
        </div>
        <div class="cms-field full-width">
          <label>Fotografie v karuselu tohoto období</label>
          <div id="edit-tl-photos-wrap" class="cms-photo-list-editor"></div>
          <button type="button" class="cms-btn cms-btn-outline" style="color:#1f2421; border-color:#cbbba0; align-self:flex-start; margin-top:0.35rem;" id="add-tl-photo-btn">+ Přidat další fotografii</button>
        </div>
      </div>
    `, `
      <button type="button" class="cms-btn cms-btn-danger" id="delete-tl-btn">🗑️ Smazat tento milník</button>
      <div style="display:flex; gap:0.5rem;">
        <button type="button" class="cms-btn cms-btn-outline" style="color:#1f2421; border-color:#cbbba0;" data-close-modal>Zrušit</button>
        <button type="button" class="cms-btn cms-btn-primary" id="save-tl-btn">✓ Použít změny</button>
      </div>
    `);

    const photosWrap = modal.querySelector('#edit-tl-photos-wrap');
    renderPhotoRowsEditor(photosWrap, workingPhotos, true);

    modal.querySelector('#add-tl-photo-btn')?.addEventListener('click', () => {
      workingPhotos.push({ url: null, caption: '', detail: '' });
      renderPhotoRowsEditor(photosWrap, workingPhotos, true);
    });

    modal.querySelector('#delete-tl-btn')?.addEventListener('click', () => {
      if (!confirm(`Opravdu smazat milník „${entry.title}“?`)) return;
      const list = isVaclav ? SITE_DATA.vaclavTimeline : SITE_DATA.pharmacyTimeline;
      const idx = list.findIndex(x => x.id === entry.id);
      if (idx !== -1) list.splice(idx, 1);
      markDirty(true);
      if (typeof window.refreshPageView === 'function') window.refreshPageView();
      modal.remove();
    });

    modal.querySelector('#save-tl-btn')?.addEventListener('click', () => {
      entry[timeKey] = modal.querySelector('#edit-tl-time').value.trim();
      entry.title = modal.querySelector('#edit-tl-title').value.trim();
      if (!isVaclav && modal.querySelector('#edit-tl-person')) {
        entry.person = modal.querySelector('#edit-tl-person').value.trim();
      }
      entry.description = modal.querySelector('#edit-tl-short').value.trim();
      entry.longDescription = modal.querySelector('#edit-tl-long').value.trim();
      entry.photos = workingPhotos;
      markDirty(true);
      if (typeof window.refreshPageView === 'function') window.refreshPageView();
      modal.remove();
      showCmsToast('Milník časové osy byl aktualizován.');
    });
  }

  function openFramedPhotoEditor(item, groupType = 'vaclav') {
    const isPribor = groupType === 'pribor';
    const workingPhotos = JSON.parse(JSON.stringify(item.photos && item.photos.length ? item.photos : [{ url: null, caption: item.title }]));

    const modal = createCmsModal(`✏️ Upravit fotografický rámeček: ${item.title}`, `
      <div class="cms-field-grid">
        <div class="cms-field">
          <label>Titulek rámečku</label>
          <input type="text" id="edit-fp-title" class="cms-input" value="${escapeAttr(item.title || '')}" />
        </div>
        <div class="cms-field">
          <label>Období / Rok</label>
          <input type="text" id="edit-fp-date" class="cms-input" value="${escapeAttr(item.date || '')}" />
        </div>
        <div class="cms-field">
          <label>Autor / Zdroj archivu</label>
          <input type="text" id="edit-fp-author" class="cms-input" value="${escapeAttr(item.author || '')}" />
        </div>
        <div class="cms-field">
          <label>Režim po rozkliknutí</label>
          <select id="edit-fp-mode" class="cms-select">
            <option value="split" ${item.mode === 'split' ? 'selected' : ''}>Fotokarusel vlevo + textový popis vpravo</option>
            <option value="carousel" ${item.mode === 'carousel' ? 'selected' : ''}>Pouze velký fotokarusel</option>
          </select>
        </div>
        ${!isPribor ? `
          <div class="cms-field full-width">
            <label>Umístění na podstránce Václava Pokorného</label>
            <select id="edit-fp-placement" class="cms-select">
              <option value="top-right" ${item.placement === 'top-right' ? 'selected' : ''}>Vpravo nahoře vedle úvodního životopisu</option>
              <option value="timeline-left" ${item.placement === 'timeline-left' ? 'selected' : ''}>Vlevo podél časové osy života</option>
            </select>
          </div>
        ` : ''}
        <div class="cms-field full-width">
          <label>Krátký popisek pod rámečkem</label>
          <input type="text" id="edit-fp-caption" class="cms-input" value="${escapeAttr(item.caption || '')}" />
        </div>
        <div class="cms-field full-width">
          <label>Podrobný popis (zobrazí se v pravém panelu po rozkliknutí)</label>
          <textarea id="edit-fp-desc" class="cms-textarea">${escapeHtml(item.description || '')}</textarea>
        </div>
        <div class="cms-field full-width">
          <label>Snímky uvnitř tohoto rámečku (první snímek slouží jako náhled)</label>
          <div id="edit-fp-photos-wrap" class="cms-photo-list-editor"></div>
          <button type="button" class="cms-btn cms-btn-outline" style="color:#1f2421; border-color:#cbbba0; align-self:flex-start; margin-top:0.35rem;" id="add-fp-photo-btn">+ Přidat snímek</button>
        </div>
      </div>
    `, `
      <button type="button" class="cms-btn cms-btn-danger" id="delete-fp-btn">🗑️ Smazat rámeček</button>
      <div style="display:flex; gap:0.5rem;">
        <button type="button" class="cms-btn cms-btn-outline" style="color:#1f2421; border-color:#cbbba0;" data-close-modal>Zrušit</button>
        <button type="button" class="cms-btn cms-btn-primary" id="save-fp-btn">✓ Použít změny</button>
      </div>
    `);

    const photosWrap = modal.querySelector('#edit-fp-photos-wrap');
    renderPhotoRowsEditor(photosWrap, workingPhotos, false);

    modal.querySelector('#add-fp-photo-btn')?.addEventListener('click', () => {
      workingPhotos.push({ url: null, caption: '' });
      renderPhotoRowsEditor(photosWrap, workingPhotos, false);
    });

    modal.querySelector('#delete-fp-btn')?.addEventListener('click', () => {
      if (!confirm(`Smazat rámeček „${item.title}“?`)) return;
      const list = isPribor ? SITE_DATA.priborPhotos : SITE_DATA.vaclavInteractivePhotos;
      const idx = list.findIndex(x => x.id === item.id);
      if (idx !== -1) list.splice(idx, 1);
      markDirty(true);
      if (typeof window.refreshPageView === 'function') window.refreshPageView();
      modal.remove();
    });

    modal.querySelector('#save-fp-btn')?.addEventListener('click', () => {
      item.title = modal.querySelector('#edit-fp-title').value.trim();
      item.date = modal.querySelector('#edit-fp-date').value.trim();
      item.author = modal.querySelector('#edit-fp-author').value.trim();
      item.mode = modal.querySelector('#edit-fp-mode').value;
      if (!isPribor && modal.querySelector('#edit-fp-placement')) {
        item.placement = modal.querySelector('#edit-fp-placement').value;
      }
      item.caption = modal.querySelector('#edit-fp-caption').value.trim();
      item.description = modal.querySelector('#edit-fp-desc').value.trim();
      item.photos = workingPhotos;
      item.thumbnailUrl = workingPhotos[0]?.url || item.thumbnailUrl || null;
      markDirty(true);
      if (typeof window.refreshPageView === 'function') window.refreshPageView();
      modal.remove();
      showCmsToast('Fotografický rámeček byl aktualizován.');
    });
  }

  function openArchiveItemEditor(item) {
    const workingPhotos = JSON.parse(JSON.stringify(item.photos && item.photos.length ? item.photos : [{ url: null, caption: item.title }]));
    const pagesSet = new Set(item.pages || ['main']);

    const modal = createCmsModal(`✏️ Upravit položku archivu: ${item.title}`, `
      <div class="cms-field-grid">
        <div class="cms-field">
          <label>Název archiválie</label>
          <input type="text" id="edit-ar-title" class="cms-input" value="${escapeAttr(item.title || '')}" />
        </div>
        <div class="cms-field">
          <label>Kategorie filtru</label>
          <select id="edit-ar-cat" class="cms-select">
            <option value="kroniky" ${item.category === 'kroniky' ? 'selected' : ''}>Kroniky a knihy</option>
            <option value="dokumenty" ${item.category === 'dokumenty' ? 'selected' : ''}>Diplomy a dokumenty</option>
            <option value="noty" ${item.category === 'noty' ? 'selected' : ''}>Notové záznamy</option>
            <option value="hudba" ${item.category === 'hudba' ? 'selected' : ''}>Hudba a rozhlas</option>
            <option value="fotografie" ${item.category === 'fotografie' ? 'selected' : ''}>Fotografie</option>
          </select>
        </div>
        <div class="cms-field">
          <label>Typ média</label>
          <select id="edit-ar-type" class="cms-select">
            <option value="photo" ${item.mediaType === 'photo' ? 'selected' : ''}>🖼️ Fotogalerie / Skeny</option>
            <option value="pdf" ${item.mediaType === 'pdf' ? 'selected' : ''}>📄 PDF Dokument / Partitura</option>
            <option value="audio" ${item.mediaType === 'audio' ? 'selected' : ''}>🎵 Zvuková nahrávka</option>
          </select>
        </div>
        <div class="cms-field">
          <label>Velikost dlaždice v koláži</label>
          <select id="edit-ar-size" class="cms-select">
            <option value="normal" ${item.tileSize === 'normal' ? 'selected' : ''}>Standardní</option>
            <option value="wide" ${item.tileSize === 'wide' ? 'selected' : ''}>Široká (přes 2 sloupce)</option>
            <option value="tall" ${item.tileSize === 'tall' ? 'selected' : ''}>Vysoká</option>
            <option value="large" ${item.tileSize === 'large' ? 'selected' : ''}>Velká (2×2)</option>
          </select>
        </div>
        <div class="cms-field">
          <label>Datace / Rok</label>
          <input type="text" id="edit-ar-date" class="cms-input" value="${escapeAttr(item.date || '')}" />
        </div>
        <div class="cms-field">
          <label>Autor / Původ</label>
          <input type="text" id="edit-ar-author" class="cms-input" value="${escapeAttr(item.author || '')}" />
        </div>
        <div class="cms-field full-width">
          <label>Zobrazit v archivu na stránkách:</label>
          <div style="display:flex; gap:1.25rem; flex-wrap:wrap; margin-top:0.25rem;">
            <label style="text-transform:none; font-weight:600;"><input type="checkbox" class="ar-page-cb" value="main" ${pagesSet.has('main') ? 'checked' : ''} /> Úvodní stránka</label>
            <label style="text-transform:none; font-weight:600;"><input type="checkbox" class="ar-page-cb" value="lekarna" ${pagesSet.has('lekarna') ? 'checked' : ''} /> Historie lékárny</label>
            <label style="text-transform:none; font-weight:600;"><input type="checkbox" class="ar-page-cb" value="vaclav" ${pagesSet.has('vaclav') ? 'checked' : ''} /> PhMr. Václav Pokorný</label>
          </div>
        </div>
        <div class="cms-field full-width">
          <label>Náhledový obrázek dlaždice (volitelné)</label>
          <div class="cms-input-with-btn">
            <input type="text" id="edit-ar-thumb" class="cms-input" value="${escapeAttr(item.thumbnailUrl || '')}" placeholder="Cesta k obrázku..." />
            <button type="button" class="cms-btn cms-btn-primary" id="pick-ar-thumb">📁 Vybrat / Nahrát obrázek</button>
          </div>
        </div>
        <div class="cms-field full-width">
          <label>Popis položky</label>
          <textarea id="edit-ar-desc" class="cms-textarea" style="min-height:85px;">${escapeHtml(item.description || '')}</textarea>
        </div>
        <div class="cms-field full-width">
          <label>Přepis rukopisu / Poznámka</label>
          <textarea id="edit-ar-trans" class="cms-textarea" style="min-height:70px;">${escapeHtml(item.transcription || '')}</textarea>
        </div>
        <div class="cms-field full-width" id="ar-pdf-fields">
          <label>PDF Soubor (pokud jde o PDF dokument)</label>
          <div class="cms-input-with-btn">
            <input type="text" id="edit-ar-pdf" class="cms-input" value="${escapeAttr(item.pdfUrl || '')}" placeholder="Cesta k PDF souboru..." />
            <button type="button" class="cms-btn cms-btn-primary" id="pick-ar-pdf">📁 Vybrat / Nahrát PDF</button>
          </div>
        </div>
        <div class="cms-field full-width" id="ar-audio-fields">
          <label>Audio Soubor (pokud jde o zvukovou nahrávku)</label>
          <div class="cms-input-with-btn">
            <input type="text" id="edit-ar-audio" class="cms-input" value="${escapeAttr(item.audioSrc || '')}" placeholder="Cesta k audio souboru..." />
            <button type="button" class="cms-btn cms-btn-primary" id="pick-ar-audio">📁 Vybrat / Nahrát audio</button>
          </div>
        </div>
        <div class="cms-field full-width" id="ar-photos-fields">
          <label>Fotografie v galerii této položky</label>
          <div id="edit-ar-photos-wrap" class="cms-photo-list-editor"></div>
          <button type="button" class="cms-btn cms-btn-outline" style="color:#1f2421; border-color:#cbbba0; align-self:flex-start; margin-top:0.35rem;" id="add-ar-photo-btn">+ Přidat fotografii</button>
        </div>
      </div>
    `, `
      <button type="button" class="cms-btn cms-btn-danger" id="delete-ar-btn">🗑️ Smazat položku</button>
      <div style="display:flex; gap:0.5rem;">
        <button type="button" class="cms-btn cms-btn-outline" style="color:#1f2421; border-color:#cbbba0;" data-close-modal>Zrušit</button>
        <button type="button" class="cms-btn cms-btn-primary" id="save-ar-btn">✓ Použít změny</button>
      </div>
    `);

    const photosWrap = modal.querySelector('#edit-ar-photos-wrap');
    renderPhotoRowsEditor(photosWrap, workingPhotos, false);

    modal.querySelector('#add-ar-photo-btn')?.addEventListener('click', () => {
      workingPhotos.push({ url: null, caption: '' });
      renderPhotoRowsEditor(photosWrap, workingPhotos, false);
    });

    modal.querySelector('#pick-ar-thumb')?.addEventListener('click', () => {
      openFileManagerModal('image', (picked) => { modal.querySelector('#edit-ar-thumb').value = picked; });
    });
    modal.querySelector('#pick-ar-pdf')?.addEventListener('click', () => {
      openFileManagerModal('pdf', (picked) => { modal.querySelector('#edit-ar-pdf').value = picked; });
    });
    modal.querySelector('#pick-ar-audio')?.addEventListener('click', () => {
      openFileManagerModal('audio', (picked) => { modal.querySelector('#edit-ar-audio').value = picked; });
    });

    modal.querySelector('#delete-ar-btn')?.addEventListener('click', () => {
      if (!confirm(`Smazat archiválii „${item.title}“?`)) return;
      const idx = SITE_DATA.archiveItems.findIndex(x => x.id === item.id);
      if (idx !== -1) SITE_DATA.archiveItems.splice(idx, 1);
      markDirty(true);
      if (typeof window.refreshPageView === 'function') window.refreshPageView();
      modal.remove();
    });

    modal.querySelector('#save-ar-btn')?.addEventListener('click', () => {
      item.title = modal.querySelector('#edit-ar-title').value.trim();
      item.category = modal.querySelector('#edit-ar-cat').value;
      item.mediaType = modal.querySelector('#edit-ar-type').value;
      item.tileSize = modal.querySelector('#edit-ar-size').value;
      item.date = modal.querySelector('#edit-ar-date').value.trim();
      item.author = modal.querySelector('#edit-ar-author').value.trim();
      item.thumbnailUrl = modal.querySelector('#edit-ar-thumb').value.trim() || null;
      item.description = modal.querySelector('#edit-ar-desc').value.trim();
      item.transcription = modal.querySelector('#edit-ar-trans').value.trim();
      item.pdfUrl = modal.querySelector('#edit-ar-pdf').value.trim() || null;
      item.audioSrc = modal.querySelector('#edit-ar-audio').value.trim() || null;
      item.photos = workingPhotos;
      const checkedPages = Array.from(modal.querySelectorAll('.ar-page-cb:checked')).map(cb => cb.value);
      item.pages = checkedPages.length ? checkedPages : ['main'];
      markDirty(true);
      if (typeof window.refreshPageView === 'function') window.refreshPageView();
      modal.remove();
      showCmsToast('Položka archivu byla uložena.');
    });
  }

  function openLineageNodeEditor(node) {
    const modal = createCmsModal(`✏️ Upravit generaci lékárníka: ${node.name}`, `
      <div class="cms-field-grid">
        <div class="cms-field">
          <label>Pořadí generace</label>
          <input type="number" id="edit-lin-gen" class="cms-input" value="${escapeAttr(node.gen)}" />
        </div>
        <div class="cms-field">
          <label>Jméno lékárníka</label>
          <input type="text" id="edit-lin-name" class="cms-input" value="${escapeAttr(node.name || '')}" />
        </div>
        <div class="cms-field full-width">
          <label>Role / Popis pod jménem</label>
          <input type="text" id="edit-lin-role" class="cms-input" value="${escapeAttr(node.role || '')}" />
        </div>
      </div>
    `, `
      <button type="button" class="cms-btn cms-btn-outline" style="color:#1f2421; border-color:#cbbba0;" data-close-modal>Zrušit</button>
      <button type="button" class="cms-btn cms-btn-primary" id="save-lin-btn">✓ Uložit</button>
    `, 'cms-modal-sm');

    modal.querySelector('#save-lin-btn')?.addEventListener('click', () => {
      node.gen = parseInt(modal.querySelector('#edit-lin-gen').value, 10) || node.gen;
      node.name = modal.querySelector('#edit-lin-name').value.trim();
      node.role = modal.querySelector('#edit-lin-role').value.trim();
      markDirty(true);
      if (typeof window.refreshPageView === 'function') window.refreshPageView();
      modal.remove();
    });
  }

  function openBrozikBoxEditor() {
    const b = SITE_DATA.familyTree?.brozikConnection || {};
    const modal = createCmsModal('✏️ Upravit box: Větev Brožíkových z Plzně', `
      <div class="cms-field-grid">
        <div class="cms-field">
          <label>Nadpis větve</label>
          <input type="text" id="edit-br-title" class="cms-input" value="${escapeAttr(b.title || '')}" />
        </div>
        <div class="cms-field">
          <label>Jméno osobnosti (odkaz do rodokmenu)</label>
          <input type="text" id="edit-br-spouse" class="cms-input" value="${escapeAttr(b.spouse || '')}" />
        </div>
        <div class="cms-field full-width">
          <label>Popis spojení rodů</label>
          <textarea id="edit-br-details" class="cms-textarea">${escapeHtml(b.details || '')}</textarea>
        </div>
      </div>
    `, `
      <button type="button" class="cms-btn cms-btn-outline" style="color:#1f2421; border-color:#cbbba0;" data-close-modal>Zrušit</button>
      <button type="button" class="cms-btn cms-btn-primary" id="save-br-btn">✓ Uložit</button>
    `);

    modal.querySelector('#save-br-btn')?.addEventListener('click', () => {
      b.title = modal.querySelector('#edit-br-title').value.trim();
      b.spouse = modal.querySelector('#edit-br-spouse').value.trim();
      b.details = modal.querySelector('#edit-br-details').value.trim();
      markDirty(true);
      if (typeof window.refreshPageView === 'function') window.refreshPageView();
      modal.remove();
    });
  }

  function renderPhotoRowsEditor(container, photosArray, includeDetailField = false) {
    container.innerHTML = photosArray.map((p, idx) => `
      <div class="cms-photo-row" data-pidx="${idx}">
        <div class="cms-photo-thumb-preview">
          ${p.url ? `<img src="${escapeAttr(p.url)}" alt="" />` : '🖼️'}
        </div>
        <div style="display:flex; flex-direction:column; gap:0.3rem;">
          <div class="cms-input-with-btn">
            <input type="text" class="cms-input p-url-input" value="${escapeAttr(p.url || '')}" placeholder="Cesta k fotce (uploads/...)" />
            <button type="button" class="cms-btn cms-btn-primary p-pick-btn" style="padding:0.35rem 0.6rem;">📁</button>
          </div>
        </div>
        <div style="display:flex; flex-direction:column; gap:0.3rem;">
          <input type="text" class="cms-input p-cap-input" value="${escapeAttr(p.caption || '')}" placeholder="Popisek snímku..." />
          ${includeDetailField ? `<input type="text" class="cms-input p-det-input" value="${escapeAttr(p.detail || '')}" placeholder="Doplňující poznámka..." />` : ''}
        </div>
        <button type="button" class="cms-btn cms-btn-danger p-del-btn" style="padding:0.35rem 0.55rem;" title="Odebrat snímek">✕</button>
      </div>
    `).join('');

    container.querySelectorAll('.cms-photo-row').forEach(row => {
      const idx = parseInt(row.getAttribute('data-pidx'), 10);
      const urlInput = row.querySelector('.p-url-input');
      const capInput = row.querySelector('.p-cap-input');
      const detInput = row.querySelector('.p-det-input');

      urlInput?.addEventListener('input', () => {
        photosArray[idx].url = urlInput.value.trim() || null;
      });
      capInput?.addEventListener('input', () => {
        photosArray[idx].caption = capInput.value;
      });
      detInput?.addEventListener('input', () => {
        photosArray[idx].detail = detInput.value;
      });

      row.querySelector('.p-pick-btn')?.addEventListener('click', () => {
        openFileManagerModal('image', (picked) => {
          photosArray[idx].url = picked;
          renderPhotoRowsEditor(container, photosArray, includeDetailField);
        });
      });

      row.querySelector('.p-del-btn')?.addEventListener('click', () => {
        if (photosArray.length <= 1) {
          photosArray[0] = { url: null, caption: '' };
        } else {
          photosArray.splice(idx, 1);
        }
        renderPhotoRowsEditor(container, photosArray, includeDetailField);
      });
    });
  }

  // ==========================================================================
  // 7. Section "+ Přidat položku" Buttons & Drag-and-Drop Timeline Overview Bar
  // ==========================================================================
  function injectSectionAddButtons() {
    document.querySelectorAll('.cms-injected-add-wrap').forEach(el => el.remove());

    // 1. Add Pribor Framed Photo
    const priborStack = document.getElementById('pribor-right-photos');
    if (priborStack) {
      const btn = createAddButton('+ Přidat fotografický rámeček Příbora', () => {
        if (!Array.isArray(SITE_DATA.priborPhotos)) SITE_DATA.priborPhotos = [];
        const newItem = {
          id: 'pribor-photo-' + Date.now(),
          mode: 'split',
          title: 'Nový snímek Příbora',
          date: '20. století',
          author: 'Archiv Příbor',
          caption: 'Popisek pod rámečkem',
          description: 'Podrobný popis snímku.',
          photos: [{ url: null, caption: 'Nový snímek Příbora' }]
        };
        SITE_DATA.priborPhotos.push(newItem);
        markDirty(true);
        window.refreshPageView();
        openFramedPhotoEditor(newItem, 'pribor');
      });
      priborStack.appendChild(btn);
    }

    // 2. Add Audio Track on index.html
    const trackList = document.getElementById('track-list');
    if (trackList) {
      const btn = createAddButton('+ Přidat skladbu do přehrávače', () => {
        if (!Array.isArray(SITE_DATA.audioTracks)) SITE_DATA.audioTracks = [];
        const newTrack = {
          id: 'track-' + Date.now(),
          title: 'Nová nahrávka',
          subtitle: 'PhMr. Václav Pokorný',
          duration: '3:00',
          src: '',
          year: 'Archiv'
        };
        SITE_DATA.audioTracks.unshift(newTrack);
        markDirty(true);
        window.refreshPageView();
        openAudioTrackEditor(newTrack, 0);
      });
      trackList.appendChild(btn);
    }

    // 3. Add Václav Framed Photos on vaclav-pokorny.html
    const vpTopRight = document.getElementById('vaclav-top-right-photos');
    if (vpTopRight) {
      vpTopRight.appendChild(createAddButton('+ Přidat horní fotku', () => {
        createNewVaclavPhoto('top-right');
      }));
    }
    const vpSideLeft = document.getElementById('vaclav-timeline-left-photos');
    if (vpSideLeft) {
      vpSideLeft.appendChild(createAddButton('+ Přidat boční fotku k ose', () => {
        createNewVaclavPhoto('timeline-left');
      }));
    }

    // 4. Add Archive Item
    const archiveGrid = document.getElementById('archive-grid');
    if (archiveGrid) {
      const pageScope = archiveGrid.getAttribute('data-gallery-page') || 'main';
      const wrap = document.createElement('div');
      wrap.className = 'cms-injected-add-wrap';
      wrap.style.marginTop = '1.25rem';
      const btn = createAddButton('+ Přidat novou položku do archivu', () => {
        if (!Array.isArray(SITE_DATA.archiveItems)) SITE_DATA.archiveItems = [];
        const newItem = {
          id: 'doc-' + Date.now(),
          category: 'fotografie',
          mediaType: 'photo',
          tileSize: 'normal',
          pages: [pageScope === 'main' ? 'main' : pageScope, 'main'],
          title: 'Nová archiválie',
          date: '20. století',
          author: 'Rodinný archiv',
          description: 'Popis archivního materiálu.',
          transcription: '',
          photos: [{ url: null, caption: 'Nová archiválie' }]
        };
        SITE_DATA.archiveItems.push(newItem);
        markDirty(true);
        window.refreshPageView();
        openArchiveItemEditor(newItem);
      });
      wrap.appendChild(btn);
      archiveGrid.parentElement?.appendChild(wrap);
    }
  }

  function createNewVaclavPhoto(placement) {
    if (!Array.isArray(SITE_DATA.vaclavInteractivePhotos)) SITE_DATA.vaclavInteractivePhotos = [];
    const newItem = {
      id: 'vp-photo-' + Date.now(),
      placement,
      mode: 'split',
      title: 'Nová fotografie Václava Pokorného',
      date: '20. století',
      author: 'Rodinný archiv',
      caption: 'Popisek pod rámečkem',
      description: 'Podrobný popis k fotografii.',
      photos: [{ url: null, caption: 'Nová fotografie' }]
    };
    SITE_DATA.vaclavInteractivePhotos.push(newItem);
    markDirty(true);
    window.refreshPageView();
    openFramedPhotoEditor(newItem, 'vaclav');
  }

  function createAddButton(label, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cms-add-item-btn cms-injected-add-wrap';
    btn.textContent = label;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  // Drag-and-Drop Timeline Overview Strip at the top of timeline sections
  function injectTimelineDndBars() {
    document.querySelectorAll('.cms-timeline-dnd-bar').forEach(el => el.remove());

    const compactPharm = document.getElementById('pharmacy-timeline-compact');
    if (compactPharm) {
      insertDndBarBefore(compactPharm, SITE_DATA.pharmacyTimeline, 'pharmacy', 'year', 'Přehled a řazení milníků lékárny (přetáhněte medailonek myší)');
    }

    const fullPharm = document.getElementById('pharmacy-timeline-full');
    if (fullPharm) {
      insertDndBarBefore(fullPharm, SITE_DATA.pharmacyTimeline, 'pharmacy', 'year', 'Přehled a řazení milníků lékárny (přetáhněte medailonek myší)');
    }

    const fullVaclav = document.getElementById('vaclav-timeline-full');
    if (fullVaclav) {
      insertDndBarBefore(fullVaclav, SITE_DATA.vaclavTimeline, 'vaclav', 'period', 'Přehled a řazení kapitol života Václava Pokorného (přetáhněte medailonek myší)');
    }
  }

  function insertDndBarBefore(timelineContainer, list, timelineType, timeKey, barTitle) {
    if (!Array.isArray(list)) return;
    const bar = document.createElement('div');
    bar.className = 'cms-timeline-dnd-bar';
    bar.innerHTML = `
      <div class="cms-timeline-dnd-header">
        <div class="cms-timeline-dnd-title">
          <span>⠿ ${barTitle}</span>
        </div>
        <button type="button" class="cms-btn cms-btn-primary" id="dnd-add-${timelineType}">+ Přidat milník na osu</button>
      </div>
      <div class="cms-timeline-medallions">
        ${list.map((item, idx) => `
          <div class="cms-timeline-medallion" draggable="true" data-idx="${idx}" data-id="${item.id}" title="Přetáhněte pro změnu pořadí nebo klikněte pro úpravu">
            <span class="cms-medallion-handle">⠿</span>
            <div class="cms-medallion-info">
              <div class="cms-medallion-year">${idx + 1}. ${escapeHtml(item[timeKey] || '')}</div>
              <div class="cms-medallion-name">${escapeHtml(item.title || '')}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    timelineContainer.parentElement?.insertBefore(bar, timelineContainer);

    bar.querySelector(`#dnd-add-${timelineType}`)?.addEventListener('click', () => {
      const newEntry = {
        id: `${timelineType}-${Date.now()}`,
        [timeKey]: 'Nové období',
        title: 'Nová kapitola časové osy',
        person: timelineType === 'pharmacy' ? 'Rod Pokorných' : undefined,
        description: 'Krátký popis období na stránce.',
        longDescription: 'Podrobné vyprávění po otevření okna.',
        photos: [{ url: null, caption: 'Nová kapitola časové osy' }]
      };
      list.push(newEntry);
      markDirty(true);
      window.refreshPageView();
      openTimelineItemEditor(newEntry, timelineType);
    });

    let draggedIdx = null;
    const medallions = bar.querySelectorAll('.cms-timeline-medallion');
    medallions.forEach(med => {
      med.addEventListener('click', () => {
        const idx = parseInt(med.getAttribute('data-idx'), 10);
        if (list[idx]) openTimelineItemEditor(list[idx], timelineType);
      });

      med.addEventListener('dragstart', (e) => {
        draggedIdx = parseInt(med.getAttribute('data-idx'), 10);
        med.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });

      med.addEventListener('dragend', () => {
        med.classList.remove('dragging');
        medallions.forEach(m => m.classList.remove('drag-over'));
      });

      med.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        med.classList.add('drag-over');
      });

      med.addEventListener('dragleave', () => {
        med.classList.remove('drag-over');
      });

      med.addEventListener('drop', (e) => {
        e.preventDefault();
        med.classList.remove('drag-over');
        const targetIdx = parseInt(med.getAttribute('data-idx'), 10);
        if (draggedIdx === null || draggedIdx === targetIdx) return;
        const [moved] = list.splice(draggedIdx, 1);
        list.splice(targetIdx, 0, moved);
        markDirty(true);
        window.refreshPageView();
        showCmsToast('Pořadí milníků na časové ose bylo upraveno.');
      });
    });
  }

  // ==========================================================================
  // 8. Graph-Based Flowchart Family Tree Editor (rodokmen.html in CMS mode)
  // ==========================================================================
  function initTreeFlowchartEditor() {
    if (typeof window.ensureFamilyGraphModel === 'function') {
      window.ensureFamilyGraphModel();
    }
    injectTreeHudCmsButtons();
    wireTreeCardDraggingAndPorts();
  }

  function injectTreeHudCmsButtons() {
    const cornerHud = document.querySelector('.canvas-hud-corner');
    if (!cornerHud || document.getElementById('cms-tree-hud-group')) return;

    const group = document.createElement('div');
    group.id = 'cms-tree-hud-group';
    group.className = 'hud-btn-group';
    group.innerHTML = `
      <button type="button" id="cms-btn-add-person" class="hud-btn hud-btn-text" style="background:#9e7b42; color:#fff; border-color:#b89254;">
        + Přidat osobu
      </button>
      <button type="button" id="cms-btn-organize-tree" class="hud-btn hud-btn-text" title="Automaticky uspořádat propojené větve (samostatné karty si zachovají svou pozici)">
        ✨ Uspořádat strom
      </button>
    `;
    cornerHud.prepend(group);

    group.querySelector('#cms-btn-add-person')?.addEventListener('click', () => {
      createNewPersonInTree();
    });

    group.querySelector('#cms-btn-organize-tree')?.addEventListener('click', () => {
      if (typeof window.organizeFamilyGraphLayout === 'function') {
        window.organizeFamilyGraphLayout(false);
      }
      markDirty(true);
      window.refreshPageView();
      if (window.treePanZoomApi) window.treePanZoomApi.centerTree(true);
      showCmsToast('✨ Rodokmen byl automaticky uspořádán (samostatné karty zůstaly na svém místě).');
    });
  }

  function wireTreeCardDraggingAndPorts() {
    const rootEl = document.getElementById('genealogy-root');
    if (!rootEl) return;

    // 1. Clicking spouse ring (⚭) in CMS mode unlinks the marriage while keeping both cards in place on the canvas
    rootEl.querySelectorAll('.tree-couple-ring').forEach(ring => {
      ring.addEventListener('click', (e) => {
        e.stopPropagation();
        const idA = ring.getAttribute('data-spouse-a');
        const idB = ring.getAttribute('data-spouse-b');
        const nodeA = window.PERSON_MAP?.get(idA);
        const nodeB = window.PERSON_MAP?.get(idB);
        if (nodeA && nodeB) {
          if (!confirm(`Rozpojit manželský svazek mezi „${nodeA.name}“ a „${nodeB.name}“?`)) return;
          nodeA.spouseId = null;
          nodeB.spouseId = null;
          markDirty(true);
          window.refreshPageView();
          showCmsToast('Manželský svazek byl rozpojen.');
        }
      });
    });

    // 2. Dragging (or clicking) ANY Port: .cms-port-top (child input), .cms-port-bottom (parent output), .cms-port-spouse (⚭)
    rootEl.querySelectorAll('.cms-port-top, .cms-port-bottom, .cms-port-spouse').forEach(sourcePort => {
      sourcePort.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        closeActivePopover();

        const portType = sourcePort.getAttribute('data-port'); // 'top' | 'bottom' | 'spouse'
        const sourceId = sourcePort.getAttribute('data-person-id');
        window._cmsDraggingTreeElement = true;

        const portRect = sourcePort.getBoundingClientRect();
        const startX = portRect.left + portRect.width / 2;
        const startY = portRect.top + portRect.height / 2;
        let hasDraggedPort = false;

        // Viewport-fixed SVG overlay so the straight drag line has zero container/zoom offset
        const dragSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        dragSvg.setAttribute('style', 'position:fixed; inset:0; width:100vw; height:100vh; pointer-events:none; z-index:9999;');
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', String(startX));
        line.setAttribute('y1', String(startY));
        line.setAttribute('x2', String(startX));
        line.setAttribute('y2', String(startY));
        line.setAttribute('stroke', portType === 'spouse' ? '#2c6e49' : '#9e7b42');
        line.setAttribute('stroke-width', '3');
        line.setAttribute('stroke-dasharray', '6,4');
        line.setAttribute('stroke-linecap', 'round');
        dragSvg.appendChild(line);
        document.body.appendChild(dragSvg);

        function onMove(ev) {
          if (!hasDraggedPort && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 5) {
            hasDraggedPort = true;
          }

          document.querySelectorAll('.cms-tree-port').forEach(p => p.classList.remove('port-hover-target'));
          const hovered = document.elementFromPoint(ev.clientX, ev.clientY);
          const targetPort = hovered?.closest('.cms-tree-port');
          let endX = ev.clientX;
          let endY = ev.clientY;
          if (targetPort && targetPort !== sourcePort) {
            targetPort.classList.add('port-hover-target');
            const tr = targetPort.getBoundingClientRect();
            endX = tr.left + tr.width / 2;
            endY = tr.top + tr.height / 2;
          }

          line.setAttribute('x2', String(endX));
          line.setAttribute('y2', String(endY));
        }

        function onUp(ev) {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          window._cmsDraggingTreeElement = false;
          dragSvg.remove();
          document.querySelectorAll('.cms-tree-port').forEach(p => p.classList.remove('port-hover-target'));

          if (!hasDraggedPort) {
            if (portType === 'top') {
              handleTopPortClick(sourceId);
            }
            return;
          }

          const dropEl = document.elementFromPoint(ev.clientX, ev.clientY);
          const targetCard = dropEl?.closest('.tree-person-card');
          const targetId = targetCard?.getAttribute('data-person-id');
          if (!targetId || targetId === sourceId) return;

          if (portType === 'bottom') {
            connectParentToChild(sourceId, targetId);
          } else if (portType === 'top') {
            connectParentToChild(targetId, sourceId);
          } else if (portType === 'spouse') {
            connectSpouses(sourceId, targetId);
          }
        }

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });
    });

    // 3. Dragging a Person Card directly updates its (x, y) coordinates on the canvas
    rootEl.querySelectorAll('.tree-person-card').forEach(card => {
      card.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || e.target.closest('.cms-tree-port')) return;
        const personId = card.getAttribute('data-person-id');
        const member = window.PERSON_MAP?.get(personId);
        if (!member) return;

        const startClientX = e.clientX;
        const startClientY = e.clientY;
        const origX = Number.isFinite(member.x) ? member.x : 80;
        const origY = Number.isFinite(member.y) ? member.y : 70;
        const scale = window.treePanZoomApi ? window.treePanZoomApi.getScale() : 1;
        let hasMoved = false;

        function onCardMove(ev) {
          const dx = (ev.clientX - startClientX) / scale;
          const dy = (ev.clientY - startClientY) / scale;
          if (!hasMoved && Math.hypot(dx, dy) > 6) {
            hasMoved = true;
            window._cmsDraggingTreeElement = true;
            closeActivePopover();
          }
          if (hasMoved) {
            member.x = Math.round(origX + dx);
            member.y = Math.round(origY + dy);
            card.style.left = `${member.x}px`;
            card.style.top = `${member.y}px`;
            if (typeof window.updateTreeConnectorsSvg === 'function') {
              window.updateTreeConnectorsSvg();
            }
          }
        }

        function onCardUp() {
          window.removeEventListener('mousemove', onCardMove);
          window.removeEventListener('mouseup', onCardUp);
          if (hasMoved) {
            if (typeof window.normalizeGraphOrigin === 'function') {
              window.normalizeGraphOrigin(true);
            }
            markDirty(true);
            window.refreshPageView();
            setTimeout(() => { window._cmsDraggingTreeElement = false; }, 50);
          }
        }

        window.addEventListener('mousemove', onCardMove);
        window.addEventListener('mouseup', onCardUp);
      });
    });
  }

  function handleTopPortClick(personId) {
    const member = window.PERSON_MAP?.get(personId);
    if (!member) return;

    if (!member.parentId) {
      showCmsToast('Přetáhněte tento horní bod myší na spodní bod rodiče pro propojení.');
      return;
    }

    const parentNode = window.PERSON_MAP?.get(member.parentId);
    const parentLabel = parentNode ? `„${parentNode.name}“` : 'rodiče';
    if (!confirm(`Odpojit osobu „${member.name}“ od rodiče ${parentLabel}? (Obě karty zůstanou na svém místě na plátně.)`)) {
      return;
    }

    member.parentId = null;
    markDirty(true);
    window.refreshPageView();
    showCmsToast(`Rodičovská vazba u „${member.name}“ byla odpojena.`);
  }

  function connectParentToChild(parentId, childId) {
    const parentNode = window.PERSON_MAP?.get(parentId);
    const childNode = window.PERSON_MAP?.get(childId);
    if (!parentNode || !childNode || parentNode.id === childNode.id) return;

    if (parentNode.spouseId === childNode.id || childNode.spouseId === parentNode.id) {
      alert('Partneři v manželském páru nemohou být zároveň rodičem a dítětem.');
      return;
    }

    if (typeof window.isGraphAncestorOf === 'function' && window.isGraphAncestorOf(childNode.id, parentNode.id)) {
      alert('Nelze vytvořit smyčku (nelze připojit potomka jako rodiče jeho vlastního předka).');
      return;
    }

    // Set parentId directly on this specific child node (even if the child is married, their spouse's parentId remains independent!)
    childNode.parentId = parentNode.id;

    syncPersonLinksFromTree();
    markDirty(true);
    window.refreshPageView();
    showCmsToast(`🔗 Propojeno: ${parentNode.name} → ${childNode.name}`);
  }

  function connectSpouses(personAId, personBId) {
    const nodeA = window.PERSON_MAP?.get(personAId);
    const nodeB = window.PERSON_MAP?.get(personBId);
    if (!nodeA || !nodeB || nodeA.id === nodeB.id) return;

    if (nodeA.spouseId === nodeB.id && nodeB.spouseId === nodeA.id) {
      showCmsToast('Tyto dvě osoby jsou již propojeny jako partneři.');
      return;
    }

    if (
      typeof window.isGraphAncestorOf === 'function' &&
      (window.isGraphAncestorOf(nodeA.id, nodeB.id) || window.isGraphAncestorOf(nodeB.id, nodeA.id))
    ) {
      alert('Nelze propojit předka a potomka jako partnery. Nejprve odpojte jejich rodičovskou vazbu.');
      return;
    }

    if (nodeA.spouseId && nodeA.spouseId !== nodeB.id) {
      const oldA = window.PERSON_MAP?.get(nodeA.spouseId);
      if (!confirm(`Osoba „${nodeA.name}“ je již v páru s „${oldA?.name || ''}“. Chcete původní svazek rozpojit a propojit „${nodeA.name}“ s „${nodeB.name}“?`)) {
        return;
      }
      if (oldA) oldA.spouseId = null;
      nodeA.spouseId = null;
    }

    if (nodeB.spouseId && nodeB.spouseId !== nodeA.id) {
      const oldB = window.PERSON_MAP?.get(nodeB.spouseId);
      if (!confirm(`Osoba „${nodeB.name}“ je již v páru s „${oldB?.name || ''}“. Chcete původní svazek rozpojit a propojit „${nodeB.name}“ s „${nodeA.name}“?`)) {
        return;
      }
      if (oldB) oldB.spouseId = null;
      nodeB.spouseId = null;
    }

    nodeA.spouseId = nodeB.id;
    nodeB.spouseId = nodeA.id;

    // If nodeB had no connections yet, align nodeB horizontally next to nodeA if they are far apart vertically
    const bChildren = typeof window.getCoupleChildren === 'function'
      ? (SITE_DATA.familyTree?.nodes || []).filter(n => n.parentId === nodeB.id)
      : [];
    if (!nodeB.parentId && bChildren.length === 0 && Math.abs((nodeB.y || 0) - (nodeA.y || 0)) > 40) {
      nodeB.y = nodeA.y;
      nodeB.x = (nodeA.x || 80) + 280 + 44;
    }

    syncPersonLinksFromTree();
    markDirty(true);
    window.refreshPageView();
    showCmsToast(`⚭ Propojeni partneři: ${nodeA.name} & ${nodeB.name}`);
  }

  function getViewportCenterCanvasCoords() {
    const rootEl = document.getElementById('genealogy-root');
    const scale = window.treePanZoomApi ? window.treePanZoomApi.getScale() : 1;
    let spawnX = 240;
    let spawnY = 180;

    if (rootEl) {
      const rootRect = rootEl.getBoundingClientRect();
      const screenCenterX = window.innerWidth / 2;
      const screenCenterY = (window.innerHeight + 54) / 2;
      spawnX = Math.round((screenCenterX - rootRect.left) / scale - 140);
      spawnY = Math.round((screenCenterY - rootRect.top) / scale - 55);
    }

    const nodes = SITE_DATA.familyTree?.nodes || [];
    for (let attempt = 0; attempt < 15; attempt++) {
      const collision = nodes.some(n => Math.abs((n.x || 0) - spawnX) < 35 && Math.abs((n.y || 0) - spawnY) < 35);
      if (!collision) break;
      spawnX += 36;
      spawnY += 36;
    }

    return { x: spawnX, y: spawnY };
  }

  function createNewPersonInTree() {
    if (typeof window.ensureFamilyGraphModel === 'function') {
      window.ensureFamilyGraphModel();
    }
    const coords = getViewportCenterCanvasCoords();

    const newPerson = {
      id: 'person-' + Date.now(),
      gen: 1,
      name: 'Nový člen rodu',
      role: 'Člen rodu Pokorných',
      branch: 'family',
      birthDate: '* doplnit datum',
      deathDate: '—',
      photo: null,
      photoCaption: 'Fotografie osobnosti',
      description: 'Životopisný medailonek osobnosti.',
      photos: [{ url: null, caption: 'Nový člen rodu' }],
      parentId: null,
      spouseId: null,
      x: coords.x,
      y: coords.y
    };

    SITE_DATA.familyTree.nodes.push(newPerson);
    if (typeof window.normalizeGraphOrigin === 'function') {
      window.normalizeGraphOrigin(true);
    }
    syncPersonLinksFromTree();
    markDirty(true);
    window.refreshPageView();
    openTreePersonEditor(newPerson, true);
  }

  function openTreePersonEditor(member, isNewlyCreated = false) {
    const workingPhotos = JSON.parse(JSON.stringify(
      Array.isArray(member.photos) && member.photos.length
        ? member.photos
        : [{ url: member.photo || null, caption: member.photoCaption || member.name }]
    ));

    // Build list of possible parents for this specific person (excluding self, spouse, and own descendants)
    const allPotentialParents = [];
    window.PERSON_MAP?.forEach((p) => {
      const isCycle = typeof window.isGraphAncestorOf === 'function' && window.isGraphAncestorOf(member.id, p.id);
      if (p.id !== member.id && p.id !== member.spouseId && !isCycle) {
        allPotentialParents.push(p);
      }
    });

    const currentParentId = member.parentId || '';
    const totalNodesCount = SITE_DATA.familyTree?.nodes?.length || 1;

    const modal = createCmsModal(`✏️ Upravit osobnost v rodokmenu: ${member.name}`, `
      <div class="cms-field-grid">
        <div class="cms-field">
          <label>Jméno a příjmení (vč. titulů)</label>
          <input type="text" id="edit-tp-name" class="cms-input" value="${escapeAttr(member.name || '')}" />
        </div>
        <div class="cms-field">
          <label>Role / Generace na kartě (ruční popisek)</label>
          <input type="text" id="edit-tp-role" class="cms-input" value="${escapeAttr(member.role || '')}" placeholder="např. 1. gen. • Zakladatel lékárny" />
        </div>
        <div class="cms-field">
          <label>Datum a místo narození</label>
          <input type="text" id="edit-tp-birth" class="cms-input" value="${escapeAttr(member.birthDate || '')}" />
        </div>
        <div class="cms-field">
          <label>Datum a místo úmrtí (nebo „—“)</label>
          <input type="text" id="edit-tp-death" class="cms-input" value="${escapeAttr(member.deathDate || '')}" />
        </div>
        <div class="cms-field">
          <label>Barevná větev karty</label>
          <select id="edit-tp-branch" class="cms-select">
            <option value="pharmacist" ${member.branch === 'pharmacist' ? 'selected' : ''}>🟢 Lékárnická linie (1.–6. gen.)</option>
            <option value="brozik" ${member.branch === 'brozik' ? 'selected' : ''}>🟡 Větev Brožíkových z Plzně</option>
            <option value="family" ${member.branch === 'family' ? 'selected' : ''}>🌿 Rodina a sourozenci</option>
            <option value="modern" ${member.branch === 'modern' ? 'selected' : ''}>🌿 Současné generace (8.–9. gen.)</option>
          </select>
        </div>
        <div class="cms-field">
          <label>Nadřazený rodič této osoby (lze propojit i tažením bodu)</label>
          <select id="edit-tp-parent" class="cms-select">
            <option value="">— Bez nadřazeného rodiče —</option>
            ${allPotentialParents.map(p => {
              const sp = p.spouseId ? window.PERSON_MAP?.get(p.spouseId) : null;
              const label = sp ? `${p.name} (⚭ ${sp.name})` : p.name;
              return `
                <option value="${escapeAttr(p.id)}" ${p.id === currentParentId ? 'selected' : ''}>${escapeHtml(label)}</option>
              `;
            }).join('')}
          </select>
        </div>
        <div class="cms-field full-width">
          <label>Životopis a popis osobnosti (podporuje odkazy [www.web.cz](Název) i jména rodu)</label>
          <textarea id="edit-tp-desc" class="cms-textarea" style="min-height:130px;">${escapeHtml(member.description || '')}</textarea>
        </div>
        <div class="cms-field full-width">
          <label>Fotografie osobnosti (zobrazí se v medailonku po rozkliknutí)</label>
          <div id="edit-tp-photos-wrap" class="cms-photo-list-editor"></div>
          <button type="button" class="cms-btn cms-btn-outline" style="color:#1f2421; border-color:#cbbba0; align-self:flex-start; margin-top:0.35rem;" id="add-tp-photo-btn">+ Přidat fotografii</button>
        </div>
      </div>
    `, `
      <button type="button" class="cms-btn cms-btn-danger" id="delete-tp-btn" ${totalNodesCount <= 1 ? 'disabled title="Poslední kartu v rodokmenu nelze smazat"' : ''}>
        🗑️ Smazat osobu
      </button>
      <div style="display:flex; gap:0.5rem;">
        <button type="button" class="cms-btn cms-btn-outline" style="color:#1f2421; border-color:#cbbba0;" data-close-modal>Zrušit</button>
        <button type="button" class="cms-btn cms-btn-primary" id="save-tp-btn">✓ Uložit osobnost</button>
      </div>
    `);

    const photosWrap = modal.querySelector('#edit-tp-photos-wrap');
    renderPhotoRowsEditor(photosWrap, workingPhotos, false);

    modal.querySelector('#add-tp-photo-btn')?.addEventListener('click', () => {
      workingPhotos.push({ url: null, caption: member.name });
      renderPhotoRowsEditor(photosWrap, workingPhotos, false);
    });

    modal.querySelector('#delete-tp-btn')?.addEventListener('click', () => {
      const nodes = SITE_DATA.familyTree?.nodes || [];
      if (nodes.length <= 1) return;
      if (!confirm(`Opravdu chcete trvale odstranit osobu „${member.name}“ z rodokmenu? (Ostatní karty zůstanou na svém místě.)`)) return;

      const survivingSpouseId = member.spouseId || null;
      nodes.forEach(n => {
        if (n.spouseId === member.id) {
          n.spouseId = null;
        }
        if (n.parentId === member.id) {
          // If the deleted person had a spouse, transfer children's parentId to the surviving spouse; otherwise clear parentId
          n.parentId = survivingSpouseId;
        }
      });

      const idx = nodes.findIndex(n => n.id === member.id);
      if (idx !== -1) nodes.splice(idx, 1);

      syncPersonLinksFromTree();
      markDirty(true);
      window.refreshPageView();
      modal.remove();
      showCmsToast('Osoba byla odstraněna z rodokmenu.');
    });

    modal.querySelector('#save-tp-btn')?.addEventListener('click', () => {
      member.name = modal.querySelector('#edit-tp-name').value.trim() || 'Člen rodu';
      member.role = modal.querySelector('#edit-tp-role').value.trim();
      member.birthDate = modal.querySelector('#edit-tp-birth').value.trim();
      member.deathDate = modal.querySelector('#edit-tp-death').value.trim() || '—';
      member.branch = modal.querySelector('#edit-tp-branch').value;
      member.description = modal.querySelector('#edit-tp-desc').value.trim();
      member.photos = workingPhotos;
      member.photo = workingPhotos[0]?.url || null;
      member.photoCaption = workingPhotos[0]?.caption || member.name;

      const selectedParentId = modal.querySelector('#edit-tp-parent')?.value || '';
      if (selectedParentId !== currentParentId) {
        if (selectedParentId) {
          connectParentToChild(selectedParentId, member.id);
        } else {
          member.parentId = null;
        }
      }

      syncPersonLinksFromTree();
      markDirty(true);
      window.refreshPageView();
      modal.remove();
      showCmsToast(`Medailonek osobnosti „${member.name}“ byl uložen.`);
    });
  }

  function syncPersonLinksFromTree() {
    if (typeof window.ensureFamilyGraphModel === 'function') {
      window.ensureFamilyGraphModel();
    }
    const nodes = SITE_DATA.familyTree?.nodes;
    if (!Array.isArray(nodes)) return;
    if (!Array.isArray(SITE_DATA.personLinks)) SITE_DATA.personLinks = [];
    const existingById = new Map(SITE_DATA.personLinks.map(p => [p.id, p]));
    const activeIds = new Set();

    nodes.forEach(node => {
      if (!node || !node.id || !node.name) return;
      activeIds.add(node.id);
      const cleanName = node.name.trim();
      if (existingById.has(node.id)) {
        const entry = existingById.get(node.id);
        if (!entry.patterns.includes(cleanName) && cleanName.split(/\s+/).length >= 2) {
          entry.patterns.unshift(cleanName);
        }
      } else if (cleanName.split(/\s+/).length >= 2) {
        SITE_DATA.personLinks.push({
          id: node.id,
          patterns: [cleanName]
        });
      }
    });

    SITE_DATA.personLinks = SITE_DATA.personLinks.filter(p => activeIds.has(p.id));
  }

  // ==========================================================================
  // 9. Folder-Organized File Manager & Direct Upload in File Picker
  // ==========================================================================
  function openFileManagerModal(filterType = null, onPickCallback = null) {
    const isPickerMode = typeof onPickCallback === 'function';
    const title = isPickerMode
      ? '📁 Vybrat soubor (nebo nahrát nový přímo do složky)'
      : '📁 Správce souborů, složek (/uploads) a nastavení hesla';

    const modal = createCmsModal(title, `
      <div class="cms-file-browser-layout">
        <!-- Left Sidebar: Folders on disk -->
        <aside class="cms-folder-sidebar">
          <div style="font-size:0.75rem; font-weight:700; text-transform:uppercase; color:#9e7b42; letter-spacing:0.06em;">
            Složky na disku (/uploads)
          </div>
          <div id="cms-folder-tree-list" class="cms-folder-list"></div>
          <div style="display:flex; flex-direction:column; gap:0.35rem; border-top:1px solid #d5c7b0; padding-top:0.6rem;">
            <button type="button" class="cms-btn cms-btn-primary" id="cms-new-folder-btn" style="width:100%;">+ Nová podsložka</button>
            <button type="button" class="cms-btn cms-btn-outline" style="color:#9b2226; border-color:#d5c7b0; width:100%;" id="cms-del-folder-btn">🗑️ Smazat prázdnou složku</button>
          </div>
        </aside>

        <!-- Right Main Area: Direct Upload Button + Files Grid -->
        <div class="cms-file-main-pane">
          <div class="cms-file-toolbar">
            <div>
              <span style="font-size:0.76rem; color:#5a605d;">Aktivní složka:</span>
              <strong id="cms-current-folder-label" style="font-size:0.88rem; color:#1f2421; margin-left:0.3rem;">${escapeHtml(activeUploadFolder)}</strong>
            </div>
            <div style="display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">
              <label class="cms-btn cms-btn-publish" style="cursor:pointer;">
                ⬆️ Nahrát soubor(y) do této složky
                <input type="file" id="cms-direct-upload-input" multiple hidden />
              </label>
            </div>
          </div>

          <div id="cms-files-grid-container" class="cms-files-grid"></div>
        </div>
      </div>

      ${!isPickerMode ? `
        <div style="margin-top:0.75rem; padding-top:0.85rem; border-top:1px solid #d5c7b0; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:0.75rem;">
          <div style="font-size:0.84rem; font-weight:600; color:#2c4c3e;">🔑 Změna administrátorského hesla</div>
          <div style="display:flex; gap:0.45rem; align-items:center;">
            <input type="password" id="cms-new-pass-input" class="cms-input" placeholder="Nové heslo (min. 6 znaků)..." style="width:220px;" />
            <button type="button" class="cms-btn cms-btn-outline" style="color:#1f2421; border-color:#cbbba0;" id="cms-change-pass-btn">Změnit heslo</button>
          </div>
        </div>
      ` : ''}
    `, `
      <span style="font-size:0.78rem; color:#5a605d;">
        💡 Soubory nahrané nebo přesunuté do složky se fyzicky ukládají do příslušné podsložky v <code>/uploads/</code>.
      </span>
      <button type="button" class="cms-btn cms-btn-outline" style="color:#1f2421; border-color:#cbbba0;" data-close-modal>Zavřít okno</button>
    `, 'cms-modal-xl');

    const folderListEl = modal.querySelector('#cms-folder-tree-list');
    const folderLabelEl = modal.querySelector('#cms-current-folder-label');
    const filesGridEl = modal.querySelector('#cms-files-grid-container');

    function renderFolderAndFileBrowser() {
      if (!serverFolders.includes(activeUploadFolder)) {
        activeUploadFolder = 'uploads';
      }
      folderLabelEl.textContent = activeUploadFolder;

      folderListEl.innerHTML = serverFolders.map(folderPath => {
        const depth = folderPath.split('/').length - 1;
        const indent = depth * 12;
        const shortName = folderPath === 'uploads' ? '📂 uploads (kořen)' : `↳ 📁 ${folderPath.split('/').pop()}`;
        const count = serverFiles.filter(f => f.folder === folderPath).length;
        return `
          <button type="button" class="cms-folder-item ${folderPath === activeUploadFolder ? 'active' : ''}" data-folder="${escapeAttr(folderPath)}" style="padding-left:${10 + indent}px;">
            <span>${escapeHtml(shortName)}</span>
            <small style="opacity:0.75;">${count}</small>
          </button>
        `;
      }).join('');

      folderListEl.querySelectorAll('.cms-folder-item').forEach(btn => {
        btn.addEventListener('click', () => {
          activeUploadFolder = btn.getAttribute('data-folder');
          renderFolderAndFileBrowser();
        });
      });

      let visibleFiles = serverFiles.filter(f => f.folder === activeUploadFolder);
      if (filterType) {
        visibleFiles = visibleFiles.filter(f => f.type === filterType);
      }

      if (visibleFiles.length === 0) {
        filesGridEl.innerHTML = `
          <div style="grid-column:1/-1; padding:2.5rem 1rem; text-align:center; color:#5a605d;">
            Ve složce <strong>${escapeHtml(activeUploadFolder)}</strong> zatím nejsou žádné ${filterType ? 'odpovídající ' : ''}soubory.<br/>
            Klikněte na <strong>„⬆️ Nahrát soubor(y) do této složky“</strong> vpravo nahoře.
          </div>
        `;
        return;
      }

      const uploadFoldersOnly = serverFolders.filter(fl => fl.startsWith('uploads'));

      filesGridEl.innerHTML = visibleFiles.map(file => {
        const thumbHtml = file.type === 'image'
          ? `<img src="${escapeAttr(file.path)}" alt="${escapeAttr(file.name)}" />`
          : file.type === 'pdf'
          ? '📄'
          : file.type === 'audio'
          ? '🎵'
          : '📁';
        const kb = Math.max(1, Math.round((file.size || 0) / 1024));
        const canModify = file.path.startsWith('uploads/');

        return `
          <div class="cms-file-card">
            <div>
              <div class="cms-file-thumb">${thumbHtml}</div>
              <div class="cms-file-meta">
                <div class="cms-file-name" title="${escapeAttr(file.path)}">${escapeHtml(file.name)}</div>
                <div style="color:#5a605d;">${kb} KB • ${file.type}</div>
              </div>
            </div>
            <div class="cms-file-actions">
              ${isPickerMode ? `
                <button type="button" class="cms-btn cms-btn-primary" data-pick-file="${escapeAttr(file.path)}" style="width:100%;">
                  ✓ Vybrat tento soubor
                </button>
              ` : ''}
              ${canModify ? `
                <select class="cms-select" data-move-file="${escapeAttr(file.path)}" style="padding:0.25rem 0.4rem; font-size:0.73rem;" title="Přesunout soubor do jiné složky">
                  <option value="">📂 Přesunout do složky…</option>
                  ${uploadFoldersOnly.filter(fl => fl !== file.folder).map(fl => `
                    <option value="${escapeAttr(fl)}">→ ${escapeHtml(fl)}</option>
                  `).join('')}
                </select>
                <button type="button" class="cms-btn cms-btn-danger" data-del-file="${escapeAttr(file.path)}" style="width:100%; padding:0.25rem;">
                  🗑️ Smazat
                </button>
              ` : ''}
            </div>
          </div>
        `;
      }).join('');

      filesGridEl.querySelectorAll('[data-pick-file]').forEach(btn => {
        btn.addEventListener('click', () => {
          const pickedPath = btn.getAttribute('data-pick-file');
          modal.remove();
          onPickCallback(pickedPath);
        });
      });

      filesGridEl.querySelectorAll('[data-move-file]').forEach(sel => {
        sel.addEventListener('change', async () => {
          const fromPath = sel.getAttribute('data-move-file');
          const targetFolder = sel.value;
          if (!targetFolder) return;
          const res = await fetch('api.php?action=move_file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
            credentials: 'same-origin',
            body: JSON.stringify({ fromPath, targetFolder })
          });
          const data = await res.json();
          if (data?.ok) {
            serverFiles = data.files || serverFiles;
            serverFolders = data.folders || serverFolders;
            replaceFilePathInSiteData(fromPath, data.newPath);
            renderFolderAndFileBrowser();
            showCmsToast(`Soubor přesunut do ${targetFolder}`);
          } else {
            alert(data?.error || 'Přesun se nezdařil.');
          }
        });
      });

      filesGridEl.querySelectorAll('[data-del-file]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const relPath = btn.getAttribute('data-del-file');
          if (!confirm(`Smazat soubor „${relPath}“ z disku?`)) return;
          const res = await fetch('api.php?action=delete_file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
            credentials: 'same-origin',
            body: JSON.stringify({ path: relPath })
          });
          const data = await res.json();
          if (data?.ok) {
            serverFiles = data.files || [];
            serverFolders = data.folders || serverFolders;
            renderFolderAndFileBrowser();
          }
        });
      });
    }

    renderFolderAndFileBrowser();

    // Create subfolder on disk
    modal.querySelector('#cms-new-folder-btn')?.addEventListener('click', async () => {
      const parent = activeUploadFolder.startsWith('uploads') ? activeUploadFolder : 'uploads';
      const folderName = prompt(`Zadejte název nové podsložky uvnitř „${parent}“ (např. kroniky, portrety, 1940):`);
      if (!folderName || !folderName.trim()) return;
      const res = await fetch('api.php?action=create_folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        credentials: 'same-origin',
        body: JSON.stringify({ parentFolder: parent, folderName: folderName.trim() })
      });
      const data = await res.json();
      if (data?.ok) {
        serverFiles = data.files || serverFiles;
        serverFolders = data.folders || serverFolders;
        activeUploadFolder = data.createdFolder || activeUploadFolder;
        renderFolderAndFileBrowser();
        showCmsToast(`📁 Vytvořena složka ${activeUploadFolder}`);
      } else {
        alert(data?.error || 'Složku se nepodařilo vytvořit.');
      }
    });

    // Delete empty folder
    modal.querySelector('#cms-del-folder-btn')?.addEventListener('click', async () => {
      if (activeUploadFolder === 'uploads' || activeUploadFolder === 'uschovna') {
        alert('Kořenovou složku nelze smazat.');
        return;
      }
      if (!confirm(`Smazat prázdnou složku „${activeUploadFolder}“?`)) return;
      const res = await fetch('api.php?action=delete_folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        credentials: 'same-origin',
        body: JSON.stringify({ folderPath: activeUploadFolder })
      });
      const data = await res.json();
      if (data?.ok) {
        serverFiles = data.files || serverFiles;
        serverFolders = data.folders || serverFolders;
        activeUploadFolder = 'uploads';
        renderFolderAndFileBrowser();
        showCmsToast('Složka byla smazána.');
      } else {
        alert(data?.error || 'Složku nelze smazat.');
      }
    });

    // Direct upload into the active folder (and auto-select if in picker mode!)
    modal.querySelector('#cms-direct-upload-input')?.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;

      const targetFolder = activeUploadFolder.startsWith('uploads') ? activeUploadFolder : 'uploads';
      let lastUploadedPath = null;

      for (const file of files) {
        const fd = new FormData();
        fd.append('folder', targetFolder);
        fd.append('file', file);
        const res = await fetch(`api.php?action=upload&folder=${encodeURIComponent(targetFolder)}`, {
          method: 'POST',
          headers: { 'X-CSRF-Token': csrfToken },
          credentials: 'same-origin',
          body: fd
        });
        const data = await res.json();
        if (data?.ok) {
          serverFiles = data.files || serverFiles;
          serverFolders = data.folders || serverFolders;
          lastUploadedPath = data.path;
        } else {
          alert(data?.error || `Chyba při nahrávání ${file.name}`);
        }
      }

      renderFolderAndFileBrowser();
      if (lastUploadedPath) {
        showCmsToast(`⬆️ Nahráno do ${targetFolder}: ${lastUploadedPath.split('/').pop()}`);
        if (isPickerMode && files.length === 1) {
          modal.remove();
          onPickCallback(lastUploadedPath);
        }
      }
    });

    // Change password button
    modal.querySelector('#cms-change-pass-btn')?.addEventListener('click', async () => {
      const passInput = modal.querySelector('#cms-new-pass-input');
      const newPassword = passInput?.value.trim() || '';
      if (newPassword.length < 6) {
        alert('Nové heslo musí mít alespoň 6 znaků.');
        return;
      }
      const res = await fetch('api.php?action=change_password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        credentials: 'same-origin',
        body: JSON.stringify({ newPassword })
      });
      const data = await res.json();
      if (data?.ok) {
        passInput.value = '';
        showCmsToast('🔑 Heslo do administrace bylo úspěšně změněno.');
      } else {
        alert(data?.error || 'Změna hesla se nezdařila.');
      }
    });
  }

  function replaceFilePathInSiteData(oldPath, newPath) {
    if (!oldPath || !newPath) return;
    const raw = JSON.stringify(SITE_DATA);
    const updated = raw.split(JSON.stringify(oldPath)).join(JSON.stringify(newPath));
    if (updated !== raw) {
      Object.assign(SITE_DATA, JSON.parse(updated));
      markDirty(true);
      if (typeof window.refreshPageView === 'function') window.refreshPageView();
    }
  }

  // ==========================================================================
  // Helpers: Modal Builder, Nested PageText Getter/Setter, Toast, Escape
  // ==========================================================================
  function createCmsModal(title, bodyHtml, footerHtml, sizeClass = '') {
    const backdrop = document.createElement('div');
    backdrop.className = 'cms-modal-backdrop open';
    backdrop.setAttribute('data-ui-panel', 'true');
    backdrop.innerHTML = `
      <div class="cms-modal-card ${sizeClass}">
        <div class="cms-modal-header">
          <h3>${title}</h3>
          <button type="button" class="cms-modal-close" data-close-modal title="Zavřít">✕</button>
        </div>
        <div class="cms-modal-body">${bodyHtml}</div>
        <div class="cms-modal-footer">${footerHtml}</div>
      </div>
    `;
    document.body.appendChild(backdrop);

    backdrop.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', () => backdrop.remove());
    });
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.remove();
    });
    return backdrop;
  }

  function getNestedPageText(keyPath) {
    if (!SITE_DATA.pageText || !keyPath) return '';
    return keyPath.split('.').reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), SITE_DATA.pageText);
  }

  function setNestedPageText(keyPath, value) {
    if (!keyPath) return;
    if (!SITE_DATA.pageText) SITE_DATA.pageText = {};
    const parts = keyPath.split('.');
    let curr = SITE_DATA.pageText;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!curr[parts[i]] || typeof curr[parts[i]] !== 'object') {
        curr[parts[i]] = {};
      }
      curr = curr[parts[i]];
    }
    curr[parts[parts.length - 1]] = value;
  }

  function showCmsToast(message) {
    document.querySelectorAll('.cms-toast').forEach(t => t.remove());
    const toast = document.createElement('div');
    toast.className = 'cms-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3400);
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;');
  }
})();
