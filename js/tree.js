document.addEventListener('DOMContentLoaded', () => {
  applyTreeCmsDraftPreviewIfActive();
  setupTreeModalEvents();
  window.treePanZoomApi = setupCanvasPanAndZoom();
  refreshPageView();
  bootstrapAuthenticatedTreeCmsIfRequested();
});

async function bootstrapAuthenticatedTreeCmsIfRequested() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('cms') === '0') {
    sessionStorage.removeItem('pokorny_cms_mode');
    return;
  }
  const isCmsRequested = params.get('cms') === '1' || sessionStorage.getItem('pokorny_cms_mode') === '1';
  if (!isCmsRequested) return;

  try {
    const res = await fetch('api.php?action=status', { credentials: 'same-origin' });
    const data = await res.json();
    if (data && data.authenticated) {
      sessionStorage.setItem('pokorny_cms_mode', '1');
      window.__POKORNY_CMS_INIT_STATUS__ = data;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'api.php?action=admin_css';
      document.head.appendChild(link);

      const script = document.createElement('script');
      script.src = 'api.php?action=admin_bundle';
      document.body.appendChild(script);
    } else {
      sessionStorage.removeItem('pokorny_cms_mode');
      const pageName = window.location.pathname.split('/').pop() || 'rodokmen.html';
      window.location.replace(`admin.html?return=${encodeURIComponent(pageName)}`);
    }
  } catch (e) {
    sessionStorage.removeItem('pokorny_cms_mode');
    const pageName = window.location.pathname.split('/').pop() || 'rodokmen.html';
    window.location.replace(`admin.html?return=${encodeURIComponent(pageName)}`);
  }
}

const PERSON_MAP = new Map();
let panZoomController = null;

window.refreshPageView = function refreshPageView() {
  applyTreeGlobalCmsText();
  renderGenealogyTreeDom();
  if (typeof window.onCmsAfterPageRender === 'function') {
    window.onCmsAfterPageRender();
  }
};

function applyTreeCmsDraftPreviewIfActive() {
  const params = new URLSearchParams(window.location.search);
  const isCmsMode = params.get('cms') === '1' || sessionStorage.getItem('pokorny_cms_mode') === '1';
  const isPreviewUrl = params.get('cms_preview') === '1';
  const isPreviewSession = sessionStorage.getItem('pokorny_cms_preview_active') === '1';

  if (!isCmsMode && !isPreviewUrl && !isPreviewSession) return;

  try {
    const rawDraft = localStorage.getItem('pokorny_cms_draft_data');
    if (rawDraft) {
      const parsedDraft = JSON.parse(rawDraft);
      if (parsedDraft && typeof parsedDraft === 'object') {
        Object.assign(SITE_DATA, parsedDraft);
      }
    }
  } catch (e) {}
}

function applyTreeGlobalCmsText() {
  if (!SITE_DATA.pageText) return;
  document.querySelectorAll('[data-cms]').forEach(el => {
    const keyPath = el.getAttribute('data-cms');
    const val = keyPath.split('.').reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), SITE_DATA.pageText);
    if (typeof val === 'string' && val.trim() !== '') {
      el.setAttribute('data-raw-text', val);
      el.textContent = val;
    }
  });
}

// ==========================================================================
// Linkify helper for Tree Descriptions (Markdown links + Family Member links)
// ==========================================================================
function looksLikeUrlTree(str) {
  const s = String(str || '').trim();
  return /^(https?:\/\/|mailto:|www\.|[a-z0-9-]+\.(cz|com|org|eu|net|info|edu|gov)(\/|$)|\S+\.html\b)/i.test(s);
}

function normalizeHrefTree(rawUrl) {
  const s = String(rawUrl || '').trim();
  if (/^www\./i.test(s)) return 'https://' + s;
  if (/^[a-z0-9-]+\.(cz|com|org|eu|net|info|edu|gov)(\/|$)/i.test(s) && !/^https?:\/\//i.test(s)) {
    return 'https://' + s;
  }
  return s;
}

function linkifyTreeText(text, currentPersonId = null) {
  if (!text) return '';
  let processed = String(text);

  if (processed.includes('person-inline-link')) {
    processed = processed.replace(/<a\b[^>]*class="[^"]*person-inline-link[^"]*"[^>]*>(.*?)<\/a>/gi, '$1');
  }

  const placeholders = [];

  // 1. Markdown links: both [www.e.com](E site) and [E site](https://www.e.com)
  processed = processed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (full, partA, partB) => {
    let urlPart = partB.trim();
    let labelPart = partA.trim();
    if (looksLikeUrlTree(partA) && !looksLikeUrlTree(partB)) {
      urlPart = partA.trim();
      labelPart = partB.trim();
    }
    const href = normalizeHrefTree(urlPart);
    const isExternal = /^https?:\/\//i.test(href);
    const targetAttr = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
    const token = `__TREE_LINK_${placeholders.length}__`;
    placeholders.push(`<a href="${href}" class="person-inline-link markdown-inline-link"${targetAttr}>${labelPart}</a>`);
    return token;
  });

  // 2. Family member links (jump directly inside the tree modal)
  if (Array.isArray(SITE_DATA.personLinks)) {
    const allMatchers = [];
    SITE_DATA.personLinks.forEach(entry => {
      if (entry.id === currentPersonId) return;
      if (Array.isArray(entry.patterns)) {
        entry.patterns.forEach(pattern => {
          if (pattern && pattern.trim()) {
            allMatchers.push({ pattern: pattern.trim(), id: entry.id });
          }
        });
      }
    });
    allMatchers.sort((a, b) => b.pattern.length - a.pattern.length);

    allMatchers.forEach(({ pattern, id }) => {
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'g');
      processed = processed.replace(regex, (match) => {
        const token = `__TREE_LINK_${placeholders.length}__`;
        placeholders.push(
          `<a href="#person-${id}" data-jump-person="${id}" class="person-inline-link" title="Přejít v rodokmenu na: ${match}">${match}</a>`
        );
        return token;
      });
    });
  }

  placeholders.forEach((html, idx) => {
    processed = processed.replace(`__TREE_LINK_${idx}__`, html);
  });

  return processed;
}
window.linkifyTreeText = linkifyTreeText;

function indexFamilyTree(node, parentId = null) {
  if (!node) return;
  node._parentId = parentId;
  PERSON_MAP.set(node.id, node);
  if (node.spouse) {
    node.spouse._isSpouseOf = node.id;
    PERSON_MAP.set(node.spouse.id, node.spouse);
  }
  if (Array.isArray(node.children)) {
    node.children.forEach(child => indexFamilyTree(child, node.id));
  }
}

function renderGenealogyTreeDom() {
  const rootEl = document.getElementById('genealogy-root');
  if (!rootEl || !SITE_DATA.familyTree || !SITE_DATA.familyTree.treeRoot) return;

  PERSON_MAP.clear();
  indexFamilyTree(SITE_DATA.familyTree.treeRoot, null);

  // Also render any detached/unconnected nodes in SITE_DATA.familyTree.detachedNodes if created in CMS flowchart mode
  const detached = Array.isArray(SITE_DATA.familyTree.detachedNodes) ? SITE_DATA.familyTree.detachedNodes : [];
  detached.forEach(d => indexFamilyTree(d, null));

  const detachedHtml = detached.length > 0
    ? `
      <div class="tree-detached-tray" id="tree-detached-tray">
        <div class="tree-detached-title">Nezařazené osobnosti (přetáhněte bod nahoře pod rodiče nebo k partnerovi):</div>
        <ul class="org-ul root-ul detached-ul">
          ${detached.map(node => renderTreeNode(node, true)).join('')}
        </ul>
      </div>
    `
    : '';

  rootEl.innerHTML = `
    <svg id="cms-flowchart-svg" class="cms-flowchart-svg" aria-hidden="true"></svg>
    <ul class="org-ul root-ul">${renderTreeNode(SITE_DATA.familyTree.treeRoot, false)}</ul>
    ${detachedHtml}
  `;

  rootEl.querySelectorAll('.tree-person-card').forEach(card => {
    const trigger = card.querySelector('.tree-person-trigger');
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const personId = card.getAttribute('data-person-id');
      const member = PERSON_MAP.get(personId);
      if (member) {
        openPersonOverlayModal(member);
      }
    });
  });

  // Check if navigated with ?person=<id>
  const params = new URLSearchParams(window.location.search);
  const targetPersonId = params.get('person');
  if (targetPersonId && PERSON_MAP.has(targetPersonId) && !window._initialPersonHandled) {
    window._initialPersonHandled = true;
    setTimeout(() => {
      const cardEl = document.getElementById(`person-${targetPersonId}`);
      if (cardEl && window.treePanZoomApi) {
        cardEl.classList.add('selected-person-card');
        window.treePanZoomApi.focusOnElement(cardEl);
      }
      openPersonOverlayModal(PERSON_MAP.get(targetPersonId));
    }, 180);
  }
}

function renderPersonCard(member, isDetached = false) {
  const quickDates = member.deathDate && member.deathDate !== '—'
    ? `${member.birthDate} &bull; ${member.deathDate}`
    : `${member.birthDate}`;

  const offsetStyle = (member.cmsOffsetX || member.cmsOffsetY)
    ? `style="transform: translate(${Math.round(member.cmsOffsetX || 0)}px, ${Math.round(member.cmsOffsetY || 0)}px);" data-offset-x="${member.cmsOffsetX || 0}" data-offset-y="${member.cmsOffsetY || 0}"`
    : '';

  return `
    <article class="tree-person-card branch-${member.branch || 'family'} ${isDetached ? 'is-detached-card' : ''}" id="person-${member.id}" data-person-id="${member.id}" ${offsetStyle}>
      <!-- Top connector port (Child Input / Detach from parent) -->
      <div class="cms-tree-port cms-port-top" data-port="top" data-person-id="${member.id}" title="Horní bod (napojení na rodiče – kliknutím odpojíte)"></div>

      <!-- Side connector port (Spouse link) -->
      <div class="cms-tree-port cms-port-spouse" data-port="spouse" data-person-id="${member.id}" title="Partnerský bod (přetáhněte na kartu partnera)">⚭</div>

      <button type="button" class="tree-person-trigger" title="Zobrazit detail osobnosti: ${member.name}">
        <div class="tree-person-summary">
          <div class="tree-person-role-tag">${member.role || `${member.gen || ''}. gen.`}</div>
          <div class="tree-person-name">${member.name}</div>
          <div class="tree-person-quickdates">${quickDates}</div>
        </div>
        <span class="tree-expand-badge" title="Otevřít medailonek">↗</span>
      </button>

      <!-- Bottom connector port (Parent Output -> Drag to child's top port) -->
      <div class="cms-tree-port cms-port-bottom" data-port="bottom" data-person-id="${member.id}" title="Spodní bod rodiče (přetáhněte na horní bod dítěte)"></div>
    </article>
  `;
}

function renderTreeNode(node, isDetached = false) {
  const hasSpouse = Boolean(node.spouse);
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;

  const nodeGroupHtml = hasSpouse
    ? `
      <div class="tree-couple-group">
        ${renderPersonCard(node, isDetached)}
        <div class="tree-couple-ring" data-spouse-ring="${node.id}" title="Manželský svazek (v CMS kliknutím rozpojíte)">⚭</div>
        ${renderPersonCard(node.spouse, false)}
      </div>
    `
    : `<div class="tree-single-group">${renderPersonCard(node, isDetached)}</div>`;

  const childrenHtml = hasChildren
    ? `<ul class="org-ul">${node.children.map(child => renderTreeNode(child, false)).join('')}</ul>`
    : '';

  return `
    <li class="org-li" data-node-li="${node.id}">
      ${nodeGroupHtml}
      ${childrenHtml}
    </li>
  `;
}

// ==========================================================================
// Person Overlay Modal: Left = Photo Carousel, Right = Title, Dates, Bio
// ==========================================================================
function openPersonOverlayModal(member) {
  const backdrop = document.getElementById('universal-modal');
  const leftPane = document.getElementById('modal-left-pane');
  const rightPane = document.getElementById('modal-right-pane');
  if (!backdrop || !leftPane || !rightPane) return;

  document.querySelectorAll('.tree-person-card').forEach(c => {
    c.classList.toggle('selected-person-card', c.getAttribute('data-person-id') === member.id);
  });

  const photos = Array.isArray(member.photos) && member.photos.length > 0
    ? member.photos
    : [{ url: member.photo || null, caption: member.photoCaption || member.name }];

  leftPane.className = 'modal-left-pane modal-pane-media';
  leftPane.innerHTML = buildPersonCarouselHtml(photos, member.name);
  wirePersonCarousel(leftPane, photos);

  const relationsHtml = buildPersonRelationsHtml(member);
  const cleanProfession = (member.role || '').replace(/^\d+\.\s*gen\.\s*•\s*/i, '').trim();
  const roleHeader = cleanProfession
    ? `${member.gen}. generace • ${cleanProfession}`
    : `${member.gen}. generace`;

  rightPane.className = 'modal-right-pane modal-pane-details';
  rightPane.innerHTML = `
    <div class="modal-details-content">
      <div class="archive-meta">${roleHeader}</div>
      <h2 class="modal-main-title">${member.name}</h2>

      <div class="tree-dates-grid" style="margin: 1rem 0;">
        <div class="tree-date-box">
          <span class="tree-date-label">Narození</span>
          <span class="tree-date-value">${member.birthDate || '—'}</span>
        </div>
        <div class="tree-date-box">
          <span class="tree-date-label">Úmrtí</span>
          <span class="tree-date-value">${member.deathDate || '—'}</span>
        </div>
      </div>

      <div class="tree-bio-box tree-bio-expanded">
        <span class="tree-bio-label">Životopis a působení</span>
        <p>${linkifyTreeText(member.description, member.id)}</p>
      </div>

      ${relationsHtml}
    </div>
    <div class="modal-footer-bar">
      ${member.id === 'vaclav-6' ? `<a href="vaclav-pokorny.html" class="btn btn-outline-dark">Podstránka Václava Pokorného →</a>` : ''}
      ${member.branch === 'pharmacist' ? `<a href="historie-lekarny.html" class="btn btn-outline-dark">Historie lékárny →</a>` : ''}
      <button type="button" class="btn btn-primary modal-close-action">Zavřít medailonek</button>
    </div>
  `;

  rightPane.querySelectorAll('[data-jump-person]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = btn.getAttribute('data-jump-person');
      const nextPerson = PERSON_MAP.get(targetId);
      if (nextPerson) {
        openPersonOverlayModal(nextPerson);
      }
    });
  });

  rightPane.querySelector('.modal-close-action')?.addEventListener('click', closePersonModal);

  backdrop.classList.add('open');
  backdrop.setAttribute('aria-hidden', 'false');
}
window.openPersonOverlayModal = openPersonOverlayModal;
window.PERSON_MAP = PERSON_MAP;

function buildPersonRelationsHtml(member) {
  const pills = [];
  if (member._parentId && PERSON_MAP.has(member._parentId)) {
    const p = PERSON_MAP.get(member._parentId);
    pills.push(`<button type="button" class="relation-pill" data-jump-person="${p.id}">↑ Rodič: ${p.name}</button>`);
  }
  if (member._isSpouseOf && PERSON_MAP.has(member._isSpouseOf)) {
    const sp = PERSON_MAP.get(member._isSpouseOf);
    pills.push(`<button type="button" class="relation-pill" data-jump-person="${sp.id}">⚭ ${sp.name}</button>`);
  }
  if (member.spouse) {
    pills.push(`<button type="button" class="relation-pill" data-jump-person="${member.spouse.id}">⚭ ${member.spouse.name}</button>`);
  }
  if (Array.isArray(member.children) && member.children.length > 0) {
    member.children.forEach(ch => {
      pills.push(`<button type="button" class="relation-pill" data-jump-person="${ch.id}">↳ ${ch.name}</button>`);
    });
  }
  if (pills.length === 0) return '';
  return `
    <div class="person-relations-box">
      <div class="tree-date-label" style="margin-bottom:0.4rem;">Rodinné vazby (kliknutím přejdete):</div>
      <div class="relation-pills-wrap">${pills.join('')}</div>
    </div>
  `;
}

function buildPersonCarouselHtml(photos, fallbackTitle) {
  const first = photos[0] || { url: null, caption: fallbackTitle };
  return `
    <div class="samsung-gallery-viewer">
      <div class="samsung-main-stage">
        <button type="button" class="samsung-stage-nav prev" title="Předchozí fotografie">‹</button>
        <div class="samsung-main-display" id="samsung-main-display">
          ${renderPersonPhotoSlide(first, 0, photos.length)}
        </div>
        <button type="button" class="samsung-stage-nav next" title="Další fotografie">›</button>
      </div>
      <div class="samsung-caption-bar" id="samsung-caption-bar">
        <div class="samsung-caption-title">${linkifyTreeText(first.caption || fallbackTitle)}</div>
      </div>
      <div class="samsung-filmstrip" id="samsung-filmstrip">
        ${photos.map((p, idx) => `
          <button type="button" class="samsung-thumb ${idx === 0 ? 'active' : ''}" data-idx="${idx}" title="${p.caption || `Foto ${idx + 1}`}">
            ${p.url
              ? `<img src="${p.url}" alt="${p.caption || ''}" />`
              : `<span class="samsung-thumb-placeholder">👤 ${idx + 1}</span>`
            }
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

function renderPersonPhotoSlide(photo, idx, total) {
  if (photo.url) {
    return `<img src="${photo.url}" alt="${photo.caption || ''}" class="samsung-main-img" />`;
  }
  return `
    <div class="samsung-placeholder-art">
      <div class="samsung-placeholder-badge">Fotografie ${idx + 1} z ${total}</div>
      <div class="samsung-placeholder-icon">👤</div>
      <div class="samsung-placeholder-caption">${linkifyTreeText(photo.caption || 'Portrétní fotografie')}</div>
    </div>
  `;
}

function wirePersonCarousel(container, photos) {
  if (!photos || photos.length === 0) return;
  let activeIndex = 0;

  const mainDisplay = container.querySelector('#samsung-main-display');
  const captionBar = container.querySelector('#samsung-caption-bar');
  const thumbs = container.querySelectorAll('.samsung-thumb');
  const prevBtn = container.querySelector('.samsung-stage-nav.prev');
  const nextBtn = container.querySelector('.samsung-stage-nav.next');

  function updateSlide(newIndex) {
    activeIndex = (newIndex + photos.length) % photos.length;
    const current = photos[activeIndex];
    if (mainDisplay) {
      mainDisplay.innerHTML = renderPersonPhotoSlide(current, activeIndex, photos.length);
    }
    if (captionBar) {
      captionBar.innerHTML = `<div class="samsung-caption-title">${linkifyTreeText(current.caption || '')}</div>`;
    }
    thumbs.forEach((t, idx) => t.classList.toggle('active', idx === activeIndex));
  }

  thumbs.forEach(thumb => {
    thumb.addEventListener('click', () => {
      const idx = parseInt(thumb.getAttribute('data-idx'), 10);
      updateSlide(idx);
    });
  });

  prevBtn?.addEventListener('click', () => updateSlide(activeIndex - 1));
  nextBtn?.addEventListener('click', () => updateSlide(activeIndex + 1));
}

function setupTreeModalEvents() {
  const backdrop = document.getElementById('universal-modal');
  const closeTop = document.getElementById('modal-close-top');
  if (!backdrop) return;

  closeTop?.addEventListener('click', closePersonModal);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closePersonModal();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && backdrop.classList.contains('open')) {
      closePersonModal();
    }
  });
}

function closePersonModal() {
  const backdrop = document.getElementById('universal-modal');
  if (!backdrop) return;
  backdrop.classList.remove('open');
  backdrop.setAttribute('aria-hidden', 'true');
}
window.closePersonModal = closePersonModal;

// ==========================================================================
// Canvas Pan & Zoom Setup (Auto-fits & centers tree)
// ==========================================================================
function setupCanvasPanAndZoom() {
  const viewport = document.getElementById('tree-viewport');
  const canvas = document.getElementById('tree-canvas');
  const zoomReadout = document.getElementById('zoom-readout');

  const edgeTop = document.getElementById('edge-top');
  const edgeBottom = document.getElementById('edge-bottom');
  const edgeLeft = document.getElementById('edge-left');
  const edgeRight = document.getElementById('edge-right');

  let panX = 0;
  let panY = 0;
  let scale = 0.82;
  const MIN_SCALE = 0.25;
  const MAX_SCALE = 2.0;

  let edgeVelX = 0;
  let edgeVelY = 0;
  let isOverUiPanel = false;
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;

  function applyTransform() {
    canvas.style.transform = `translate(${Math.round(panX)}px, ${Math.round(panY)}px) scale(${scale})`;
    if (zoomReadout) {
      zoomReadout.textContent = `${Math.round(scale * 100)} %`;
    }
  }

  function centerTree(autoFitAll = true) {
    canvas.style.transform = 'translate(0px, 0px) scale(1)';
    const treeEl = document.getElementById('genealogy-root');
    if (!treeEl) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight - 60;
    const treeWidth = treeEl.offsetWidth + 120;
    const treeHeight = treeEl.offsetHeight + 100;

    if (autoFitAll && treeWidth > 0 && treeHeight > 0) {
      const fitW = vw / treeWidth;
      const fitH = vh / treeHeight;
      scale = Math.min(0.92, Math.max(0.42, Math.min(fitW, fitH * 1.15)));
    } else {
      scale = 0.82;
    }

    panX = (vw - treeEl.offsetWidth * scale) / 2;
    if (treeEl.offsetHeight * scale < vh - 80) {
      panY = (vh - treeEl.offsetHeight * scale) / 2 + 12;
    } else {
      panY = 36;
    }
    applyTransform();
  }

  function focusOnElement(el) {
    if (!el) return;
    canvas.style.transform = 'translate(0px, 0px) scale(1)';
    const rect = el.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const relX = rect.left - canvasRect.left + rect.width / 2;
    const relY = rect.top - canvasRect.top + rect.height / 2;

    scale = 1.0;
    panX = window.innerWidth / 2 - relX * scale;
    panY = window.innerHeight / 2 - relY * scale;
    applyTransform();
  }

  function zoomBy(deltaFactor, focalX = window.innerWidth / 2, focalY = window.innerHeight / 2) {
    const prevScale = scale;
    scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * deltaFactor));
    const ratio = scale / prevScale;

    panX = focalX - (focalX - panX) * ratio;
    panY = focalY - (focalY - panY) * ratio;
    applyTransform();
  }

  document.querySelectorAll('[data-ui-panel="true"]').forEach(panel => {
    panel.addEventListener('mouseenter', () => {
      isOverUiPanel = true;
      clearEdgeVelocities();
    });
    panel.addEventListener('mouseleave', () => {
      isOverUiPanel = false;
    });
  });

  function clearEdgeVelocities() {
    edgeVelX = 0;
    edgeVelY = 0;
    edgeTop?.classList.remove('active');
    edgeBottom?.classList.remove('active');
    edgeLeft?.classList.remove('active');
    edgeRight?.classList.remove('active');
  }

  const EDGE_THRESHOLD = 70;
  const MAX_PAN_SPEED = 10;

  window.addEventListener('mousemove', (e) => {
    const modalOpen = document.getElementById('universal-modal')?.classList.contains('open') ||
                      document.querySelector('.cms-modal-backdrop.open');
    if (modalOpen || window._cmsDraggingTreeElement) {
      clearEdgeVelocities();
      return;
    }

    if (isDragging) {
      panX = e.clientX - dragStartX;
      panY = e.clientY - dragStartY;
      applyTransform();
      clearEdgeVelocities();
      return;
    }

    if (isOverUiPanel || e.target.closest('[data-ui-panel="true"], .cms-top-bar, .cms-action-popover')) {
      clearEdgeVelocities();
      return;
    }

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const x = e.clientX;
    const y = e.clientY;
    const topSafeOffset = document.body.classList.contains('cms-visual-active') ? 102 : 52;

    if (x < EDGE_THRESHOLD) {
      const intensity = 1 - x / EDGE_THRESHOLD;
      edgeVelX = MAX_PAN_SPEED * intensity;
      edgeLeft?.classList.add('active');
      edgeRight?.classList.remove('active');
    } else if (x > vw - EDGE_THRESHOLD) {
      const intensity = 1 - (vw - x) / EDGE_THRESHOLD;
      edgeVelX = -MAX_PAN_SPEED * intensity;
      edgeRight?.classList.add('active');
      edgeLeft?.classList.remove('active');
    } else {
      edgeVelX = 0;
      edgeLeft?.classList.remove('active');
      edgeRight?.classList.remove('active');
    }

    if (y > topSafeOffset && y < topSafeOffset + EDGE_THRESHOLD) {
      const intensity = 1 - (y - topSafeOffset) / EDGE_THRESHOLD;
      edgeVelY = MAX_PAN_SPEED * intensity;
      edgeTop?.classList.add('active');
      edgeBottom?.classList.remove('active');
    } else if (y > vh - EDGE_THRESHOLD) {
      const intensity = 1 - (vh - y) / EDGE_THRESHOLD;
      edgeVelY = -MAX_PAN_SPEED * intensity;
      edgeBottom?.classList.add('active');
      edgeTop?.classList.remove('active');
    } else {
      edgeVelY = 0;
      edgeTop?.classList.remove('active');
      edgeBottom?.classList.remove('active');
    }
  });

  document.addEventListener('mouseleave', () => {
    clearEdgeVelocities();
  });

  function edgePanLoop() {
    if (!isDragging && !window._cmsDraggingTreeElement && (edgeVelX !== 0 || edgeVelY !== 0)) {
      panX += edgeVelX;
      panY += edgeVelY;
      applyTransform();
    }
    requestAnimationFrame(edgePanLoop);
  }
  requestAnimationFrame(edgePanLoop);

  viewport.addEventListener('mousedown', (e) => {
    if (e.target.closest('.tree-person-card, [data-ui-panel="true"], .cms-action-popover')) {
      return;
    }
    isDragging = true;
    dragStartX = e.clientX - panX;
    dragStartY = e.clientY - panY;
    viewport.classList.add('dragging');
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
    viewport.classList.remove('dragging');
  });

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    zoomBy(factor, e.clientX, e.clientY);
  }, { passive: false });

  document.getElementById('btn-zoom-in')?.addEventListener('click', () => zoomBy(1.18));
  document.getElementById('btn-zoom-out')?.addEventListener('click', () => zoomBy(1 / 1.18));
  document.getElementById('btn-center-tree')?.addEventListener('click', () => centerTree(true));

  requestAnimationFrame(() => {
    centerTree(true);
  });

  panZoomController = {
    centerTree,
    focusOnElement,
    getScale: () => scale,
    getPan: () => ({ panX, panY })
  };
  return panZoomController;
}
