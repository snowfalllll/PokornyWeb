/**
 * Pokorní z Příbora — Local Development & Self-Hosted Node.js Server
 * Serves static files AND provides the exact same `/api.php?action=...` endpoints
 * so you can run the CMS locally with `node server.js` (zero npm packages needed)
 * or deploy the folder directly to any Czech PHP hosting (Wedos, Forpsi, Active24).
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
const UPLOADS_DIR = path.join(BASE_DIR, 'uploads');
const USCHOVNA_DIR = path.join(BASE_DIR, 'uschovna');
const CONFIG_FILE = path.join(DATA_DIR, 'admin-config.json');
const CONTENT_JS_FILE = path.join(DATA_DIR, 'content.js');
const SITE_JSON_FILE = path.join(DATA_DIR, 'site-data.json');

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

const activeSessions = new Set();

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

function isAuthenticated(req) {
  const cookies = parseCookies(req);
  const token = cookies.pokorny_cms_token;
  return Boolean(token && activeSessions.has(token));
}

function listMediaFiles() {
  const files = [];
  const scanFolder = (dirPath, prefix) => {
    if (!fs.existsSync(dirPath)) return;
    for (const entry of fs.readdirSync(dirPath)) {
      if (entry.startsWith('.')) continue;
      const full = path.join(dirPath, entry);
      const stat = fs.statSync(full);
      if (stat.isFile()) {
        const ext = path.extname(entry).toLowerCase().slice(1);
        let type = 'other';
        if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'].includes(ext)) type = 'image';
        else if (ext === 'pdf') type = 'pdf';
        else if (['mp3', 'wav', 'ogg', 'm4a', 'wma', 'flac'].includes(ext)) type = 'audio';
        files.push({
          name: entry,
          path: `${prefix}/${entry}`,
          folder: prefix,
          type,
          size: stat.size,
          mtime: Math.floor(stat.mtimeMs / 1000)
        });
      }
    }
  };
  scanFolder(UPLOADS_DIR, 'uploads');
  scanFolder(USCHOVNA_DIR, 'uschovna');
  files.sort((a, b) => b.mtime - a.mtime);
  return files;
}

function sendJson(res, statusCode, data, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
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

  const startIdx = buffer.indexOf(boundaryBuf);
  if (startIdx === -1) return null;

  const headerStart = startIdx + boundaryBuf.length + 2; // skip \r\n
  const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), headerStart);
  if (headerEnd === -1) return null;

  const headerStr = buffer.slice(headerStart, headerEnd).toString('utf8');
  const fnMatch = /filename="([^"]+)"/i.exec(headerStr);
  if (!fnMatch) return null;
  const filename = fnMatch[1];

  const dataStart = headerEnd + 4;
  const nextBoundaryIdx = buffer.indexOf(Buffer.from('\r\n' + boundary), dataStart);
  if (nextBoundaryIdx === -1) return null;

  const fileBuffer = buffer.slice(dataStart, nextBoundaryIdx);
  return { filename, fileBuffer };
}

function sanitizeFileName(origName) {
  const ext = path.extname(origName).toLowerCase().slice(1);
  const base = path.basename(origName, path.extname(origName))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'soubor';
  return { base, ext };
}

async function handleApiRequest(req, res, parsedUrl) {
  const action = parsedUrl.query.action || 'status';

  if (action === 'status') {
    const authed = isAuthenticated(req);
    return sendJson(res, 200, {
      ok: true,
      authenticated: authed,
      files: authed ? listMediaFiles() : []
    });
  }

  if (action === 'login' && req.method === 'POST') {
    const raw = await readRequestBody(req);
    let body = {};
    try { body = JSON.parse(raw.toString('utf8')); } catch (e) {}
    const password = String(body.password || '');
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    const cfg = getAdminConfig();

    if (hash === cfg.passwordHash) {
      const token = crypto.randomBytes(24).toString('hex');
      activeSessions.add(token);
      return sendJson(res, 200, {
        ok: true,
        authenticated: true,
        files: listMediaFiles()
      }, {
        'Set-Cookie': `pokorny_cms_token=${token}; Path=/; HttpOnly; SameSite=Lax`
      });
    } else {
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

  if (!isAuthenticated(req)) {
    return sendJson(res, 401, { ok: false, error: 'Nejste přihlášeni. Prosím přihlaste se heslem.' });
  }

  if (action === 'save' && req.method === 'POST') {
    const raw = await readRequestBody(req);
    let payload = {};
    try { payload = JSON.parse(raw.toString('utf8')); } catch (e) {}

    if (!payload || typeof payload.siteData !== 'object') {
      return sendJson(res, 400, { ok: false, error: 'Neplatný formát dat.' });
    }

    if (fs.existsSync(CONTENT_JS_FILE)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const backupFile = path.join(BACKUPS_DIR, `content-backup-${stamp}.js`);
      fs.copyFileSync(CONTENT_JS_FILE, backupFile);

      const backups = fs.readdirSync(BACKUPS_DIR)
        .filter(f => f.startsWith('content-backup-'))
        .sort();
      while (backups.length > 15) {
        const oldest = backups.shift();
        try { fs.unlinkSync(path.join(BACKUPS_DIR, oldest)); } catch (e) {}
      }
    }

    const prettyJson = JSON.stringify(payload.siteData, null, 2);
    const jsContent = `const SITE_DATA = ${prettyJson};\n`;
    fs.writeFileSync(CONTENT_JS_FILE, jsContent, 'utf8');
    fs.writeFileSync(SITE_JSON_FILE, prettyJson, 'utf8');

    return sendJson(res, 200, {
      ok: true,
      savedAt: new Date().toISOString()
    });
  }

  if (action === 'upload' && req.method === 'POST') {
    const raw = await readRequestBody(req);
    const parsedFile = parseMultipartSingleFile(raw, req.headers['content-type']);
    if (!parsedFile) {
      return sendJson(res, 400, { ok: false, error: 'Soubor se nepodařilo přečíst.' });
    }

    const { base, ext } = sanitizeFileName(parsedFile.filename);
    const allowed = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'pdf', 'mp3', 'wav', 'ogg', 'm4a', 'wma', 'flac'];
    if (!allowed.includes(ext)) {
      return sendJson(res, 400, { ok: false, error: `Nepovolený typ souboru (.${ext}).` });
    }

    let finalName = `${base}.${ext}`;
    let counter = 1;
    while (fs.existsSync(path.join(UPLOADS_DIR, finalName))) {
      finalName = `${base}-${counter}.${ext}`;
      counter++;
    }

    fs.writeFileSync(path.join(UPLOADS_DIR, finalName), parsedFile.fileBuffer);

    return sendJson(res, 200, {
      ok: true,
      path: `uploads/${finalName}`,
      name: finalName,
      files: listMediaFiles()
    });
  }

  if (action === 'delete_file' && req.method === 'POST') {
    const raw = await readRequestBody(req);
    let body = {};
    try { body = JSON.parse(raw.toString('utf8')); } catch (e) {}
    const relPath = String(body.path || '');

    if (!relPath.startsWith('uploads/') || relPath.includes('..')) {
      return sendJson(res, 400, { ok: false, error: 'Mazat lze pouze soubory ve složce uploads/.' });
    }

    const fullPath = path.join(BASE_DIR, relPath);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      fs.unlinkSync(fullPath);
    }

    return sendJson(res, 200, {
      ok: true,
      files: listMediaFiles()
    });
  }

  if (action === 'change_password' && req.method === 'POST') {
    const raw = await readRequestBody(req);
    let body = {};
    try { body = JSON.parse(raw.toString('utf8')); } catch (e) {}
    const newPassword = String(body.newPassword || '').trim();
    if (newPassword.length < 4) {
      return sendJson(res, 400, { ok: false, error: 'Nové heslo musí mít alespoň 4 znaky.' });
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

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = url.parse(req.url, true);
    let pathname = decodeURIComponent(parsedUrl.pathname || '/');

    if (pathname === '/api.php') {
      return await handleApiRequest(req, res, parsedUrl);
    }

    if (pathname === '/' || pathname === '') pathname = '/index.html';
    if (pathname === '/admin' || pathname === '/admin/') pathname = '/admin.html';

    const safeSuffix = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(BASE_DIR, safeSuffix);

    if (!filePath.startsWith(BASE_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Nenalezeno');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
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
