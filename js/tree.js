document.addEventListener('DOMContentLoaded', () => {
  initGenealogyTreePage();
});

function initGenealogyTreePage() {
  const rootEl = document.getElementById('genealogy-root');
  if (!rootEl || !SITE_DATA.familyTree || !SITE_DATA.familyTree.treeRoot) return;

  rootEl.innerHTML = `<ul class="org-ul root-ul">${renderTreeNode(SITE_DATA.familyTree.treeRoot)}</ul>`;

  // Wire up click-to-expand on each person card
  rootEl.querySelectorAll('.tree-person-card').forEach(card => {
    const trigger = card.querySelector('.tree-person-trigger');
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isExpanded = card.classList.toggle('expanded');
      trigger.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    });
  });

  setupCanvasPanAndZoom();
}

function renderPersonCard(member) {
  const quickDates = member.deathDate && member.deathDate !== '—'
    ? `${member.birthDate} &bull; ${member.deathDate}`
    : `${member.birthDate}`;

  const photoHtml = member.photo
    ? `<img src="${member.photo}" alt="${member.name}" />`
    : `
      <div class="tree-photo-silhouette" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
      </div>
      <div class="tree-photo-label">[ Portrétní foto ]</div>
      <div class="tree-photo-caption">${member.photoCaption || 'Místo pro fotografii'}</div>
    `;

  return `
    <article class="tree-person-card branch-${member.branch}" id="person-${member.id}" data-person-id="${member.id}">
      <button type="button" class="tree-person-trigger" aria-expanded="false">
        <div class="tree-person-summary">
          <div class="tree-person-role-tag">${member.role}</div>
          <div class="tree-person-name">${member.name}</div>
          <div class="tree-person-quickdates">${quickDates}</div>
        </div>
        <span class="tree-expand-badge" title="Rozbalit / Sbalit kartu">▾</span>
      </button>

      <div class="tree-person-details">
        <div class="tree-details-inner">
          <div class="tree-photo-frame">
            ${photoHtml}
          </div>
          <div class="tree-info-col">
            <div>
              <div class="tree-person-role-tag">${member.gen}. generace rodu</div>
              <h4 class="tree-detail-heading">${member.name}</h4>
            </div>
            <div class="tree-dates-grid">
              <div class="tree-date-box">
                <span class="tree-date-label">Narození</span>
                <span class="tree-date-value">${member.birthDate}</span>
              </div>
              <div class="tree-date-box">
                <span class="tree-date-label">Úmrtí</span>
                <span class="tree-date-value">${member.deathDate}</span>
              </div>
            </div>
            <div class="tree-bio-box">
              <span class="tree-bio-label">Životopis a popis</span>
              <p>${member.description}</p>
            </div>
          </div>
        </div>
      </div>
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

  // Edge panning velocity state
  let edgeVelX = 0;
  let edgeVelY = 0;
  let isOverUiPanel = false;
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;

  function applyTransform() {
    canvas.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${scale})`;
    if (zoomReadout) {
      zoomReadout.textContent = `${Math.round(scale * 100)} %`;
    }
  }

  function centerTree() {
    scale = 0.88;
    // Reset temporarily to measure natural dimensions
    canvas.style.transform = 'translate3d(0px, 0px, 0) scale(1)';
    const treeEl = document.getElementById('genealogy-root');
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const treeWidth = treeEl.offsetWidth;
    const treeHeight = treeEl.offsetHeight;

    panX = (vw - treeWidth * scale) / 2;
    // Center vertically if it fits, otherwise position nicely with top clearance for HUD
    if (treeHeight * scale < vh - 120) {
      panY = (vh - treeHeight * scale) / 2 + 24;
    } else {
      panY = 88;
    }
    applyTransform();
  }

  function zoomBy(deltaFactor, focalX = window.innerWidth / 2, focalY = window.innerHeight / 2) {
    const prevScale = scale;
    scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * deltaFactor));
    const ratio = scale / prevScale;

    // Keep the focal point stationary while zooming
    panX = focalX - (focalX - panX) * ratio;
    panY = focalY - (focalY - panY) * ratio;
    applyTransform();
  }

  // Prevent edge panning when hovering over floating HUD panels
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

  // Edge-of-screen mouse detection
  const EDGE_THRESHOLD = 80; // px from screen border
  const MAX_PAN_SPEED = 11;  // px per frame

  window.addEventListener('mousemove', (e) => {
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

    // Horizontal edge check
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

    // Vertical edge check
    if (y < EDGE_THRESHOLD) {
      const intensity = 1 - y / EDGE_THRESHOLD;
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

  // Animation loop for smooth continuous edge panning
  function edgePanLoop() {
    if (!isDragging && (edgeVelX !== 0 || edgeVelY !== 0)) {
      panX += edgeVelX;
      panY += edgeVelY;
      applyTransform();
    }
    requestAnimationFrame(edgePanLoop);
  }
  requestAnimationFrame(edgePanLoop);

  // Also allow direct click-and-drag panning on the canvas
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

  // Mouse wheel zoom
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    zoomBy(factor, e.clientX, e.clientY);
  }, { passive: false });

  // Corner buttons
  document.getElementById('btn-zoom-in')?.addEventListener('click', () => zoomBy(1.18));
  document.getElementById('btn-zoom-out')?.addEventListener('click', () => zoomBy(1 / 1.18));
  document.getElementById('btn-center-tree')?.addEventListener('click', () => centerTree());

  document.getElementById('btn-expand-all')?.addEventListener('click', () => {
    document.querySelectorAll('.tree-person-card').forEach(card => {
      card.classList.add('expanded');
      card.querySelector('.tree-person-trigger')?.setAttribute('aria-expanded', 'true');
    });
  });

  document.getElementById('btn-collapse-all')?.addEventListener('click', () => {
    document.querySelectorAll('.tree-person-card').forEach(card => {
      card.classList.remove('expanded');
      card.querySelector('.tree-person-trigger')?.setAttribute('aria-expanded', 'false');
    });
  });

  // Center on load and window resize
  requestAnimationFrame(() => {
    centerTree();
  });
}
