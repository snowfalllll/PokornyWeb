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

function escapeTreeLinkAttr(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function linkifyTreeText(text, currentPersonId = null) {
  if (!text) return '';
  let processed = String(text);

  if (processed.includes('person-inline-link')) {
    processed = processed.replace(/<(?:a|span)\b[^>]*class="[^"]*person-inline-link[^"]*"[^>]*>(.*?)<\/(?:a|span)>/gi, '$1');
  }

  const placeholders = [];
  const placeholderPlainTexts = [];
  const isCmsActive = document.body.classList.contains('cms-visual-active') ||
    sessionStorage.getItem('pokorny_cms_mode') === '1' ||
    new URLSearchParams(window.location.search).get('cms') === '1';

  function restorePlainTokens(str) {
    return str.replace(/__TREE_LINK_(\d+)__/g, (_, idx) => placeholderPlainTexts[Number(idx)] ?? '');
  }

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
    placeholderPlainTexts.push(labelPart);
    placeholders.push(`<a href="${href}" class="person-inline-link markdown-inline-link"${targetAttr}>${labelPart}</a>`);
    return token;
  });

  // 2. Family member links (jump directly inside the tree modal, with per-occurrence override support)
  if (Array.isArray(SITE_DATA.personLinks)) {
    const seenPatterns = new Set();
    const allMatchers = [];
    SITE_DATA.personLinks.forEach(entry => {
      if (Array.isArray(entry.patterns)) {
        entry.patterns.forEach(pattern => {
          const cleanPat = pattern ? pattern.trim() : '';
          if (cleanPat && !seenPatterns.has(cleanPat)) {
            seenPatterns.add(cleanPat);
            allMatchers.push({ pattern: cleanPat, id: entry.id });
          }
        });
      }
    });
    allMatchers.sort((a, b) => b.pattern.length - a.pattern.length);

    const overrides = (SITE_DATA.personLinkOverrides && typeof SITE_DATA.personLinkOverrides === 'object')
      ? SITE_DATA.personLinkOverrides
      : {};

    allMatchers.forEach(({ pattern, id }) => {
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'g');
      processed = processed.replace(regex, (match, offset) => {
        const rawBefore = restorePlainTokens(processed.slice(0, offset));
        const rawAfter = restorePlainTokens(processed.slice(offset + match.length));
        const beforeSnippet = rawBefore.slice(-24).replace(/\s+/g, ' ').trim();
        const afterSnippet = rawAfter.slice(0, 24).replace(/\s+/g, ' ').trim();
        const contextKey = `${beforeSnippet}|${match}|${afterSnippet}`;

        const overrideId = overrides[contextKey];
        const targetId = overrideId || id;
        const token = `__TREE_LINK_${placeholders.length}__`;
        placeholderPlainTexts.push(match);

        if (targetId === '__NONE__' || (!overrideId && targetId === currentPersonId)) {
          if (isCmsActive && targetId === '__NONE__') {
            placeholders.push(
              `<span class="person-inline-link person-inline-unlinked" data-person-id="__NONE__" data-default-person-id="${escapeTreeLinkAttr(id)}" data-match-text="${escapeTreeLinkAttr(match)}" data-context-key="${escapeTreeLinkAttr(contextKey)}" title="Odkaz vypnut (kliknutím v CMS můžete odkaz znovu zapnout)">${match}</span>`
            );
          } else {
            placeholders.push(match);
          }
          return token;
        }

        placeholders.push(
          `<a href="#person-${escapeTreeLinkAttr(targetId)}" data-jump-person="${escapeTreeLinkAttr(targetId)}" class="person-inline-link" data-person-id="${escapeTreeLinkAttr(targetId)}" data-default-person-id="${escapeTreeLinkAttr(id)}" data-match-text="${escapeTreeLinkAttr(match)}" data-context-key="${escapeTreeLinkAttr(contextKey)}" title="Přejít v rodokmenu na: ${escapeTreeLinkAttr(match)}">${match}</a>`
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

// ==========================================================================
// Graph-Based Family Tree Model (Nodes + Links on a Unified Canvas)
// Supports multiple ancestor lineages (e.g. parents for both partners in a couple),
// standalone/one-off cards that keep their position, and manual generation labels.
// ==========================================================================
const TREE_CARD_W = 280;
const TREE_CARD_H = 112;
const TREE_COUPLE_GAP = 44;
const TREE_SIBLING_GAP = 36;
const TREE_ROW_STEP_Y = 175;
const TREE_PAD_X = 80;
const TREE_PAD_Y = 70;

function ensureFamilyGraphModel() {
  if (!SITE_DATA.familyTree) {
    SITE_DATA.familyTree = { nodes: [] };
  }

  // Migrate legacy nested treeRoot (+ detachedNodes) into flat graph nodes[] on first load
  if (!Array.isArray(SITE_DATA.familyTree.nodes) || SITE_DATA.familyTree.nodes.length === 0) {
    const migrated = [];
    const seen = new Set();

    function extractNodeCopy(raw, parentId, spouseId) {
      return {
        id: raw.id,
        gen: raw.gen || 1,
        name: raw.name || 'Člen rodu',
        role: raw.role || '',
        branch: raw.branch || 'family',
        birthDate: raw.birthDate || '',
        deathDate: raw.deathDate || '—',
        photo: raw.photo || null,
        photoCaption: raw.photoCaption || raw.name || '',
        photos: Array.isArray(raw.photos) ? JSON.parse(JSON.stringify(raw.photos)) : [{ url: raw.photo || null, caption: raw.name || '' }],
        description: raw.description || '',
        parentId: parentId || null,
        spouseId: spouseId || null,
        x: Number.isFinite(raw.x) ? raw.x : null,
        y: Number.isFinite(raw.y) ? raw.y : null
      };
    }

    function walkLegacy(node, incomingParentId) {
      if (!node || !node.id || seen.has(node.id)) return;
      seen.add(node.id);

      const hasSpouse = node.spouse && typeof node.spouse === 'object' && node.spouse.id && !seen.has(node.spouse.id);
      const spouseId = hasSpouse ? node.spouse.id : null;
      const parentPointsToSpouse = hasSpouse && node.parentTargetId === node.spouse.id;

      migrated.push(extractNodeCopy(
        node,
        parentPointsToSpouse ? null : incomingParentId,
        spouseId
      ));

      if (hasSpouse) {
        seen.add(node.spouse.id);
        migrated.push(extractNodeCopy(
          node.spouse,
          parentPointsToSpouse ? incomingParentId : null,
          node.id
        ));
      }

      if (Array.isArray(node.children)) {
        node.children.forEach(ch => walkLegacy(ch, node.id));
      }
    }

    if (SITE_DATA.familyTree.treeRoot) {
      walkLegacy(SITE_DATA.familyTree.treeRoot, null);
    }
    if (Array.isArray(SITE_DATA.familyTree.detachedNodes)) {
      SITE_DATA.familyTree.detachedNodes.forEach(d => walkLegacy(d, null));
    }

    SITE_DATA.familyTree.nodes = migrated;
    delete SITE_DATA.familyTree.treeRoot;
    delete SITE_DATA.familyTree.detachedNodes;

    sanitizeFamilyGraph();
    organizeFamilyGraphLayout(true);
    return;
  }

  delete SITE_DATA.familyTree.treeRoot;
  delete SITE_DATA.familyTree.detachedNodes;
  sanitizeFamilyGraph();
}
window.ensureFamilyGraphModel = ensureFamilyGraphModel;

function sanitizeFamilyGraph() {
  if (!SITE_DATA.familyTree || !Array.isArray(SITE_DATA.familyTree.nodes)) return;

  const seenIds = new Set();
  const cleanList = [];
  SITE_DATA.familyTree.nodes.forEach(n => {
    if (!n || !n.id || seenIds.has(n.id)) return;
    seenIds.add(n.id);
    delete n._parentId;
    delete n._isSpouseOf;
    delete n.children;
    delete n.spouse;
    delete n.cmsOffsetX;
    delete n.cmsOffsetY;
    delete n.parentTargetId;
    n.parentId = n.parentId || null;
    n.spouseId = n.spouseId || null;
    cleanList.push(n);
  });
  SITE_DATA.familyTree.nodes = cleanList;

  PERSON_MAP.clear();
  cleanList.forEach(n => PERSON_MAP.set(n.id, n));

  // Enforce symmetric spouseId
  cleanList.forEach(n => {
    if (n.spouseId) {
      const sp = PERSON_MAP.get(n.spouseId);
      if (!sp || sp.id === n.id) {
        n.spouseId = null;
      } else if (sp.spouseId && sp.spouseId !== n.id) {
        // Other node is married to someone else; clear stale link
        n.spouseId = null;
      } else {
        sp.spouseId = n.id;
      }
    }
  });

  // Enforce valid parentId without cycles
  cleanList.forEach(n => {
    if (n.parentId) {
      const p = PERSON_MAP.get(n.parentId);
      if (!p || p.id === n.id || p.id === n.spouseId) {
        n.parentId = null;
      }
    }
  });

  // Break any accidental parentId cycles
  cleanList.forEach(n => {
    const visited = new Set([n.id]);
    let curr = n;
    while (curr && curr.parentId) {
      if (visited.has(curr.parentId)) {
        curr.parentId = null;
        break;
      }
      visited.add(curr.parentId);
      curr = PERSON_MAP.get(curr.parentId);
    }
  });

  // Ensure every node has valid numeric coordinates
  let needsInitialPlacement = false;
  cleanList.forEach((n, idx) => {
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) {
      n.x = TREE_PAD_X + (idx % 4) * (TREE_CARD_W + TREE_SIBLING_GAP);
      n.y = TREE_PAD_Y + Math.floor(idx / 4) * TREE_ROW_STEP_Y;
      needsInitialPlacement = true;
    }
  });

  if (needsInitialPlacement && cleanList.length > 1) {
    organizeFamilyGraphLayout(true);
  }
}
window.sanitizeFamilyGraph = sanitizeFamilyGraph;

function isGraphAncestorOf(candidateAncestorId, targetNodeId) {
  if (!candidateAncestorId || !targetNodeId) return false;
  if (candidateAncestorId === targetNodeId) return true;

  // Walk upwards from targetNodeId (following parentId and parent's spouseId)
  const visited = new Set();
  const queue = [targetNodeId];
  while (queue.length > 0) {
    const currId = queue.shift();
    if (visited.has(currId)) continue;
    visited.add(currId);
    if (currId === candidateAncestorId) return true;

    const curr = PERSON_MAP.get(currId);
    if (!curr) continue;
    if (curr.parentId && !visited.has(curr.parentId)) {
      queue.push(curr.parentId);
      const pNode = PERSON_MAP.get(curr.parentId);
      if (pNode?.spouseId && !visited.has(pNode.spouseId)) {
        queue.push(pNode.spouseId);
      }
    }
  }
  return false;
}
window.isGraphAncestorOf = isGraphAncestorOf;

function getCoupleChildren(personNode) {
  if (!personNode || !SITE_DATA.familyTree?.nodes) return [];
  const spouseId = personNode.spouseId || null;
  return SITE_DATA.familyTree.nodes.filter(n =>
    n.parentId === personNode.id || (spouseId && n.parentId === spouseId)
  );
}
window.getCoupleChildren = getCoupleChildren;

// ==========================================================================
// Automatic Graph Layout Engine ("✨ Uspořádat strom")
// - Only runs when explicitly triggered (or on initial legacy migration)
// - Preserves manual generation labels (never overwrites member.role)
// - Preserves positions of one-off / isolated nodes (when includeIsolated = false)
// - Properly aligns dual parent lineages above married couples (c -> Václav, a -> b)
// ==========================================================================
function organizeFamilyGraphLayout(includeIsolated = false) {
  if (!SITE_DATA.familyTree || !Array.isArray(SITE_DATA.familyTree.nodes)) return;
  const nodes = SITE_DATA.familyTree.nodes;
  if (nodes.length === 0) return;

  PERSON_MAP.clear();
  nodes.forEach(n => PERSON_MAP.set(n.id, n));

  const childrenOf = new Map();
  nodes.forEach(n => childrenOf.set(n.id, []));
  nodes.forEach(n => {
    if (n.parentId && childrenOf.has(n.parentId)) {
      childrenOf.get(n.parentId).push(n.id);
    }
  });

  function isNodeConnected(n) {
    return Boolean(n.parentId || n.spouseId || (childrenOf.get(n.id)?.length > 0));
  }

  const connectedNodes = nodes.filter(isNodeConnected);
  const isolatedNodes = nodes.filter(n => !isNodeConnected(n));

  // Partition connected nodes into connected components
  const visitedComp = new Set();
  const components = [];

  connectedNodes.forEach(startNode => {
    if (visitedComp.has(startNode.id)) return;
    const comp = [];
    const q = [startNode.id];
    visitedComp.add(startNode.id);
    while (q.length > 0) {
      const currId = q.shift();
      const curr = PERSON_MAP.get(currId);
      if (!curr) continue;
      comp.push(curr);

      const neighbors = [];
      if (curr.parentId) neighbors.push(curr.parentId);
      if (curr.spouseId) neighbors.push(curr.spouseId);
      (childrenOf.get(currId) || []).forEach(cid => neighbors.push(cid));

      neighbors.forEach(nbId => {
        if (!visitedComp.has(nbId) && PERSON_MAP.has(nbId)) {
          visitedComp.add(nbId);
          q.push(nbId);
        }
      });
    }
    components.push(comp);
  });

  // Sort components largest first (main Pokorný tree first)
  components.sort((a, b) => b.length - a.length);

  let nextComponentOffsetX = TREE_PAD_X;

  components.forEach(comp => {
    // 1. Assign relative generation row to every node in component
    // Spouse pairs share the exact same row; parent is at row(child) - 1
    const rowMap = new Map();
    comp.forEach(n => rowMap.set(n.id, 0));

    for (let iter = 0; iter < comp.length * 3; iter++) {
      let changed = false;
      comp.forEach(n => {
        if (n.spouseId && rowMap.has(n.spouseId)) {
          const rA = rowMap.get(n.id);
          const rB = rowMap.get(n.spouseId);
          if (rA !== rB) {
            const maxR = Math.max(rA, rB);
            rowMap.set(n.id, maxR);
            rowMap.set(n.spouseId, maxR);
            changed = true;
          }
        }
        if (n.parentId && rowMap.has(n.parentId)) {
          const rChild = rowMap.get(n.id);
          const rParent = rowMap.get(n.parentId);
          if (rChild !== rParent + 1) {
            if (rChild < rParent + 1) {
              rowMap.set(n.id, rParent + 1);
            } else {
              // Pull parent down to rChild - 1 so dual parents (c -> Václav, a -> b) sit on the exact row above their child
              rowMap.set(n.parentId, rChild - 1);
            }
            changed = true;
          }
        }
      });
      if (!changed) break;
    }

    const minRow = Math.min(...Array.from(rowMap.values()));
    comp.forEach(n => rowMap.set(n.id, rowMap.get(n.id) - minRow));

    // 2. Group nodes into Couple Units (or Single Units)
    const unitById = new Map();
    const nodeToUnit = new Map();
    const units = [];

    comp.forEach(n => {
      if (nodeToUnit.has(n.id)) return;
      if (n.spouseId && PERSON_MAP.has(n.spouseId)) {
        const sp = PERSON_MAP.get(n.spouseId);
        // Determine left vs right partner: keep primary lineage or existing left-to-right order
        let leftNode = n;
        let rightNode = sp;
        if (
          (!n.parentId && sp.parentId && n.branch !== 'pharmacist') ||
          (Number.isFinite(n.x) && Number.isFinite(sp.x) && sp.x < n.x - 10 && sp.branch === 'pharmacist')
        ) {
          leftNode = sp;
          rightNode = n;
        }
        const unit = {
          id: `unit-${leftNode.id}`,
          left: leftNode,
          right: rightNode,
          row: rowMap.get(leftNode.id),
          width: TREE_CARD_W * 2 + TREE_COUPLE_GAP,
          childrenUnits: [],
          x: 0,
          subtreeWidth: TREE_CARD_W * 2 + TREE_COUPLE_GAP,
          placed: false
        };
        units.push(unit);
        unitById.set(unit.id, unit);
        nodeToUnit.set(leftNode.id, unit);
        nodeToUnit.set(rightNode.id, unit);
      } else {
        const unit = {
          id: `unit-${n.id}`,
          left: n,
          right: null,
          row: rowMap.get(n.id),
          width: TREE_CARD_W,
          childrenUnits: [],
          x: 0,
          subtreeWidth: TREE_CARD_W,
          placed: false
        };
        units.push(unit);
        unitById.set(unit.id, unit);
        nodeToUnit.set(n.id, unit);
      }
    });

    // Build parentUnit -> childUnit links
    const primaryParentUnitOf = new Map();
    units.forEach(u => {
      const pLeft = u.left.parentId ? nodeToUnit.get(u.left.parentId) : null;
      const pRight = u.right?.parentId ? nodeToUnit.get(u.right.parentId) : null;
      const primaryParent = pLeft || pRight;
      if (primaryParent && primaryParent !== u) {
        primaryParentUnitOf.set(u.id, primaryParent);
        if (!primaryParent.childrenUnits.includes(u)) {
          primaryParent.childrenUnits.push(u);
        }
      }
    });

    // Compute subtree sizes bottom-up so the main trunk root is laid out first
    const memoDescCount = new Map();
    function countDescendants(u) {
      if (memoDescCount.has(u.id)) return memoDescCount.get(u.id);
      let total = 1;
      u.childrenUnits.forEach(ch => { total += countDescendants(ch); });
      memoDescCount.set(u.id, total);
      return total;
    }
    units.forEach(countDescendants);

    function computeSubtreeWidth(u, visited = new Set()) {
      if (visited.has(u.id)) return u.width;
      visited.add(u.id);
      if (u.childrenUnits.length === 0) {
        u.subtreeWidth = u.width;
        return u.width;
      }
      const childrenTotal = u.childrenUnits.reduce((acc, ch) => acc + computeSubtreeWidth(ch, visited), 0) +
        TREE_SIBLING_GAP * (u.childrenUnits.length - 1);
      u.subtreeWidth = Math.max(u.width, childrenTotal);
      return u.subtreeWidth;
    }

    function layoutSubtreeTopDown(u, leftEdgeX, visited = new Set()) {
      if (visited.has(u.id)) return;
      visited.add(u.id);
      u.placed = true;
      u.x = leftEdgeX + (u.subtreeWidth - u.width) / 2;

      if (u.childrenUnits.length > 0) {
        const childrenTotal = u.childrenUnits.reduce((acc, ch) => acc + ch.subtreeWidth, 0) +
          TREE_SIBLING_GAP * (u.childrenUnits.length - 1);
        let childStart = u.x + u.width / 2 - childrenTotal / 2;
        u.childrenUnits.forEach(ch => {
          layoutSubtreeTopDown(ch, childStart, visited);
          childStart += ch.subtreeWidth + TREE_SIBLING_GAP;
        });
      }
    }

    // Find root units sorted by descendant count descending
    const rootUnits = units
      .filter(u => !primaryParentUnitOf.has(u.id))
      .sort((a, b) => (memoDescCount.get(b.id) || 0) - (memoDescCount.get(a.id) || 0));

    if (rootUnits.length > 0) {
      const mainRoot = rootUnits[0];
      computeSubtreeWidth(mainRoot);
      layoutSubtreeTopDown(mainRoot, nextComponentOffsetX);
    }

    // Position any secondary ancestor units (such as `a -> b` where `b` is the right partner of an already-placed couple)
    // directly above their target child card!
    const unplaced = units.filter(u => !u.placed).sort((a, b) => b.row - a.row);
    unplaced.forEach(u => {
      // Find any child node pointing to u.left or u.right
      const childNode = comp.find(n => n.parentId === u.left.id || (u.right && n.parentId === u.right.id));
      if (childNode) {
        const childUnit = nodeToUnit.get(childNode.id);
        if (childUnit && childUnit.placed) {
          const childCardX = (childUnit.right && childUnit.right.id === childNode.id)
            ? (childUnit.x + TREE_CARD_W + TREE_COUPLE_GAP)
            : childUnit.x;
          u.x = childCardX + TREE_CARD_W / 2 - u.width / 2;
          u.placed = true;
          return;
        }
      }
      computeSubtreeWidth(u);
      layoutSubtreeTopDown(u, nextComponentOffsetX);
    });

    // Also align single-child ancestor units directly above the specific partner card they connect to!
    const maxRow = Math.max(...units.map(u => u.row));
    for (let r = maxRow - 1; r >= 0; r--) {
      const rowUnits = units.filter(u => u.row === r);
      rowUnits.forEach(u => {
        const directChildNodes = comp.filter(n => n.parentId === u.left.id || (u.right && n.parentId === u.right.id));
        if (directChildNodes.length === 1) {
          const cNode = directChildNodes[0];
          const cUnit = nodeToUnit.get(cNode.id);
          if (cUnit && cUnit.right) {
            // Child is part of a married couple -> center parent unit directly over that specific partner card!
            const targetCardX = (cUnit.right.id === cNode.id)
              ? (cUnit.x + TREE_CARD_W + TREE_COUPLE_GAP)
              : cUnit.x;
            u.x = targetCardX + TREE_CARD_W / 2 - u.width / 2;
          }
        }
      });
    }

    // Resolve any horizontal overlaps row-by-row
    for (let r = 0; r <= maxRow; r++) {
      const rowUnits = units.filter(u => u.row === r).sort((a, b) => a.x - b.x);
      for (let i = 1; i < rowUnits.length; i++) {
        const prev = rowUnits[i - 1];
        const curr = rowUnits[i];
        const minAllowedX = prev.x + prev.width + TREE_SIBLING_GAP;
        if (curr.x < minAllowedX) {
          curr.x = minAllowedX;
        }
      }
    }

    // Write final coordinates back to nodes in this component
    let compMinX = Infinity;
    let compMaxX = -Infinity;
    units.forEach(u => {
      const y = TREE_PAD_Y + u.row * TREE_ROW_STEP_Y;
      u.left.x = Math.round(u.x);
      u.left.y = Math.round(y);
      compMinX = Math.min(compMinX, u.left.x);
      compMaxX = Math.max(compMaxX, u.left.x + TREE_CARD_W);
      if (u.right) {
        u.right.x = Math.round(u.x + TREE_CARD_W + TREE_COUPLE_GAP);
        u.right.y = Math.round(y);
        compMaxX = Math.max(compMaxX, u.right.x + TREE_CARD_W);
      }
    });

    if (compMinX < nextComponentOffsetX) {
      const shift = nextComponentOffsetX - compMinX;
      comp.forEach(n => { n.x = Math.round(n.x + shift); });
      compMaxX += shift;
    }

    nextComponentOffsetX = Math.max(nextComponentOffsetX, compMaxX + 90);
  });

  if (includeIsolated) {
    isolatedNodes.forEach((n, idx) => {
      n.x = Math.round(nextComponentOffsetX + (idx % 2) * (TREE_CARD_W + TREE_SIBLING_GAP));
      n.y = Math.round(TREE_PAD_Y + Math.floor(idx / 2) * TREE_ROW_STEP_Y);
    });
  }

  normalizeGraphOrigin(false);
}
window.organizeFamilyGraphLayout = organizeFamilyGraphLayout;

function normalizeGraphOrigin(compensateViewportPan = false) {
  const nodes = SITE_DATA.familyTree?.nodes;
  if (!Array.isArray(nodes) || nodes.length === 0) return;

  const minX = Math.min(...nodes.map(n => n.x));
  const minY = Math.min(...nodes.map(n => n.y));

  let shiftX = 0;
  let shiftY = 0;
  if (minX < TREE_PAD_X) shiftX = TREE_PAD_X - minX;
  if (minY < TREE_PAD_Y) shiftY = TREE_PAD_Y - minY;

  if (shiftX !== 0 || shiftY !== 0) {
    nodes.forEach(n => {
      n.x = Math.round(n.x + shiftX);
      n.y = Math.round(n.y + shiftY);
    });
    if (compensateViewportPan && window.treePanZoomApi && typeof window.treePanZoomApi.shiftPan === 'function') {
      const scale = window.treePanZoomApi.getScale();
      window.treePanZoomApi.shiftPan(-shiftX * scale, -shiftY * scale);
    }
  }
}
window.normalizeGraphOrigin = normalizeGraphOrigin;

function renderGenealogyTreeDom() {
  const rootEl = document.getElementById('genealogy-root');
  if (!rootEl) return;

  ensureFamilyGraphModel();
  const nodes = SITE_DATA.familyTree.nodes || [];

  PERSON_MAP.clear();
  nodes.forEach(n => PERSON_MAP.set(n.id, n));

  // Build wedding rings for each married couple (once per pair)
  const renderedPairs = new Set();
  const ringsHtml = [];
  nodes.forEach(n => {
    if (n.spouseId && PERSON_MAP.has(n.spouseId)) {
      const pairKey = [n.id, n.spouseId].sort().join('::');
      if (!renderedPairs.has(pairKey)) {
        renderedPairs.add(pairKey);
        const [idA, idB] = [n.id, n.spouseId].sort();
        ringsHtml.push(
          `<div class="tree-couple-ring" data-spouse-a="${idA}" data-spouse-b="${idB}" title="Manželský svazek (v CMS kliknutím rozpojíte)">⚭</div>`
        );
      }
    }
  });

  rootEl.innerHTML = `
    <svg id="tree-connectors-svg" class="tree-connectors-svg" aria-hidden="true"></svg>
    <div id="tree-nodes-layer" class="tree-nodes-layer">
      ${nodes.map(node => renderPersonCard(node)).join('')}
      ${ringsHtml.join('')}
    </div>
  `;

  updateTreeConnectorsSvg();
  requestAnimationFrame(() => {
    updateTreeConnectorsSvg();
  });

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

function updateTreeConnectorsSvg() {
  const rootEl = document.getElementById('genealogy-root');
  const svgEl = document.getElementById('tree-connectors-svg');
  const nodes = SITE_DATA.familyTree?.nodes;
  if (!rootEl || !svgEl || !Array.isArray(nodes)) return;

  const boxById = new Map();
  let maxX = 800;
  let maxY = 500;

  nodes.forEach(n => {
    const el = document.getElementById(`person-${n.id}`);
    const w = el ? (el.offsetWidth || TREE_CARD_W) : TREE_CARD_W;
    const h = el ? (el.offsetHeight || TREE_CARD_H) : TREE_CARD_H;
    const x = Number.isFinite(n.x) ? n.x : TREE_PAD_X;
    const y = Number.isFinite(n.y) ? n.y : TREE_PAD_Y;

    boxById.set(n.id, {
      left: x,
      right: x + w,
      top: y,
      bottom: y + h,
      cx: x + w / 2,
      cy: y + h / 2,
      w,
      h
    });

    maxX = Math.max(maxX, x + w + TREE_PAD_X);
    maxY = Math.max(maxY, y + h + TREE_PAD_Y);
  });

  rootEl.style.width = `${Math.round(maxX)}px`;
  rootEl.style.height = `${Math.round(maxY)}px`;

  const paths = [];
  const coupleOriginByMemberId = new Map();
  const processedPairs = new Set();

  // 1. Position wedding rings (⚭) and draw horizontal marriage connector lines
  nodes.forEach(n => {
    if (!n.spouseId || !boxById.has(n.id) || !boxById.has(n.spouseId)) return;
    const [idA, idB] = [n.id, n.spouseId].sort();
    const pairKey = `${idA}::${idB}`;
    if (processedPairs.has(pairKey)) return;
    processedPairs.add(pairKey);

    const b1 = boxById.get(idA);
    const b2 = boxById.get(idB);
    const leftBox = b1.cx <= b2.cx ? b1 : b2;
    const rightBox = b1.cx <= b2.cx ? b2 : b1;

    const ringCx = (leftBox.right + rightBox.left) / 2;
    const ringCy = (leftBox.cy + rightBox.cy) / 2;

    const ringEl = rootEl.querySelector(`.tree-couple-ring[data-spouse-a="${idA}"][data-spouse-b="${idB}"]`);
    if (ringEl) {
      ringEl.style.left = `${Math.round(ringCx - 15)}px`;
      ringEl.style.top = `${Math.round(ringCy - 15)}px`;
    }

    // Draw line connecting the two spouse cards through the wedding ring
    paths.push(
      `<path d="M ${leftBox.right.toFixed(1)} ${leftBox.cy.toFixed(1)} L ${ringCx.toFixed(1)} ${ringCy.toFixed(1)} L ${rightBox.left.toFixed(1)} ${rightBox.cy.toFixed(1)}" fill="none" stroke="var(--accent-gold, #9e7b42)" stroke-width="2" stroke-linecap="round" />`
    );

    const origin = {
      key: `couple:${pairKey}`,
      startX: ringCx,
      startY: ringCy + 15,
      rowBottom: Math.max(leftBox.bottom, rightBox.bottom)
    };
    coupleOriginByMemberId.set(idA, origin);
    coupleOriginByMemberId.set(idB, origin);
  });

  // 2. Group parent -> child connections by parent origin (couple ring if parent is married, or bottom-center of single parent)
  const parentGroups = new Map();

  nodes.forEach(child => {
    if (!child.parentId || !boxById.has(child.id) || !boxById.has(child.parentId)) return;
    const cBox = boxById.get(child.id);
    const pBox = boxById.get(child.parentId);

    const origin = coupleOriginByMemberId.get(child.parentId) || {
      key: `single:${child.parentId}`,
      startX: pBox.cx,
      startY: pBox.bottom,
      rowBottom: pBox.bottom
    };

    if (!parentGroups.has(origin.key)) {
      parentGroups.set(origin.key, {
        startX: origin.startX,
        startY: origin.startY,
        rowBottom: origin.rowBottom,
        targets: []
      });
    }
    // Line leads directly to the top-center of this specific child's card!
    parentGroups.get(origin.key).targets.push({
      endX: cBox.cx,
      endY: cBox.top
    });
  });

  parentGroups.forEach(group => {
    const { startX, startY, rowBottom, targets } = group;
    if (targets.length === 0) return;

    const minChildTop = Math.min(...targets.map(t => t.endY));
    const midY = minChildTop > rowBottom + 10
      ? rowBottom + (minChildTop - rowBottom) / 2
      : (startY + minChildTop) / 2;

    targets.forEach(({ endX, endY }) => {
      paths.push(
        `<path d="M ${startX.toFixed(1)} ${startY.toFixed(1)} L ${startX.toFixed(1)} ${midY.toFixed(1)} L ${endX.toFixed(1)} ${midY.toFixed(1)} L ${endX.toFixed(1)} ${endY.toFixed(1)}" fill="none" stroke="var(--accent-gold, #9e7b42)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />`
      );
    });
  });

  svgEl.innerHTML = paths.join('');
}
window.updateTreeConnectorsSvg = updateTreeConnectorsSvg;
window.addEventListener('resize', () => {
  requestAnimationFrame(updateTreeConnectorsSvg);
});

function renderPersonCard(member) {
  const quickDates = member.deathDate && member.deathDate !== '—'
    ? `${member.birthDate} &bull; ${member.deathDate}`
    : `${member.birthDate}`;

  const posX = Math.round(Number.isFinite(member.x) ? member.x : TREE_PAD_X);
  const posY = Math.round(Number.isFinite(member.y) ? member.y : TREE_PAD_Y);
  const roleLabel = member.role !== undefined && member.role !== null && String(member.role).trim() !== ''
    ? member.role
    : (member.gen ? `${member.gen}. gen.` : '');

  return `
    <article class="tree-person-card branch-${member.branch || 'family'}" id="person-${member.id}" data-person-id="${member.id}" style="left: ${posX}px; top: ${posY}px;">
      <!-- Top connector port (Child Input / Detach from parent) -->
      <div class="cms-tree-port cms-port-top" data-port="top" data-person-id="${member.id}" title="Horní bod (přetáhněte k rodiči nebo kliknutím odpojte od rodiče)"></div>

      <!-- Side connector port (Spouse link) -->
      <div class="cms-tree-port cms-port-spouse" data-port="spouse" data-person-id="${member.id}" title="Partnerský bod (přetáhněte na kartu partnera)">⚭</div>

      <button type="button" class="tree-person-trigger" title="Zobrazit detail osobnosti: ${member.name}">
        <div class="tree-person-summary">
          <div class="tree-person-role-tag">${roleLabel}</div>
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
  const roleHeader = (member.role && String(member.role).trim() !== '')
    ? member.role
    : (member.gen ? `${member.gen}. generace` : 'Člen rodu Pokorných');

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

  if (member.parentId && PERSON_MAP.has(member.parentId)) {
    const p = PERSON_MAP.get(member.parentId);
    pills.push(`<button type="button" class="relation-pill" data-jump-person="${p.id}">↑ Rodič: ${p.name}</button>`);
    if (p.spouseId && PERSON_MAP.has(p.spouseId)) {
      const pSpouse = PERSON_MAP.get(p.spouseId);
      pills.push(`<button type="button" class="relation-pill" data-jump-person="${pSpouse.id}">↑ Rodič: ${pSpouse.name}</button>`);
    }
  }

  if (member.spouseId && PERSON_MAP.has(member.spouseId)) {
    const sp = PERSON_MAP.get(member.spouseId);
    pills.push(`<button type="button" class="relation-pill" data-jump-person="${sp.id}">⚭ ${sp.name}</button>`);
  }

  const children = getCoupleChildren(member);
  children.forEach(ch => {
    pills.push(`<button type="button" class="relation-pill" data-jump-person="${ch.id}">↳ ${ch.name}</button>`);
  });

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
    getPan: () => ({ panX, panY }),
    shiftPan: (dx, dy) => {
      panX += dx;
      panY += dy;
      applyTransform();
    }
  };
  return panZoomController;
}
