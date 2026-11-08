document.addEventListener('DOMContentLoaded', () => {
  renderPharmacyTimeline();
  renderVaclavTimeline();
  renderAudioTracks();
  renderFamilyTree();
  renderArchive('all');
  setupArchiveFilters();
  setupModal();
  setupAudioPlayer();
});

function renderPharmacyTimeline() {
  const container = document.getElementById('pharmacy-timeline');
  container.innerHTML = SITE_DATA.pharmacyTimeline.map(item => `
    <div class="timeline-item">
      <div class="timeline-year">${item.year}</div>
      <div class="timeline-person">${item.person}</div>
      <h3 class="timeline-title">${item.title}</h3>
      <p>${item.description}</p>
    </div>
  `).join('');
}

function renderVaclavTimeline() {
  const container = document.getElementById('vaclav-timeline');
  container.innerHTML = SITE_DATA.vaclavTimeline.map(item => `
    <div class="timeline-item">
      <div class="timeline-year">${item.period}</div>
      <h3 class="timeline-title">${item.title}</h3>
      <p>${item.description}</p>
    </div>
  `).join('');
}

let currentTrackIndex = 0;
let isPlaying = false;

function renderAudioTracks() {
  const container = document.getElementById('track-list');
  container.innerHTML = SITE_DATA.audioTracks.map((track, idx) => `
    <div class="track-item ${idx === 0 ? 'active' : ''}" data-idx="${idx}">
      <div>
        <div class="track-info-title">${track.title}</div>
        <div class="track-info-sub">${track.subtitle} (${track.year})</div>
      </div>
      <span style="font-size:0.8rem; color:#e6dcc8;">${track.duration}</span>
    </div>
  `).join('');

  container.querySelectorAll('.track-item').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.getAttribute('data-idx'), 10);
      selectTrack(idx, true);
    });
  });
}

function selectTrack(index, autoPlay = false) {
  currentTrackIndex = index;
  const track = SITE_DATA.audioTracks[index];
  document.querySelectorAll('.track-item').forEach((el, i) => {
    el.classList.toggle('active', i === index);
  });
  document.getElementById('bar-track-title').textContent = track.title;
  document.getElementById('bar-track-sub').textContent = track.subtitle;
  const audioEl = document.getElementById('main-audio');
  audioEl.src = track.src;
  if (autoPlay) {
    isPlaying = true;
    updatePlayButton();
    audioEl.play().catch(() => {
      // Fallback when local demo MP3 file is not yet placed in assets/audio/
      console.log('Audio file placeholder ready for:', track.src);
    });
  }
}

function setupAudioPlayer() {
  const playBtn = document.getElementById('bar-play-btn');
  const audioEl = document.getElementById('main-audio');
  selectTrack(0, false);

  playBtn.addEventListener('click', () => {
    isPlaying = !isPlaying;
    updatePlayButton();
    if (isPlaying) {
      audioEl.play().catch(() => {});
    } else {
      audioEl.pause();
    }
  });
}

function updatePlayButton() {
  const playBtn = document.getElementById('bar-play-btn');
  // playBtn.textContent = isPlaying ? '❚❚' : '▶';
  playBtn.textContent = isPlaying ? '| |' : '▶';
}

function renderFamilyTree() {
  const chainContainer = document.getElementById('pharmacists-chain');
  chainContainer.innerHTML = SITE_DATA.familyTree.pharmacistsLine.map(node => `
    <div class="lineage-node">
      <div class="lineage-gen">${node.gen}. generace</div>
      <div class="lineage-name">${node.name}</div>
      <div class="lineage-role">${node.role}</div>
    </div>
  `).join('');

  const brozikBox = document.getElementById('brozik-box');
  const b = SITE_DATA.familyTree.brozikConnection;
  brozikBox.innerHTML = `
    <h3 style="margin-bottom:0.35rem;">${b.title} – ${b.spouse}</h3>
    <p>${b.details}</p>
  `;

  const genGrid = document.getElementById('modern-generations');
  genGrid.innerHTML = SITE_DATA.familyTree.modernGenerations.map(gen => `
    <div class="gen-card">
      <h4>${gen.generationTitle}</h4>
      <div class="member-tags">
        ${gen.members.map(m => `<span class="member-tag">${m}</span>`).join('')}
      </div>
    </div>
  `).join('');
}

function renderArchive(filterCategory) {
  const grid = document.getElementById('archive-grid');
  const items = filterCategory === 'all'
    ? SITE_DATA.archiveItems
    : SITE_DATA.archiveItems.filter(i => i.category === filterCategory);

  grid.innerHTML = items.map(item => `
    <article class="archive-card" data-id="${item.id}">
      <div class="archive-thumb">
        <span style="font-family:var(--font-serif); font-size:1.1rem;">[ Archivní sken ]</span>
        <small style="color:#5a605d; margin-top:0.3rem;">${item.title}</small>
      </div>
      <div class="archive-body">
        <div class="archive-meta">${item.category} • ${item.date}</div>
        <h3 class="archive-title">${item.title}</h3>
        <p class="archive-desc">${item.description}</p>
      </div>
    </article>
  `).join('');

  grid.querySelectorAll('.archive-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.getAttribute('data-id');
      openModal(id);
    });
  });
}

function setupArchiveFilters() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderArchive(btn.getAttribute('data-filter'));
    });
  });
}

function setupModal() {
  const backdrop = document.getElementById('archive-modal');
  document.getElementById('modal-close').addEventListener('click', () => {
    backdrop.classList.remove('open');
  });
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.classList.remove('open');
  });
}

function openModal(itemId) {
  const item = SITE_DATA.archiveItems.find(i => i.id === itemId);
  if (!item) return;
  document.getElementById('modal-title').textContent = item.title;
  document.getElementById('modal-meta').textContent = `${item.date} | ${item.author}`;
  document.getElementById('modal-desc').textContent = item.description;
  document.getElementById('modal-transcription').textContent = item.transcription;
  document.getElementById('archive-modal').classList.add('open');
}
