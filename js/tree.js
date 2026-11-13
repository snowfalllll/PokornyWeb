document.addEventListener('DOMContentLoaded', () => {
  applyTreeGlobalCmsText();
  initGenealogyTreePage();
});

function applyTreeGlobalCmsText() {
  if (!SITE_DATA.pageText) return;
  document.querySelectorAll('[data-cms]').forEach(el => {
    const keyPath = el.getAttribute('data-cms');
    const val = keyPath.split('.').reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), SITE_DATA.pageText);
    if (typeof val === 'string' && val.trim() !== '') {
      el.textContent = val;
    }
  });
}

// Flat map of all people by id for quick lookup when opening overlay modal
const PERSON_MAP = new Map();

function indexFamilyTree(node) {
  if (!node) return;
  PERSON_MAP.set(node.id, node);
  if (node.spouse) {
    PERSON_MAP.set(node.spouse.id, node.spouse);
  }
  if (Array.isArray(node.children)) {
    node.children.forEach(child => indexFamilyTree(child));
  }
}

function initGenealogyTreePage() {
  const rootEl = document.getElementById('genealogy-root');
  if (!rootEl || !SITE_DATA.familyTree || !SITE_DATA.familyTree.treeRoot) return;

  indexFamilyTree(SITE_DATA.familyTree.treeRoot);

  rootEl.innerHTML = `<ul class="org-ul root-ul">${renderTreeNode(SITE_DATA.familyTree.treeRoot)}</ul>`;

  // Wire up click on each person card to open the overlay modal
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

  setupTreeModalEvents();
  const panZoomApi = setupCanvasPanAndZoom();

  // Check if navigated with ?person=<id> from Historie lékárny or Václav Pokorný pages
  const params = new URLSearchParams(window.location.search);
  const targetPersonId = params.get('person');
  if (targetPersonId && PERSON_MAP.has(targetPersonId)) {
    setTimeout(() => {
      const cardEl = document.getElementById(`person-${targetPersonId}`);
      if (cardEl) {
        cardEl.classList.add('selected-person-card');
        panZoomApi.focusOnElement(cardEl);
      }
      openPersonOverlayModal(PERSON_MAP.get(targetPersonId));
    }, 180);
  }
}

function renderPersonCard(member) {
  const quickDates = member.deathDate && member.deathDate !== '—'
    ? `${member.birthDate} &bull; ${member.deathDate}`
    : `${member.birthDate}`;

  return `
    <article class="tree-person-card branch-${member.branch}" id="person-${member.id}" data-person-id="${member.id}">
      <button type="button" class="tree-person-trigger" title="Zobrazit detail osobnosti: ${member.name}">
        <div class="tree-person-summary">
          <div class="tree-person-role-tag">${member.role}</div>
          <div class="tree-person-name">${member.name}</div>
          <div class="tree-person-quickdates">${quickDates}</div>
        </div>
        <span class="tree-expand-badge" title="Otevřít medailonek">↗</span>
      </button>
    </article>
  `;
}

function renderTreeNode(node) {
  const hasSpouse = Boolean(node.spouse);
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;

  const nodeGroupHtml = hasSpouse
    ? `
      <div class="tree-couple-group">
        ${renderPersonCard(node)}
        <div class="tree-couple-ring" title="Manželský svazek">⚭</div>
        ${renderPersonCard(node.spouse)}
      </div>
    `
    : `<div class="tree-single-group">${renderPersonCard(node)}</div>`;

  const childrenHtml = hasChildren
    ? `<ul class="org-ul">${node.children.map(child => renderTreeNode(child)).join('')}</ul>`
    : '';

  return `
    <li class="org-li">
      ${nodeGroupHtml}
      ${childrenHtml}
    </li>
  `;
}

// ==========================================================================
// Person Overlay Modal: Left = Photo Carousel (Samsung Gallery style), Right = Title, Dates, Bio
// ==========================================================================
function openPersonOverlayModal(member) {
  const backdrop = document.getElementById('universal-modal');
  const leftPane = document.getElementById('modal-left-pane');
  const rightPane = document.getElementById('modal-right-pane');
  if (!backdrop || !leftPane || !rightPane) return;

  // Highlight active card on tree
  document.querySelectorAll('.tree-person-card').forEach(c => {
    c.classList.toggle('selected-person-card', c.getAttribute('data-person-id') === member.id);
  });

  const photos = Array.isArray(member.photos) && member.photos.length > 0
    ? member.photos
    : [{ url: member.photo || null, caption: member.photoCaption || member.name }];

  // Left: Photo Carousel
  leftPane.className = 'modal-left-pane modal-pane-media';
  leftPane.innerHTML = buildPersonCarouselHtml(photos, member.name);
  wirePersonCarousel(leftPane, photos);

  // Build links to children or spouse if present
  const relationsHtml = buildPersonRelationsHtml(member);

  // Clean role string so generation isn't duplicated (e.g. "5. generace • Lékárník a vlastivědec")
  const cleanProfession = (member.role || '').replace(/^\d+\.\s*gen\.\s*•\s*/i, '').trim();
  const roleHeader = cleanProfession
    ? `${member.gen}. generace • ${cleanProfession}`
    : `${member.gen}. generace`;

  // Right: Title, Role, Dates, Description, Related Links
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
        <p>${member.description}</p>
      </div>

      ${relationsHtml}
    </div>
    <div class="modal-footer-bar">
      ${member.id === 'vaclav-6' ? `<a href="vaclav-pokorny.html" class="btn btn-outline-dark">Podstránka Václava Pokorného →</a>` : ''}
      ${member.branch === 'pharmacist' ? `<a href="historie-lekarny.html" class="btn btn-outline-dark">Historie lékárny →</a>` : ''}
      <button type="button" class="btn btn-primary modal-close-action">Zavřít medailonek</button>
    </div>
  `;

  // Wire up related person buttons inside modal
  rightPane.querySelectorAll('[data-jump-person]').forEach(btn => {
    btn.addEventListener('click', () => {
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

function buildPersonRelationsHtml(member) {
  const pills = [];
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
        <div class="samsung-caption-title">${first.caption || fallbackTitle}</div>
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
      <div class="samsung-placeholder-caption">${photo.caption || 'Portrétní fotografie'}</div>
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
      captionBar.innerHTML = `<div class="samsung-caption-title">${current.caption || ''}</div>`;
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

// ==========================================================================
// Canvas Pan & Zoom Setup (Sharp 2D Transform to avoid blurry text on zoom)
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
  let scale = 0.88;
  const MIN_SCALE = 0.35;
  const MAX_SCALE = 2.0;

  let edgeVelX = 0;
  let edgeVelY = 0;
  let isOverUiPanel = false;
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;

  function applyTransform() {
    // Use 2D translate + zoom/scale without will-change 3D texture caching so text stays crisp
    canvas.style.transform = `translate(${Math.round(panX)}px, ${Math.round(panY)}px) scale(${scale})`;
    if (zoomReadout) {
      zoomReadout.textContent = `${Math.round(scale * 100)} %`;
    }
  }

  function centerTree() {
    scale = 0.88;
    canvas.style.transform = 'translate(0px, 0px) scale(1)';
    const treeEl = document.getElementById('genealogy-root');
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const treeWidth = treeEl.offsetWidth;
    const treeHeight = treeEl.offsetHeight;

    panX = (vw - treeWidth * scale) / 2;
    if (treeHeight * scale < vh - 100) {
      panY = (vh - treeHeight * scale) / 2 + 12;
    } else {
      panY = 48;
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
    const modalOpen = document.getElementById('universal-modal')?.classList.contains('open');
    if (modalOpen) {
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

    if (isOverUiPanel) {
      clearEdgeVelocities();
      return;
    }

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const x = e.clientX;
    const y = e.clientY;

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

    if (y > 46 && y < 46 + EDGE_THRESHOLD) {
      const intensity = 1 - (y - 46) / EDGE_THRESHOLD;
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
    if (!isDragging && (edgeVelX !== 0 || edgeVelY !== 0)) {
      panX += edgeVelX;
      panY += edgeVelY;
      applyTransform();
    }
    requestAnimationFrame(edgePanLoop);
  }
  requestAnimationFrame(edgePanLoop);

  viewport.addEventListener('mousedown', (e) => {
    if (e.target.closest('.tree-person-trigger') || e.target.closest('[data-ui-panel="true"]')) {
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
  document.getElementById('btn-center-tree')?.addEventListener('click', () => centerTree());

  requestAnimationFrame(() => {
    centerTree();
  });

  return { centerTree, focusOnElement };
}
