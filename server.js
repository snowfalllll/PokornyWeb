/**
 * Pokorní z Příbora — Local Development & Self-Hosted Node.js Server
 * Serves static files AND provides the exact same `/api.php?action=...` endpoints
 * with Brute-Force rate limiting, CSRF protection, folder-organized uploads, and named restorable backups.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');

const PORT = process.env.PORT || 3000;
const BASE_DIR = __dirname;
const DATA_DIR = path.join(BASE_DIR, 'data');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const BACKUPS_INDEX_FILE = path.join(BACKUPS_DIR, 'backups-index.json');
const UPLOADS_DIR = path.join(BASE_DIR, 'uploads');
const USCHOVNA_DIR = path.join(BASE_DIR, 'uschovna');
const CONFIG_FILE = path.join(DATA_DIR, 'admin-config.json');
const CONTENT_JS_FILE = path.join(DATA_DIR, 'content.js');
const SITE_JSON_FILE = path.join(DATA_DIR, 'site-data.json');
const DRAFT_JSON_FILE = path.join(DATA_DIR, 'draft-data.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const DEFAULT_HASH = crypto.createHash('sha256').update('pribor1756').digest('hex');
if (!fs.existsSync(CONFIG_FILE)) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({
    passwordHash: DEFAULT_HASH,
    updatedAt: new Date().toISOString()
  }, null, 2), 'utf8');
}

const activeSessions = new Map();
const loginAttempts = new Map();

function getAdminConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.passwordHash) return parsed;
  } catch (e) {}
  return { passwordHash: DEFAULT_HASH };
}

function parseCookies(req) {
  const list = {};
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    const key = parts.shift().trim();
    const val = decodeURI(parts.join('='));
    list[key] = val;
  });
  return list;
}

function getSession(req) {
  const cookies = parseCookies(req);
  const token = cookies.pokorny_cms_token;
  if (!token || !activeSessions.has(token)) return null;
  return activeSessions.get(token);
}

function checkRateLimit(ip, res) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const entry = loginAttempts.get(ip);
  if (entry) {
    if (now - entry.firstAttempt > windowMs) {
      loginAttempts.delete(ip);
    } else if (entry.count >= 5) {
      const remMin = Math.max(1, Math.ceil((windowMs - (now - entry.firstAttempt)) / 60000));
      sendJson(res, 429, {
        ok: false,
        error: `Příliš mnoho neúspěšných pokusů o přihlášení. Zkuste to prosím znovu za ${remMin} min.`
      });
      return false;
    }
  }
  return true;
}

function recordFailedLogin(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now });
  } else {
    entry.count += 1;
  }
}

function sanitizeSegment(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeUploadFolder(folderInput) {
  const raw = String(folderInput || 'uploads').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!raw || raw === 'uploads') return 'uploads';
  const parts = raw.split('/').filter(Boolean);
  if (parts[0] === 'uploads') parts.shift();
  const cleanParts = parts.map(sanitizeSegment).filter(Boolean);
  return cleanParts.length ? `uploads/${cleanParts.join('/')}` : 'uploads';
}

function listMediaAndFolders() {
  const files = [];
  const folders = ['uploads'];

  const scanRecursive = (dirPath, relPrefix, isUploadsTree) => {
    if (!fs.existsSync(dirPath)) return;
    for (const entry of fs.readdirSync(dirPath)) {
      if (entry.startsWith('.')) continue;
      const full = path.join(dirPath, entry);
      const relPath = `${relPrefix}/${entry}`;
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        if (isUploadsTree) {
          folders.push(relPath);
        }
        scanRecursive(full, relPath, isUploadsTree);
      } else if (stat.isFile()) {
        const ext = path.extname(entry).toLowerCase().slice(1);
        let type = 'other';
        if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'].includes(ext)) type = 'image';
        else if (ext === 'pdf') type = 'pdf';
        else if (['mp3', 'wav', 'ogg', 'm4a', 'wma', 'flac'].includes(ext)) type = 'audio';
        files.push({
          name: entry,
          path: relPath,
          folder: relPrefix,
          type,
          size: stat.size,
          mtime: Math.floor(stat.mtimeMs / 1000)
        });
      }
    }
  };

  scanRecursive(UPLOADS_DIR, 'uploads', true);
  scanRecursive(USCHOVNA_DIR, 'uschovna', false);
  if (fs.existsSync(USCHOVNA_DIR)) {
    folders.push('uschovna');
  }
  files.sort((a, b) => b.mtime - a.mtime);
  return { files, folders };
}

function loadBackupsIndex() {
  let list = [];
  try {
    if (fs.existsSync(BACKUPS_INDEX_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(BACKUPS_INDEX_FILE, 'utf8'));
      if (Array.isArray(parsed)) list = parsed;
    }
  } catch (e) {}

  // Also index any legacy content-backup-*.js files not yet in index
  if (fs.existsSync(BACKUPS_DIR)) {
    const knownFiles = new Set(list.map(b => b.filename));
    for (const f of fs.readdirSync(BACKUPS_DIR)) {
      if ((f.startsWith('content-backup-') || f.startsWith('save-')) && (f.endsWith('.json') || f.endsWith('.js'))) {
        if (!knownFiles.has(f)) {
          const stat = fs.statSync(path.join(BACKUPS_DIR, f));
          const iso = new Date(stat.mtimeMs).toISOString();
          list.push({
            id: 'bkp-' + f.replace(/[^a-zA-Z0-9_-]/g, ''),
            name: `Automatická záloha (${iso.slice(0, 16).replace('T', ' ')})`,
            createdAt: iso,
            type: 'published',
            filename: f
          });
        }
      }
    }
  }

  list = list.filter(b => b && b.filename && fs.existsSync(path.join(BACKUPS_DIR, b.filename)));
  list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return list;
}

function saveBackupsIndex(list) {
  fs.writeFileSync(BACKUPS_INDEX_FILE, JSON.stringify(list, null, 2), 'utf8');
}

function createBackupSnapshot(siteData, customName, saveType = 'manual') {
  const now = new Date();
  const iso = now.toISOString();
  const stamp = iso.replace(/[:.]/g, '-').slice(0, 19);
  const id = `save-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
  const filename = `${id}.json`;
  const defaultLabel = saveType === 'published'
    ? `Publikovaná verze (${now.toLocaleString('cs-CZ')})`
    : `Rozpracované uložení (${now.toLocaleString('cs-CZ')})`;

  const name = (customName && String(customName).trim()) ? String(customName).trim() : defaultLabel;
  fs.writeFileSync(path.join(BACKUPS_DIR, filename), JSON.stringify(siteData, null, 2), 'utf8');

  const list = loadBackupsIndex();
  list.unshift({
    id,
    name,
    createdAt: iso,
    type: saveType,
    filename
  });

  // Keep up to 40 snapshots
  while (list.length > 40) {
    const removed = list.pop();
    if (removed && removed.filename) {
      try { fs.unlinkSync(path.join(BACKUPS_DIR, removed.filename)); } catch (e) {}
    }
  }
  saveBackupsIndex(list);
  return { entry: list[0], backups: list };
}

function readBackupSnapshotData(entry) {
  const fullPath = path.join(BACKUPS_DIR, entry.filename);
  if (!fs.existsSync(fullPath)) return null;
  const raw = fs.readFileSync(fullPath, 'utf8');
  if (entry.filename.endsWith('.js')) {
    const cleaned = raw.replace(/^\s*const\s+SITE_DATA\s*=\s*/, '').replace(/;\s*$/, '');
    return JSON.parse(cleaned);
  }
  return JSON.parse(raw);
}

function sendJson(res, statusCode, data, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    ...extraHeaders
  });
  res.end(JSON.stringify(data));
}

function readRequestBody(req, maxBytes = 60 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', chunk => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipartSingleFile(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!match) return null;
  const boundary = '--' + (match[1] || match[2]);
  const boundaryBuf = Buffer.from(boundary);

  let pos = 0;
  let foundFile = null;
  const fields = {};

  while (pos < buffer.length) {
    const startIdx = buffer.indexOf(boundaryBuf, pos);
    if (startIdx === -1) break;
    const nextIdx = buffer.indexOf(boundaryBuf, startIdx + boundaryBuf.length);
    if (nextIdx === -1) break;

    const partStart = startIdx + boundaryBuf.length + 2;
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), partStart);
    if (headerEnd !== -1 && headerEnd < nextIdx) {
      const headerStr = buffer.slice(partStart, headerEnd).toString('utf8');
      const dataStart = headerEnd + 4;
      const dataEnd = nextIdx - 2; // strip \r\n before next boundary
      const nameMatch = /name="([^"]+)"/i.exec(headerStr);
      const fnMatch = /filename="([^"]+)"/i.exec(headerStr);
      if (fnMatch) {
        foundFile = {
          filename: fnMatch[1],
          fileBuffer: buffer.slice(dataStart, dataEnd)
        };
      } else if (nameMatch) {
        fields[nameMatch[1]] = buffer.slice(dataStart, dataEnd).toString('utf8').trim();
      }
    }
    pos = nextIdx;
  }

  if (!foundFile) return null;
  return { ...foundFile, fields };
}

function sanitizeFileName(origName) {
  const ext = path.extname(origName).toLowerCase().slice(1);
  const base = sanitizeSegment(path.basename(origName, path.extname(origName))) || 'soubor';
  return { base, ext };
}

function readDraftData() {
  try {
    if (fs.existsSync(DRAFT_JSON_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DRAFT_JSON_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch (e) {}
  return null;
}

async function handleApiRequest(req, res, parsedUrl) {
  const action = parsedUrl.query.action || 'status';
  const clientIp = req.socket.remoteAddress || 'local';

  if (action === 'admin_bundle') {
    const sess = getSession(req);
    if (!sess) {
      res.writeHead(401, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end('/* 401 Unauthorized: CMS bundle requires login at /admin.html */\n');
      return;
    }
    const adminJsPath = path.join(BASE_DIR, 'js', 'admin.js');
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(adminJsPath).pipe(res);
    return;
  }

  if (action === 'admin_css') {
    const sess = getSession(req);
    if (!sess) {
      res.writeHead(401, {
        'Content-Type': 'text/css; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end('/* 401 Unauthorized */\n');
      return;
    }
    const adminCssPath = path.join(BASE_DIR, 'css', 'admin.css');
    res.writeHead(200, {
      'Content-Type': 'text/css; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(adminCssPath).pipe(res);
    return;
  }

  if (action === 'status') {
    const sess = getSession(req);
    const draftData = sess ? readDraftData() : null;
    const media = sess ? listMediaAndFolders() : { files: [], folders: [] };
    const backups = sess ? loadBackupsIndex() : [];
    return sendJson(res, 200, {
      ok: true,
      authenticated: Boolean(sess),
      csrfToken: sess ? sess.csrfToken : null,
      hasDraft: Boolean(draftData),
      draftData,
      files: media.files,
      folders: media.folders,
      backups,
      lastSavedAt: backups[0]?.createdAt || null
    });
  }

  if (action === 'login' && req.method === 'POST') {
    if (!checkRateLimit(clientIp, res)) return;
    const raw = await readRequestBody(req);
    let body = {};
    try { body = JSON.parse(raw.toString('utf8')); } catch (e) {}
    const password = String(body.password || '');
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    const cfg = getAdminConfig();

    if (hash === cfg.passwordHash) {
      loginAttempts.delete(clientIp);
      const token = crypto.randomBytes(24).toString('hex');
      const csrfToken = crypto.randomBytes(24).toString('hex');
      activeSessions.set(token, { csrfToken, createdAt: Date.now() });
      const draftData = readDraftData();
      const media = listMediaAndFolders();
      const backups = loadBackupsIndex();
      return sendJson(res, 200, {
        ok: true,
        authenticated: true,
        csrfToken,
        hasDraft: Boolean(draftData),
        draftData,
        files: media.files,
        folders: media.folders,
        backups,
        lastSavedAt: backups[0]?.createdAt || null
      }, {
        'Set-Cookie': `pokorny_cms_token=${token}; Path=/; HttpOnly; SameSite=Strict`
      });
    } else {
      recordFailedLogin(clientIp);
      return sendJson(res, 403, { ok: false, error: 'Nesprávné heslo.' });
    }
  }

  if (action === 'logout') {
    const cookies = parseCookies(req);
    if (cookies.pokorny_cms_token) activeSessions.delete(cookies.pokorny_cms_token);
    return sendJson(res, 200, { ok: true, authenticated: false }, {
      'Set-Cookie': 'pokorny_cms_token=; Path=/; Max-Age=0'
    });
  }

  const sess = getSession(req);
  if (!sess) {
    return sendJson(res, 401, { ok: false, error: 'Nejste přihlášeni. Prosím přihlaste se heslem.' });
  }

  const headerCsrf = req.headers['x-csrf-token'];
  if (!headerCsrf || headerCsrf !== sess.csrfToken) {
    return sendJson(res, 403, { ok: false, error: 'Neplatný bezpečnostní CSRF token. Obnovte prosím stránku.' });
  }

  if (action === 'save_draft' && req.method === 'POST') {
    const raw = await readRequestBody(req);
    let payload = {};
    try { payload = JSON.parse(raw.toString('utf8')); } catch (e) {}

    if (!payload || typeof payload.siteData !== 'object') {
      return sendJson(res, 400, { ok: false, error: 'Neplatný formát dat konceptu.' });
    }

    const prettyJson = JSON.stringify(payload.siteData, null, 2);
    fs.writeFileSync(DRAFT_JSON_FILE, prettyJson, 'utf8');
    const { entry, backups } = createBackupSnapshot(payload.siteData, payload.saveName, 'draft');

    return sendJson(res, 200, {
      ok: true,
      savedDraftAt: entry.createdAt,
      backupEntry: entry,
      backups
    });
  }

  if (action === 'save' && req.method === 'POST') {
    const raw = await readRequestBody(req);
    let payload = {};
    try { payload = JSON.parse(raw.toString('utf8')); } catch (e) {}

    if (!payload || typeof payload.siteData !== 'object') {
      return sendJson(res, 400, { ok: false, error: 'Neplatný formát dat.' });
    }

    const prettyJson = JSON.stringify(payload.siteData, null, 2);
    const jsContent = `const SITE_DATA = ${prettyJson};\n`;
    fs.writeFileSync(CONTENT_JS_FILE, jsContent, 'utf8');
    fs.writeFileSync(SITE_JSON_FILE, prettyJson, 'utf8');
    if (fs.existsSync(DRAFT_JSON_FILE)) {
      try { fs.unlinkSync(DRAFT_JSON_FILE); } catch (e) {}
    }

    const { entry, backups } = createBackupSnapshot(payload.siteData, payload.saveName, 'published');

    return sendJson(res, 200, {
      ok: true,
      savedAt: entry.createdAt,
      backupEntry: entry,
      backups
    });
  }

  if (action === 'list_backups') {
    const backups = loadBackupsIndex();
    return sendJson(res, 200, { ok: true, backups });
  }

  if (action === 'rename_backup' && req.method === 'POST') {
    const raw = await readRequestBody(req);
    let body = {};
    try { body = JSON.parse(raw.toString('utf8')); } catch (e) {}
    const list = loadBackupsIndex();
    const target = list.find(b => b.id === body.id);
    if (!target) return sendJson(res, 404, { ok: false, error: 'Uložení nebylo nalezeno.' });
    target.name = String(body.name || '').trim() || target.name;
    saveBackupsIndex(list);
    return sendJson(res, 200, { ok: true, backups: list });
  }

  if (action === 'restore_backup' && req.method === 'POST') {
    const raw = await readRequestBody(req);
    let body = {};
    try { body = JSON.parse(raw.toString('utf8')); } catch (e) {}
    const list = loadBackupsIndex();
    const target = list.find(b => b.id === body.id);
    if (!target) return sendJson(res, 404, { ok: false, error: 'Záloha nebyla nalezena.' });
    try {
      const siteData = readBackupSnapshotData(target);
      if (!siteData) throw new Error('Nelze načíst soubor zálohy.');
      fs.writeFileSync(DRAFT_JSON_FILE, JSON.stringify(siteData, null, 2), 'utf8');
      return sendJson(res, 200, { ok: true, siteData, restoredFrom: target });
    } catch (e) {
      return sendJson(res, 500, { ok: false, error: e.message });
    }
  }

  if (action === 'delete_backup' && req.method === 'POST') {
    const raw = await readRequestBody(req);
    let body = {};
    try { body = JSON.parse(raw.toString('utf8')); } catch (e) {}
    let list = loadBackupsIndex();
    const target = list.find(b => b.id === body.id);
    if (target) {
      try { fs.unlinkSync(path.join(BACKUPS_DIR, target.filename)); } catch (e) {}
      list = list.filter(b => b.id !== body.id);
      saveBackupsIndex(list);
    }
    return sendJson(res, 200, { ok: true, backups: list });
  }

  if (action === 'create_folder' && req.method === 'POST') {
    const raw = await readRequestBody(req);
    let body = {};
    try { body = JSON.parse(raw.toString('utf8')); } catch (e) {}
    const parentRel = normalizeUploadFolder(body.parentFolder || 'uploads');
    const cleanName = sanitizeSegment(body.folderName || '');
    if (!cleanName) {
      return sendJson(res, 400, { ok: false, error: 'Zadejte platný název složky.' });
    }
    const newFolderRel = `${parentRel}/${cleanName}`;
    const fullDir = path.join(BASE_DIR, newFolderRel);
    if (!fs.existsSync(fullDir)) {
      fs.mkdirSync(fullDir, { recursive: true });
    }
    const media = listMediaAndFolders();
    return sendJson(res, 200, {
      ok: true,
      createdFolder: newFolderRel,
      files: media.files,
      folders: media.folders
    });
  }

  if (action === 'delete_folder' && req.method === 'POST') {
    const raw = await readRequestBody(req);
    let body = {};
    try { body = JSON.parse(raw.toString('utf8')); } catch (e) {}
    const folderRel = normalizeUploadFolder(body.folderPath || '');
    if (folderRel === 'uploads') {
      return sendJson(res, 400, { ok: false, error: 'Kořenovou složku uploads nelze smazat.' });
    }
    const fullDir = path.join(BASE_DIR, folderRel);
    if (fs.existsSync(fullDir) && fs.statSync(fullDir).isDirectory()) {
      const contents = fs.readdirSync(fullDir);
      if (contents.length > 0) {
        return sendJson(res, 400, { ok: false, error: 'Složka není prázdná. Nejprve přesuňte nebo smažte soubory uvnitř.' });
      }
      fs.rmdirSync(fullDir);
    }
    const media = listMediaAndFolders();
    return sendJson(res, 200, { ok: true, files: media.files, folders: media.folders });
  }

  if (action === 'move_file' && req.method === 'POST') {
    const raw = await readRequestBody(req);
    let body = {};
    try { body = JSON.parse(raw.toString('utf8')); } catch (e) {}
    const fromRel = String(body.fromPath || '').replace(/\\/g, '/');
    const targetFolderRel = normalizeUploadFolder(body.targetFolder || 'uploads');
    if (!fromRel.startsWith('uploads/') || fromRel.includes('..')) {
      return sendJson(res, 400, { ok: false, error: 'Přesouvat lze pouze soubory ve složce uploads/.' });
    }
    const srcFull = path.join(BASE_DIR, fromRel);
    if (!fs.existsSync(srcFull) || !fs.statSync(srcFull).isFile()) {
      return sendJson(res, 404, { ok: false, error: 'Zdrojový soubor neexistuje.' });
    }
    const destDirFull = path.join(BASE_DIR, targetFolderRel);
    if (!fs.existsSync(destDirFull)) {
      fs.mkdirSync(destDirFull, { recursive: true });
    }
    const fileName = path.basename(srcFull);
    const destFull = path.join(destDirFull, fileName);
    if (srcFull !== destFull) {
      fs.renameSync(srcFull, destFull);
    }
    const media = listMediaAndFolders();
    return sendJson(res, 200, {
      ok: true,
      newPath: `${targetFolderRel}/${fileName}`,
      files: media.files,
      folders: media.folders
    });
  }

  if (action === 'upload' && req.method === 'POST') {
    const raw = await readRequestBody(req);
    const parsedFile = parseMultipartSingleFile(raw, req.headers['content-type']);
    if (!parsedFile) {
      return sendJson(res, 400, { ok: false, error: 'Soubor se nepodařilo přečíst.' });
    }

    const folderRel = normalizeUploadFolder(parsedUrl.query.folder || parsedFile.fields?.folder || 'uploads');
    const targetDirFull = path.join(BASE_DIR, folderRel);
    if (!fs.existsSync(targetDirFull)) {
      fs.mkdirSync(targetDirFull, { recursive: true });
    }

    const { base, ext } = sanitizeFileName(parsedFile.filename);
    const allowed = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'pdf', 'mp3', 'wav', 'ogg', 'm4a', 'wma', 'flac'];
    if (!allowed.includes(ext)) {
      return sendJson(res, 400, { ok: false, error: `Nepovolený typ souboru (.${ext}).` });
    }

    let finalName = `${base}.${ext}`;
    let counter = 1;
    while (fs.existsSync(path.join(targetDirFull, finalName))) {
      finalName = `${base}-${counter}.${ext}`;
      counter++;
    }

    fs.writeFileSync(path.join(targetDirFull, finalName), parsedFile.fileBuffer);
    const media = listMediaAndFolders();

    return sendJson(res, 200, {
      ok: true,
      path: `${folderRel}/${finalName}`,
      folder: folderRel,
      name: finalName,
      files: media.files,
      folders: media.folders
    });
  }

  if (action === 'delete_file' && req.method === 'POST') {
    const raw = await readRequestBody(req);
    let body = {};
    try { body = JSON.parse(raw.toString('utf8')); } catch (e) {}
    const relPath = String(body.path || '').replace(/\\/g, '/');

    if (!relPath.startsWith('uploads/') || relPath.includes('..')) {
      return sendJson(res, 400, { ok: false, error: 'Mazat lze pouze soubory ve složce uploads/.' });
    }

    const fullPath = path.join(BASE_DIR, relPath);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      fs.unlinkSync(fullPath);
    }

    const media = listMediaAndFolders();
    return sendJson(res, 200, {
      ok: true,
      files: media.files,
      folders: media.folders
    });
  }

  if (action === 'change_password' && req.method === 'POST') {
    const raw = await readRequestBody(req);
    let body = {};
    try { body = JSON.parse(raw.toString('utf8')); } catch (e) {}
    const newPassword = String(body.newPassword || '').trim();
    if (newPassword.length < 6) {
      return sendJson(res, 400, { ok: false, error: 'Nové heslo musí mít alespoň 6 znaků.' });
    }
    const newHash = crypto.createHash('sha256').update(newPassword).digest('hex');
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({
      passwordHash: newHash,
      updatedAt: new Date().toISOString()
    }, null, 2), 'utf8');
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 400, { ok: false, error: 'Neznámá akce API.' });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.wma': 'audio/x-ms-wma'
};

const BLOCKED_PATTERNS = [
  /^\/data\/(admin-config\.json|login-attempts\.json|site-data\.json|draft-data\.json)$/i,
  /^\/data\/backups(\/|$)/i,
  /^\/js\/admin\.js$/i,
  /^\/css\/admin\.css$/i,
  /^\/notes(\/|$)/i,
  /^\/server\.js$/i,
  /\/\./
];

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = url.parse(req.url, true);
    let pathname = decodeURIComponent(parsedUrl.pathname || '/');

    if (pathname === '/api.php') {
      return await handleApiRequest(req, res, parsedUrl);
    }

    if (BLOCKED_PATTERNS.some(rx => rx.test(pathname))) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Přístup odepřen');
      return;
    }

    if (pathname === '/' || pathname === '') pathname = '/index.html';
    if (!path.extname(pathname) && fs.existsSync(path.join(BASE_DIR, pathname + '.html'))) {
      pathname = pathname + '.html';
    }

    const safeSuffix = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(BASE_DIR, safeSuffix);

    if (!filePath.startsWith(BASE_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      const page404 = path.join(BASE_DIR, '404.html');
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      if (fs.existsSync(page404)) {
        fs.createReadStream(page404).pipe(res);
      } else {
        res.end('404 Stránka nenalezena');
      }
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
});

server.listen(PORT, () => {
  console.log(`Server Pokorní z Příbora běží na http://localhost:${PORT}`);
  console.log(`CMS Administrace: http://localhost:${PORT}/admin.html (výchozí heslo: pribor1756)`);
});
