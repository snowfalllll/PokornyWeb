document.addEventListener('DOMContentLoaded', () => {
  applyCmsDraftPreviewIfActive();
  refreshPageView();
  initUniversalModal();
  handleDeepLinkHash();
  bootstrapAuthenticatedCmsIfRequested();
});

async function bootstrapAuthenticatedCmsIfRequested() {
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
      const pageName = window.location.pathname.split('/').pop() || 'index.html';
      window.location.replace(`admin.html?return=${encodeURIComponent(pageName)}`);
    }
  } catch (e) {
    sessionStorage.removeItem('pokorny_cms_mode');
    const pageName = window.location.pathname.split('/').pop() || 'index.html';
    window.location.replace(`admin.html?return=${encodeURIComponent(pageName)}`);
  }
}

window.refreshPageView = function refreshPageView() {
  applyPageTextFromCms();
  initPriborSection();
  initMainPageTimeline();
  initFullPharmacyPage();
  initFullVaclavPage();
  initAudioPlayerPanel();
  initMediaGallery();
  if (typeof window.onCmsAfterPageRender === 'function') {
    window.onCmsAfterPageRender();
  }
};

// ==========================================================================
// -1. Live CMS Draft Sync
// ==========================================================================
function applyCmsDraftPreviewIfActive() {
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
  } catch (e) {
    console.warn('CMS draft parse error:', e);
  }
}

// ==========================================================================
// 0. Apply CMS-managed Page Titles, Subtitles, Paragraphs & Hero Images
// ==========================================================================
function getCmsValue(keyPath) {
  if (!SITE_DATA.pageText || !keyPath) return undefined;
  return keyPath.split('.').reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), SITE_DATA.pageText);
}

function applyPageTextFromCms() {
  if (!SITE_DATA.pageText) return;

  // Plain text bindings (also support markdown & people links if present in descriptions, except inside interactive <a>/<button> tags)
  document.querySelectorAll('[data-cms]').forEach(el => {
    const key = el.getAttribute('data-cms');
    const val = getCmsValue(key);
    if (typeof val === 'string' && val.trim() !== '') {
      el.setAttribute('data-raw-text', val);
      const tag = el.tagName.toLowerCase();
      // Do not inject nested <a> links inside an <a> or <button> element
      if (tag === 'a' || tag === 'button' || el.closest('a, button')) {
        el.textContent = val;
      } else {
        el.innerHTML = linkifyFamilyNames(val);
      }
    }
  });

  // Auto-linkified text bindings (paragraphs with family names & markdown links)
  document.querySelectorAll('[data-cms-linkify]').forEach(el => {
    const key = el.getAttribute('data-cms-linkify');
    const val = getCmsValue(key);
    if (typeof val === 'string' && val.trim() !== '') {
      el.setAttribute('data-raw-text', val);
      el.innerHTML = linkifyFamilyNames(val);
    }
  });

  // Hero card background images on Úvod
  document.querySelectorAll('[data-cms-bg]').forEach(el => {
    const imgUrl = getCmsValue(el.getAttribute('data-cms-bg'));
    const placeholder = el.querySelector('.hero-img-placeholder');
    if (typeof imgUrl === 'string' && imgUrl.trim() !== '') {
      el.style.backgroundImage = `url('${imgUrl}')`;
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      if (placeholder) placeholder.style.display = 'none';
    } else {
      el.style.backgroundImage = '';
      if (placeholder) placeholder.style.display = '';
    }
  });

  // Main page Václav Pokorný portrait image (if uploaded in CMS)
  const homePortrait = document.getElementById('vaclav-home-portrait');
  const portraitUrl = getCmsValue('home.vaclavPortraitImg');
  const caption = getCmsValue('home.vaclavPortraitCaption') || 'PhMr. Václav Pokorný u klavíru / v příborské lékárně';
  if (homePortrait) {
    if (typeof portraitUrl === 'string' && portraitUrl.trim() !== '') {
      homePortrait.innerHTML = `
        <img src="${portraitUrl}" alt="${caption}" style="width:100%; height:100%; max-height:420px; object-fit:cover; border-radius:6px;" />
        ${caption ? `<div class="portrait-placeholder-sub" data-cms="home.vaclavPortraitCaption" style="margin-top:0.5rem;">${caption}</div>` : ''}
      `;
    } else {
      homePortrait.innerHTML = `
        <div class="portrait-placeholder-icon">
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>
        </div>
        <div class="portrait-placeholder-title">[ Portrétní fotografie ]</div>
        <div class="portrait-placeholder-sub" data-cms="home.vaclavPortraitCaption">${caption}</div>
      `;
    }
  }
}

// ==========================================================================
// Helper: Turn Markdown links ([url](label) or [label](url)) & Family Member names into clickable links
// ==========================================================================
function looksLikeUrl(str) {
  const s = String(str || '').trim();
  return /^(https?:\/\/|mailto:|www\.|[a-z0-9-]+\.(cz|com|org|eu|net|info|edu|gov)(\/|$)|\S+\.html\b)/i.test(s);
}

function normalizeHref(rawUrl) {
  const s = String(rawUrl || '').trim();
  if (/^www\./i.test(s)) return 'https://' + s;
  if (/^[a-z0-9-]+\.(cz|com|org|eu|net|info|edu|gov)(\/|$)/i.test(s) && !/^https?:\/\//i.test(s)) {
    return 'https://' + s;
  }
  return s;
}

function linkifyFamilyNames(text) {
  if (!text) return '';
  let processed = String(text);

  // If the string already contains generated person-inline-link tags, strip them back to plain text first so we never double-link!
  if (processed.includes('person-inline-link')) {
    processed = processed.replace(/<a\b[^>]*class="[^"]*person-inline-link[^"]*"[^>]*>(.*?)<\/a>/gi, '$1');
  }

  const placeholders = [];
  const cmsSuffix = (sessionStorage.getItem('pokorny_cms_mode') === '1' || new URLSearchParams(window.location.search).get('cms') === '1')
    ? '&cms=1'
    : '';

  // 1. Parse Markdown-style links: supports both [www.e.com](E site) AND [E site](https://www.e.com)
  processed = processed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (full, partA, partB) => {
    let urlPart = partB.trim();
    let labelPart = partA.trim();
    if (looksLikeUrl(partA) && !looksLikeUrl(partB)) {
      urlPart = partA.trim();
      labelPart = partB.trim();
    }
    const href = normalizeHref(urlPart);
    const isExternal = /^https?:\/\//i.test(href);
    const targetAttr = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
    const token = `__LINK_TOKEN_${placeholders.length}__`;
    placeholders.push(`<a href="${href}" class="person-inline-link markdown-inline-link"${targetAttr}>${labelPart}</a>`);
    return token;
  });

  // 2. Parse Family Member links from SITE_DATA.personLinks
  if (Array.isArray(SITE_DATA.personLinks)) {
    const allMatchers = [];
    SITE_DATA.personLinks.forEach(entry => {
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
        const token = `__LINK_TOKEN_${placeholders.length}__`;
        placeholders.push(
          `<a href="rodokmen.html?person=${id}${cmsSuffix}" class="person-inline-link" title="Zobrazit v rodokmenu: ${match}">${match}</a>`
        );
        return token;
      });
    });
  }

  placeholders.forEach((html, idx) => {
    processed = processed.replace(`__LINK_TOKEN_${idx}__`, html);
  });

  return processed;
}
window.linkifyFamilyNames = linkifyFamilyNames;

// ==========================================================================
// 0.5. Main Page: Město Příbor Section (Title, 2 Sentences + Více Overlay, Picture Menu)
// ==========================================================================
function initPriborSection() {
  const priborPhotosEl = document.getElementById('pribor-right-photos');
  if (priborPhotosEl) {
    const photosList = Array.isArray(SITE_DATA.priborPhotos) ? SITE_DATA.priborPhotos : [];
    priborPhotosEl.innerHTML = photosList.map(item => renderFramedPhotoCard(item, true, 'pribor')).join('');
    wireFramedPhotoCards(priborPhotosEl, photosList);
  }

  const moreBtn = document.getElementById('btn-pribor-more');
  if (moreBtn && !moreBtn.dataset.wiredPribor) {
    moreBtn.dataset.wiredPribor = '1';
    moreBtn.addEventListener('click', () => {
      openPriborMoreOverlay();
    });
  }
}

function openPriborMoreOverlay() {
  const homeText = SITE_DATA.pageText?.home || {};
  const allPriborPhotos = [];
  if (Array.isArray(SITE_DATA.priborPhotos)) {
    SITE_DATA.priborPhotos.forEach(item => {
      if (Array.isArray(item.photos)) {
        item.photos.forEach(p => allPriborPhotos.push(p));
      }
    });
  }
  const entry = {
    id: 'pribor-main-modal',
    year: homeText.priborModalSubtitle || '1694 – 20. století • Příbor',
    title: homeText.priborTitle || 'Město Příbor a působení rodu Pokorných',
    person: 'Historie města, piaristická kolej a lékárna č. p. 54',
    longDescription: homeText.priborLongDescription || homeText.priborLeadParagraph || '',
    photos: allPriborPhotos.length > 0
      ? allPriborPhotos
      : [{ url: null, caption: 'Historické náměstí v Příboře s lékárnou č. p. 54' }]
  };
  openTimelineOverlay(entry, 'year');
}
window.openPriborMoreOverlay = openPriborMoreOverlay;

// ==========================================================================
// 1. Main Page: Compact Historie lékárny Timeline (Title + Names + Button to Subpage)
// ==========================================================================
function initMainPageTimeline() {
  const compactContainer = document.getElementById('pharmacy-timeline-compact');
  if (!compactContainer) return;

  compactContainer.innerHTML = (SITE_DATA.pharmacyTimeline || []).map(item => `
    <div class="timeline-item timeline-item-compact" data-timeline-type="pharmacy" data-id="${item.id}">
      <div class="timeline-compact-info">
        <div class="timeline-year">${linkifyFamilyNames(item.year)}</div>
        <h3 class="timeline-title">${linkifyFamilyNames(item.title)}</h3>
        <div class="timeline-person">${linkifyFamilyNames(item.person)}</div>
      </div>
      <div class="timeline-compact-action">
        <a href="historie-lekarny.html#${item.id}" class="btn btn-primary btn-sm" data-timeline-id="${item.id}">
          Více →
        </a>
      </div>
    </div>
  `).join('');
}

// ==========================================================================
// 2. Historie lékárny Subpage: Lineage + Full Clickable Timeline with "Více" Overlay
// ==========================================================================
function initFullPharmacyPage() {
  const chainContainer = document.getElementById('pharmacists-chain');
  if (chainContainer && SITE_DATA.familyTree?.pharmacistsLine) {
    chainContainer.innerHTML = SITE_DATA.familyTree.pharmacistsLine.map((node, idx) => `
      <a href="rodokmen.html?person=${node.id}" class="lineage-node lineage-node-link" data-lineage-idx="${idx}" data-person-id="${node.id}" title="Zobrazit ${node.name} v rodokmenu">
        <div class="lineage-gen">${node.gen}. generace</div>
        <div class="lineage-name">${node.name} ↗</div>
        <div class="lineage-role">${linkifyFamilyNames(node.role)}</div>
      </a>
    `).join('');
  }

  const brozikBox = document.getElementById('brozik-box');
  if (brozikBox && SITE_DATA.familyTree?.brozikConnection) {
    const b = SITE_DATA.familyTree.brozikConnection;
    brozikBox.innerHTML = `
      <h3 style="margin-bottom:0.35rem;">
        ${linkifyFamilyNames(b.title)} – <a href="rodokmen.html?person=${b.personId}" class="person-inline-link">${b.spouse}</a>
      </h3>
      <p>${linkifyFamilyNames(b.details)}</p>
    `;
  }

  const fullTimeline = document.getElementById('pharmacy-timeline-full');
  if (!fullTimeline) return;

  fullTimeline.innerHTML = (SITE_DATA.pharmacyTimeline || []).map(item => `
    <article id="${item.id}" class="timeline-item timeline-item-interactive" data-timeline-type="pharmacy" data-id="${item.id}" tabindex="0" role="button" aria-label="Zobrazit podrobnosti: ${item.title}">
      <div class="timeline-item-header">
        <div>
          <div class="timeline-year">${linkifyFamilyNames(item.year)}</div>
          <div class="timeline-person">${linkifyFamilyNames(item.person)}</div>
          <h3 class="timeline-title">${linkifyFamilyNames(item.title)}</h3>
        </div>
        <button type="button" class="btn btn-outline-dark btn-sm timeline-more-btn" data-id="${item.id}">
          Více ↗
        </button>
      </div>
      <p class="timeline-short-desc">${linkifyFamilyNames(item.description)}</p>
    </article>
  `).join('');

  wireInteractiveTimeline(fullTimeline, SITE_DATA.pharmacyTimeline, 'year');
}

// ==========================================================================
// 3. PhMr. Václav Pokorný Subpage: Bio + Clickable Photos + Full Clickable Timeline
// ==========================================================================
function initFullVaclavPage() {
  // Note: #vaclav-long-bio paragraphs already have [data-cms-linkify] and are linkified cleanly in applyPageTextFromCms()!

  const topRightPhotosEl = document.getElementById('vaclav-top-right-photos');
  if (topRightPhotosEl && Array.isArray(SITE_DATA.vaclavInteractivePhotos)) {
    const heroPhotos = SITE_DATA.vaclavInteractivePhotos.filter(p => p.placement === 'top-right');
    topRightPhotosEl.innerHTML = heroPhotos.map(item => renderFramedPhotoCard(item, true, 'vaclav')).join('');
    wireFramedPhotoCards(topRightPhotosEl, SITE_DATA.vaclavInteractivePhotos);
  }

  const sidePhotosEl = document.getElementById('vaclav-timeline-left-photos');
  if (sidePhotosEl && Array.isArray(SITE_DATA.vaclavInteractivePhotos)) {
    const sidePhotos = SITE_DATA.vaclavInteractivePhotos.filter(p => p.placement === 'timeline-left');
    sidePhotosEl.innerHTML = sidePhotos.map(item => renderFramedPhotoCard(item, false, 'vaclav')).join('');
    wireFramedPhotoCards(sidePhotosEl, SITE_DATA.vaclavInteractivePhotos);
  }

  const vaclavTimeline = document.getElementById('vaclav-timeline-full');
  if (!vaclavTimeline) return;

  vaclavTimeline.innerHTML = (SITE_DATA.vaclavTimeline || []).map(item => `
    <article id="${item.id}" class="timeline-item timeline-item-interactive" data-timeline-type="vaclav" data-id="${item.id}" tabindex="0" role="button" aria-label="Zobrazit podrobnosti: ${item.title}">
      <div class="timeline-item-header">
        <div>
          <div class="timeline-year">${linkifyFamilyNames(item.period)}</div>
          <h3 class="timeline-title">${linkifyFamilyNames(item.title)}</h3>
        </div>
        <button type="button" class="btn btn-outline-dark btn-sm timeline-more-btn" data-id="${item.id}">
          Více ↗
        </button>
      </div>
      <p class="timeline-short-desc">${linkifyFamilyNames(item.description)}</p>
    </article>
  `).join('');

  wireInteractiveTimeline(vaclavTimeline, SITE_DATA.vaclavTimeline, 'period');
}

function renderFramedPhotoCard(item, isLarge, groupType = 'vaclav') {
  const modeBadge = item.mode === 'split'
    ? '🖼️ Fotografie + popis ↗'
    : `🖼️ Fotogalerie (${item.photos?.length || 1}) ↗`;

  const coverUrl = item.thumbnailUrl || (item.photos && item.photos[0] && item.photos[0].url) || null;
  const innerStyle = coverUrl
    ? `style="background-image: linear-gradient(180deg, rgba(18, 22, 27, 0.35) 0%, rgba(18, 22, 27, 0.78) 100%), url('${coverUrl}'); background-size: cover; background-position: center;"`
    : '';

  return `
    <figure class="vaclav-framed-photo ${isLarge ? 'vaclav-framed-large' : 'vaclav-framed-side'}" data-photo-group="${groupType}" data-photo-id="${item.id}" tabindex="0" role="button" aria-label="Zvětšit fotografii: ${item.title}">
      <div class="vaclav-framed-inner" ${innerStyle}>
        <span class="vaclav-framed-badge">${modeBadge}</span>
        ${coverUrl ? '' : '<div class="vaclav-framed-icon">🖼️</div>'}
        <div class="vaclav-framed-title">${linkifyFamilyNames(item.title)}</div>
        <div class="vaclav-framed-date">${linkifyFamilyNames(item.date || '')}</div>
      </div>
      <figcaption class="vaclav-framed-caption">${linkifyFamilyNames(item.caption || '')}</figcaption>
    </figure>
  `;
}

function wireFramedPhotoCards(container, sourceList) {
  container.querySelectorAll('.vaclav-framed-photo').forEach(frame => {
    frame.addEventListener('click', (e) => {
      if (e.target.closest('.person-inline-link')) return;
      const id = frame.getAttribute('data-photo-id');
      const item = sourceList?.find(p => p.id === id);
      if (item) openVaclavPhotoOverlay(item);
    });
    frame.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        if (e.target.closest('.person-inline-link')) return;
        e.preventDefault();
        const id = frame.getAttribute('data-photo-id');
        const item = sourceList?.find(p => p.id === id);
        if (item) openVaclavPhotoOverlay(item);
      }
    });
  });
}

function openVaclavPhotoOverlay(item) {
  const backdrop = document.getElementById('universal-modal');
  const modalWindow = backdrop?.querySelector('.modal-window');
  const leftPane = document.getElementById('modal-left-pane');
  const rightPane = document.getElementById('modal-right-pane');
  if (!backdrop || !modalWindow || !leftPane || !rightPane) return;

  const photos = item.photos && item.photos.length > 0
    ? item.photos
    : [{ url: null, caption: item.caption || item.title }];

  if (item.mode === 'carousel') {
    modalWindow.classList.add('modal-single-pane');
    leftPane.className = 'modal-left-pane modal-pane-media';
    leftPane.innerHTML = buildSamsungPhotoCarouselHtml(photos, item.title);
    wireSamsungCarousel(leftPane, photos);
    rightPane.className = 'modal-right-pane modal-pane-hidden';
    rightPane.innerHTML = '';
  } else {
    modalWindow.classList.remove('modal-single-pane');
    leftPane.className = 'modal-left-pane modal-pane-media';
    leftPane.innerHTML = buildSamsungPhotoCarouselHtml(photos, item.title);
    wireSamsungCarousel(leftPane, photos);

    rightPane.className = 'modal-right-pane modal-pane-details';
    rightPane.innerHTML = `
      <div class="modal-details-content">
        <div class="archive-meta">${linkifyFamilyNames(item.date || '')} | ${linkifyFamilyNames(item.author || '')}</div>
        <h2 class="modal-main-title">${linkifyFamilyNames(item.title)}</h2>
        <p class="modal-desc-text">${linkifyFamilyNames(item.description || item.caption)}</p>
      </div>
      <div class="modal-footer-bar">
        <button type="button" class="btn btn-primary modal-close-action">Zavřít náhled</button>
      </div>
    `;
    rightPane.querySelector('.modal-close-action')?.addEventListener('click', closeUniversalModal);
  }

  backdrop.classList.add('open');
  backdrop.setAttribute('aria-hidden', 'false');
}
window.openVaclavPhotoOverlay = openVaclavPhotoOverlay;

function wireInteractiveTimeline(container, dataArray, timeKey) {
  container.querySelectorAll('.timeline-item-interactive').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.person-inline-link')) return;
      const id = card.getAttribute('data-id');
      const entry = dataArray.find(x => x.id === id);
      if (entry) {
        openTimelineOverlay(entry, timeKey);
      }
    });

    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        if (e.target.closest('.person-inline-link')) return;
        e.preventDefault();
        const id = card.getAttribute('data-id');
        const entry = dataArray.find(x => x.id === id);
        if (entry) openTimelineOverlay(entry, timeKey);
      }
    });
  });
}

// ==========================================================================
// 4. Audio Archive Showcase (3 Songs + Bottom Playhead Bar inside Panel)
// ==========================================================================
let currentTrackIndex = 0;
let isPlaying = false;

function initAudioPlayerPanel() {
  const trackListEl = document.getElementById('track-list');
  const playBtn = document.getElementById('bar-play-btn');
  const audioEl = document.getElementById('main-audio');
  if (!trackListEl || !playBtn || !audioEl) return;

  const showcaseTracks = (SITE_DATA.audioTracks || []).slice(0, 3);

  trackListEl.innerHTML = showcaseTracks.map((track, idx) => `
    <div class="track-item ${idx === 0 ? 'active' : ''}" data-idx="${idx}" data-track-id="${track.id}">
      <div class="track-item-left">
        <span class="track-item-num">${idx + 1}.</span>
        <div>
          <div class="track-info-title">${linkifyFamilyNames(track.title)}</div>
          <div class="track-info-sub">${linkifyFamilyNames(track.subtitle)} (${linkifyFamilyNames(track.year)})</div>
        </div>
      </div>
      <span class="track-duration">${track.duration}</span>
    </div>
  `).join('');

  trackListEl.querySelectorAll('.track-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.person-inline-link')) return;
      const idx = parseInt(el.getAttribute('data-idx'), 10);
      selectShowcaseTrack(idx, true);
    });
  });

  selectShowcaseTrack(0, false);

  if (!playBtn.dataset.wiredAudio) {
    playBtn.dataset.wiredAudio = '1';
    playBtn.addEventListener('click', () => {
      if (audioEl.paused) {
        audioEl.play().catch(() => {});
      } else {
        audioEl.pause();
      }
    });

    audioEl.addEventListener('play', () => {
      isPlaying = true;
      playBtn.textContent = '❚❚';
    });

    audioEl.addEventListener('pause', () => {
      isPlaying = false;
      playBtn.textContent = '▶';
    });
  }
}

function selectShowcaseTrack(index, autoPlay = false) {
  const showcaseTracks = (SITE_DATA.audioTracks || []).slice(0, 3);
  const track = showcaseTracks[index];
  if (!track) return;

  currentTrackIndex = index;
  document.querySelectorAll('#track-list .track-item').forEach((el, i) => {
    el.classList.toggle('active', i === index);
  });

  const titleEl = document.getElementById('bar-track-title');
  const subEl = document.getElementById('bar-track-sub');
  const audioEl = document.getElementById('main-audio');
  const playBtn = document.getElementById('bar-play-btn');

  if (titleEl) titleEl.textContent = track.title;
  if (subEl) subEl.textContent = track.subtitle;
  if (audioEl) {
    audioEl.src = track.src;
    if (autoPlay) {
      audioEl.play().catch(() => {
        console.log('Audio preview ready:', track.src);
      });
      if (playBtn) playBtn.textContent = '❚❚';
    } else {
      if (playBtn) playBtn.textContent = '▶';
    }
  }
}
window.selectShowcaseTrack = selectShowcaseTrack;

// ==========================================================================
// 5. Google Photos Collage-Style Media Gallery & Category Filters
// ==========================================================================
function initMediaGallery() {
  const grid = document.getElementById('archive-grid');
  if (!grid) return;

  const pageScope = grid.getAttribute('data-gallery-page') || 'main';
  const activeFilterBtn = document.querySelector('.filter-bar .filter-btn.active');
  const currentFilter = activeFilterBtn ? activeFilterBtn.getAttribute('data-filter') : 'all';
  renderCollageGallery(currentFilter, pageScope);

  document.querySelectorAll('.filter-bar .filter-btn').forEach(btn => {
    if (btn.dataset.wiredFilter) return;
    btn.dataset.wiredFilter = '1';
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-bar .filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderCollageGallery(btn.getAttribute('data-filter'), pageScope);
      if (typeof window.onCmsAfterPageRender === 'function') {
        window.onCmsAfterPageRender();
      }
    });
  });
}

function getMediaTypeBadge(mediaType, category) {
  if (mediaType === 'pdf') {
    return { icon: '📄', label: category === 'noty' ? 'Notový PDF' : 'Dokument PDF' };
  }
  if (mediaType === 'audio') {
    return { icon: '🎵', label: 'Audio nahrávka' };
  }
  return { icon: '🖼️', label: 'Fotogalerie' };
}

function renderCollageGallery(filterCategory, pageScope) {
  const grid = document.getElementById('archive-grid');
  if (!grid) return;

  const scopedItems = (SITE_DATA.archiveItems || []).filter(item =>
    !item.pages || item.pages.includes(pageScope)
  );

  const items = filterCategory === 'all'
    ? scopedItems
    : scopedItems.filter(i => i.category === filterCategory);

  grid.innerHTML = items.map(item => {
    const badge = getMediaTypeBadge(item.mediaType, item.category);
    const sizeClass = `tile-${item.tileSize || 'normal'}`;
    const photoCountBadge = item.mediaType === 'photo' && item.photos
      ? `<span class="collage-count-pill">${item.photos.length} snímků</span>`
      : item.mediaType === 'pdf' && item.pageCount
      ? `<span class="collage-count-pill">${item.pageCount} stran</span>`
      : item.mediaType === 'audio' && item.duration
      ? `<span class="collage-count-pill">${item.duration}</span>`
      : '';

    const thumbUrl = item.thumbnailUrl || (item.photos && item.photos[0] && item.photos[0].url) || null;
    const visualStyle = thumbUrl
      ? `style="background-image: linear-gradient(180deg, rgba(16, 20, 24, 0.25) 0%, rgba(16, 20, 24, 0.85) 100%), url('${thumbUrl}'); background-size: cover; background-position: center;"`
      : '';

    return `
      <article class="collage-tile ${sizeClass} media-${item.mediaType}" data-id="${item.id}" tabindex="0" role="button" aria-label="Otevřít: ${item.title}">
        <div class="collage-tile-visual" ${visualStyle}>
          <div class="collage-tile-top-badges">
            <span class="collage-type-badge">${badge.icon} ${badge.label}</span>
            ${photoCountBadge}
          </div>
          <div class="collage-visual-center">
            ${thumbUrl ? '' : `<div class="collage-visual-icon">${badge.icon}</div>`}
          </div>
        </div>
        <div class="collage-tile-overlay">
          <div class="collage-meta">${linkifyFamilyNames(item.date)}</div>
          <h3 class="collage-title">${linkifyFamilyNames(item.title)}</h3>
        </div>
      </article>
    `;
  }).join('');

  grid.querySelectorAll('.collage-tile').forEach(tile => {
    tile.addEventListener('click', (e) => {
      if (e.target.closest('.person-inline-link')) return;
      const id = tile.getAttribute('data-id');
      const item = SITE_DATA.archiveItems.find(i => i.id === id);
      if (item) openMediaGalleryOverlay(item);
    });
    tile.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        if (e.target.closest('.person-inline-link')) return;
        e.preventDefault();
        const id = tile.getAttribute('data-id');
        const item = SITE_DATA.archiveItems.find(i => i.id === id);
        if (item) openMediaGalleryOverlay(item);
      }
    });
  });
}

// ==========================================================================
// 6. Universal Overlay Modal (Supports: PDF Document, Audio, Samsung Photo Carousel, Timeline Entry)
// ==========================================================================
function initUniversalModal() {
  const backdrop = document.getElementById('universal-modal');
  const closeTop = document.getElementById('modal-close-top');
  if (!backdrop) return;

  if (closeTop) {
    closeTop.addEventListener('click', closeUniversalModal);
  }

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      closeUniversalModal();
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && backdrop.classList.contains('open')) {
      closeUniversalModal();
    }
  });
}

function closeUniversalModal() {
  const backdrop = document.getElementById('universal-modal');
  if (!backdrop) return;
  backdrop.querySelectorAll('audio').forEach(a => a.pause());
  backdrop.classList.remove('open');
  backdrop.setAttribute('aria-hidden', 'true');
}
window.closeUniversalModal = closeUniversalModal;

function openTimelineOverlay(entry, timeKey = 'year') {
  const backdrop = document.getElementById('universal-modal');
  const modalWindow = backdrop?.querySelector('.modal-window');
  const leftPane = document.getElementById('modal-left-pane');
  const rightPane = document.getElementById('modal-right-pane');
  if (!backdrop || !modalWindow || !leftPane || !rightPane) return;

  modalWindow.classList.remove('modal-single-pane');

  const paragraphs = (entry.longDescription || entry.description || '')
    .split('\n\n')
    .map(p => `<p>${linkifyFamilyNames(p.trim())}</p>`)
    .join('');

  const personLine = entry.person
    ? `<div class="modal-person-subtitle">${linkifyFamilyNames(entry.person)}</div>`
    : '';

  const photos = entry.photos && entry.photos.length > 0
    ? entry.photos
    : [{ url: null, caption: entry.title, detail: 'Fotografická příloha k období' }];

  leftPane.className = 'modal-left-pane modal-pane-media';
  leftPane.innerHTML = buildSamsungPhotoCarouselHtml(photos, entry.title);
  wireSamsungCarousel(leftPane, photos);

  rightPane.className = 'modal-right-pane modal-pane-text';
  rightPane.innerHTML = `
    <div class="modal-text-scroll">
      <div class="archive-meta">${linkifyFamilyNames(entry[timeKey] || '')}</div>
      <h2 class="modal-main-title">${linkifyFamilyNames(entry.title)}</h2>
      ${personLine}
      <div class="modal-long-body">
        ${paragraphs}
      </div>
    </div>
    <div class="modal-footer-bar">
      <button type="button" class="btn btn-primary modal-close-action">Zavřít okno</button>
    </div>
  `;

  rightPane.querySelector('.modal-close-action')?.addEventListener('click', closeUniversalModal);

  backdrop.classList.add('open');
  backdrop.setAttribute('aria-hidden', 'false');
}
window.openTimelineOverlay = openTimelineOverlay;

function openMediaGalleryOverlay(item) {
  const backdrop = document.getElementById('universal-modal');
  const modalWindow = backdrop?.querySelector('.modal-window');
  const leftPane = document.getElementById('modal-left-pane');
  const rightPane = document.getElementById('modal-right-pane');
  if (!backdrop || !modalWindow || !leftPane || !rightPane) return;

  modalWindow.classList.remove('modal-single-pane');
  leftPane.className = 'modal-left-pane modal-pane-media';
  rightPane.className = 'modal-right-pane modal-pane-details';

  if (item.mediaType === 'pdf') {
    const totalPages = item.pageCount || 4;
    if (item.pdfUrl) {
      leftPane.innerHTML = `
        <div class="pdf-viewer-widget">
          <div class="pdf-toolbar">
            <span class="pdf-filename">📄 ${item.fileLabel || item.title}</span>
            <div class="pdf-controls">
              <a href="${item.pdfUrl}" target="_blank" rel="noopener" class="pdf-nav-btn" style="text-decoration:none;">Otevřít PDF v novém okně ↗</a>
            </div>
          </div>
          <iframe src="${item.pdfUrl}" title="${item.title}" style="width:100%; flex:1; border:none; background:#232a32;"></iframe>
        </div>
      `;
    } else {
      leftPane.innerHTML = `
        <div class="pdf-viewer-widget" data-total-pages="${totalPages}">
          <div class="pdf-toolbar">
            <span class="pdf-filename">📄 ${item.fileLabel || 'archivni_dokument.pdf'}</span>
            <div class="pdf-controls">
              <button type="button" class="pdf-nav-btn" data-dir="-1" title="Předchozí strana">◀</button>
              <span class="pdf-page-indicator">Strana <strong id="pdf-curr-page">1</strong> / ${totalPages}</span>
              <button type="button" class="pdf-nav-btn" data-dir="1" title="Další strana">▶</button>
            </div>
          </div>
          <div class="pdf-page-canvas" id="pdf-page-canvas">
            <div class="pdf-paper-sheet">
              <div class="pdf-sheet-header">${linkifyFamilyNames(item.title)}</div>
              <div class="pdf-sheet-meta">${linkifyFamilyNames(item.author)} • ${linkifyFamilyNames(item.date)}</div>
              <div class="pdf-sheet-divider"></div>
              <p class="pdf-sheet-excerpt" id="pdf-sheet-excerpt">${linkifyFamilyNames(item.transcription || item.description)}</p>
              <div class="pdf-sheet-placeholder-note">
                [ Interaktivní náhled PDF dokumentu – strana <span id="pdf-sheet-num">1</span> z ${totalPages} ]
              </div>
            </div>
          </div>
        </div>
      `;

      let currentPage = 1;
      leftPane.querySelectorAll('.pdf-nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const dir = parseInt(btn.getAttribute('data-dir'), 10);
          currentPage = Math.max(1, Math.min(totalPages, currentPage + dir));
          const currEl = leftPane.querySelector('#pdf-curr-page');
          const numEl = leftPane.querySelector('#pdf-sheet-num');
          if (currEl) currEl.textContent = String(currentPage);
          if (numEl) numEl.textContent = String(currentPage);
        });
      });
    }

    rightPane.innerHTML = buildMediaDetailsRightHtml(item, false);
  } else if (item.mediaType === 'audio') {
    leftPane.innerHTML = `
      <div class="audio-modal-visual">
        <div class="vinyl-disc">
          <div class="vinyl-label">♪</div>
        </div>
        <div class="audio-visual-caption">Zvukový archiv PhMr. Václava Pokorného</div>
        <div class="audio-visual-sub">${linkifyFamilyNames(item.author)} (${linkifyFamilyNames(item.date)})</div>
      </div>
    `;
    rightPane.innerHTML = buildMediaDetailsRightHtml(item, true);
  } else {
    const photos = item.photos && item.photos.length > 0
      ? item.photos
      : [{ url: null, caption: item.title }];
    leftPane.innerHTML = buildSamsungPhotoCarouselHtml(photos, item.title);
    wireSamsungCarousel(leftPane, photos);
    rightPane.innerHTML = buildMediaDetailsRightHtml(item, false);
  }

  rightPane.querySelector('.modal-close-action')?.addEventListener('click', closeUniversalModal);

  backdrop.classList.add('open');
  backdrop.setAttribute('aria-hidden', 'false');
}
window.openMediaGalleryOverlay = openMediaGalleryOverlay;

function buildMediaDetailsRightHtml(item, includePlayableAudio) {
  const audioPlayerBlock = includePlayableAudio
    ? `
      <div class="modal-audio-player-box">
        <div class="modal-audio-label">🎧 Přehrát zvukový záznam (${item.duration || 'Archiv'})</div>
        <audio controls autoplay src="${item.audioSrc || ''}" class="modal-audio-element"></audio>
      </div>
    `
    : '';

  const transcriptionBlock = item.transcription
    ? `
      <div class="transcription-box" style="margin-top:1rem;">
        <strong>Přepis / Poznámka:</strong>
        <p style="margin-top:0.25rem;">${linkifyFamilyNames(item.transcription)}</p>
      </div>
    `
    : '';

  return `
    <div class="modal-details-content">
      <div class="archive-meta">${item.category} • ${linkifyFamilyNames(item.date)} | ${linkifyFamilyNames(item.author)}</div>
      <h2 class="modal-main-title">${linkifyFamilyNames(item.title)}</h2>
      <p class="modal-desc-text">${linkifyFamilyNames(item.description)}</p>
      ${transcriptionBlock}
      ${audioPlayerBlock}
    </div>
    <div class="modal-footer-bar">
      <button type="button" class="btn btn-primary modal-close-action">Zavřít náhled</button>
    </div>
  `;
}

function buildSamsungPhotoCarouselHtml(photos, fallbackTitle) {
  const first = photos[0] || { url: null, caption: fallbackTitle };
  return `
    <div class="samsung-gallery-viewer">
      <div class="samsung-main-stage">
        <button type="button" class="samsung-stage-nav prev" title="Předchozí snímek">‹</button>
        <div class="samsung-main-display" id="samsung-main-display">
          ${renderPhotoSlideContent(first, 0, photos.length)}
        </div>
        <button type="button" class="samsung-stage-nav next" title="Další snímek">›</button>
      </div>
      <div class="samsung-caption-bar" id="samsung-caption-bar">
        <div class="samsung-caption-title">${linkifyFamilyNames(first.caption || fallbackTitle)}</div>
        ${first.detail ? `<div class="samsung-caption-sub">${linkifyFamilyNames(first.detail)}</div>` : ''}
      </div>
      <div class="samsung-filmstrip" id="samsung-filmstrip" role="tablist" aria-label="Náhledy fotografií">
        ${photos.map((p, idx) => `
          <button type="button" class="samsung-thumb ${idx === 0 ? 'active' : ''}" data-idx="${idx}" title="${p.caption || `Snímek ${idx + 1}`}">
            ${p.url
              ? `<img src="${p.url}" alt="${p.caption || ''}" />`
              : `<span class="samsung-thumb-placeholder">🖼️ ${idx + 1}</span>`
            }
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

function renderPhotoSlideContent(photo, index, total) {
  if (photo.url) {
    return `<img src="${photo.url}" alt="${photo.caption || ''}" class="samsung-main-img" />`;
  }
  return `
    <div class="samsung-placeholder-art">
      <div class="samsung-placeholder-badge">Fotografie ${index + 1} z ${total}</div>
      <div class="samsung-placeholder-icon">🖼️</div>
      <div class="samsung-placeholder-caption">${linkifyFamilyNames(photo.caption || 'Archivní snímek')}</div>
    </div>
  `;
}

function wireSamsungCarousel(container, photos) {
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
      mainDisplay.innerHTML = renderPhotoSlideContent(current, activeIndex, photos.length);
    }
    if (captionBar) {
      captionBar.innerHTML = `
        <div class="samsung-caption-title">${linkifyFamilyNames(current.caption || '')}</div>
        ${current.detail ? `<div class="samsung-caption-sub">${linkifyFamilyNames(current.detail)}</div>` : ''}
      `;
    }
    thumbs.forEach((t, idx) => {
      t.classList.toggle('active', idx === activeIndex);
    });
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

function handleDeepLinkHash() {
  const hash = window.location.hash ? window.location.hash.slice(1) : '';
  if (!hash) return;

  const targetEl = document.getElementById(hash);
  if (targetEl) {
    setTimeout(() => {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      targetEl.classList.add('timeline-highlight-pulse');
    }, 120);
  }
}
