<?php
/**
 * Pokorní z Příbora — CMS Backend API (pro standardní český PHP webhosting)
 * Zajišťuje:
 * - Přihlášení heslem (SHA-256 hash v data/admin-config.json) + Brute-Force Rate Limit
 * - CSRF ochrana pro všechny změnové požadavky (X-CSRF-Token)
 * - Pojmenovaná historie uložení a obnovitelné zálohy v data/backups/ (backups-index.json)
 * - Správa složek a souborů ve složce uploads/ (nahrávání přímo do složek, přesouvání, vytváření a mazání složek)
 */

$isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (isset($_SERVER['SERVER_PORT']) && $_SERVER['SERVER_PORT'] == 443);
session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'secure' => $isHttps,
    'httponly' => true,
    'samesite' => 'Strict'
]);
session_start();

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('Cache-Control: no-store, no-cache, must-revalidate');

$baseDir = __DIR__;
$dataDir = $baseDir . '/data';
$backupsDir = $dataDir . '/backups';
$backupsIndexFile = $backupsDir . '/backups-index.json';
$uploadsDir = $baseDir . '/uploads';
$uschovnaDir = $baseDir . '/uschovna';
$configFile = $dataDir . '/admin-config.json';
$attemptsFile = $dataDir . '/login-attempts.json';
$contentJsFile = $dataDir . '/content.js';
$siteJsonFile = $dataDir . '/site-data.json';
$draftJsonFile = $dataDir . '/draft-data.json';

if (!is_dir($dataDir)) @mkdir($dataDir, 0755, true);
if (!is_dir($backupsDir)) @mkdir($backupsDir, 0755, true);
if (!is_dir($uploadsDir)) @mkdir($uploadsDir, 0755, true);

$defaultPasswordHash = hash('sha256', 'pribor1756');
if (!file_exists($configFile)) {
    file_put_contents($configFile, json_encode([
        'passwordHash' => $defaultPasswordHash,
        'updatedAt' => date('c')
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

function getAdminConfig($configFile, $defaultPasswordHash) {
    if (!file_exists($configFile)) {
        return ['passwordHash' => $defaultPasswordHash];
    }
    $raw = @file_get_contents($configFile);
    $parsed = @json_decode($raw, true);
    if (!is_array($parsed) || empty($parsed['passwordHash'])) {
        return ['passwordHash' => $defaultPasswordHash];
    }
    return $parsed;
}

function getClientIp() {
    return isset($_SERVER['REMOTE_ADDR']) ? (string)$_SERVER['REMOTE_ADDR'] : 'unknown';
}

function checkRateLimit($attemptsFile) {
    $ip = getClientIp();
    $now = time();
    $windowSeconds = 15 * 60;
    $maxAttempts = 5;

    $data = [];
    if (file_exists($attemptsFile)) {
        $parsed = @json_decode(@file_get_contents($attemptsFile), true);
        if (is_array($parsed)) $data = $parsed;
    }

    foreach ($data as $k => $entry) {
        if (!isset($entry['firstAttempt']) || ($now - $entry['firstAttempt']) > $windowSeconds) {
            unset($data[$k]);
        }
    }

    if (isset($data[$ip]) && $data[$ip]['count'] >= $maxAttempts) {
        $remaining = max(1, ceil(($windowSeconds - ($now - $data[$ip]['firstAttempt'])) / 60));
        http_response_code(429);
        echo json_encode([
            'ok' => false,
            'error' => "Příliš mnoho neúspěšných pokusů o přihlášení. Zkuste to prosím znovu za {$remaining} min."
        ]);
        exit;
    }
    return $data;
}

function recordFailedLogin($attemptsFile, $data) {
    $ip = getClientIp();
    $now = time();
    if (!isset($data[$ip])) {
        $data[$ip] = ['count' => 1, 'firstAttempt' => $now];
    } else {
        $data[$ip]['count']++;
    }
    @file_put_contents($attemptsFile, json_encode($data));
}

function clearFailedLogin($attemptsFile, $data) {
    $ip = getClientIp();
    if (isset($data[$ip])) {
        unset($data[$ip]);
        @file_put_contents($attemptsFile, json_encode($data));
    }
}

function isAuthenticated() {
    return !empty($_SESSION['pokorny_cms_auth']) && $_SESSION['pokorny_cms_auth'] === true;
}

function getCsrfToken() {
    if (empty($_SESSION['pokorny_csrf_token'])) {
        $_SESSION['pokorny_csrf_token'] = bin2hex(random_bytes(24));
    }
    return $_SESSION['pokorny_csrf_token'];
}

function requireAuthAndCsrf() {
    if (!isAuthenticated()) {
        http_response_code(401);
        echo json_encode(['ok' => false, 'error' => 'Nejste přihlášeni. Prosím přihlaste se heslem.']);
        exit;
    }
    $headerToken = isset($_SERVER['HTTP_X_CSRF_TOKEN']) ? (string)$_SERVER['HTTP_X_CSRF_TOKEN'] : '';
    $sessionToken = getCsrfToken();
    if ($headerToken === '' || !hash_equals($sessionToken, $headerToken)) {
        http_response_code(403);
        echo json_encode(['ok' => false, 'error' => 'Neplatný bezpečnostní CSRF token. Obnovte prosím stránku.']);
        exit;
    }
}

function sanitizeSegment($str) {
    $safe = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', (string)$str);
    if (!$safe) $safe = (string)$str;
    $safe = preg_replace('/[^a-zA-Z0-9_-]+/', '-', $safe);
    return trim($safe, '-');
}

function normalizeUploadFolder($folderInput) {
    $raw = trim(str_replace('\\', '/', (string)$folderInput), '/');
    if ($raw === '' || $raw === 'uploads') return 'uploads';
    $parts = array_values(array_filter(explode('/', $raw)));
    if (isset($parts[0]) && $parts[0] === 'uploads') {
        array_shift($parts);
    }
    $clean = [];
    foreach ($parts as $p) {
        $s = sanitizeSegment($p);
        if ($s !== '') $clean[] = $s;
    }
    return count($clean) > 0 ? 'uploads/' . implode('/', $clean) : 'uploads';
}

function listMediaAndFolders($uploadsDir, $uschovnaDir) {
    $files = [];
    $folders = ['uploads'];

    $scanRecursive = function($dirPath, $relPrefix, $isUploadsTree) use (&$files, &$folders, &$scanRecursive) {
        if (!is_dir($dirPath)) return;
        foreach (scandir($dirPath) as $entry) {
            if ($entry === '.' || $entry === '..' || $entry[0] === '.') continue;
            $full = $dirPath . '/' . $entry;
            $relPath = $relPrefix . '/' . $entry;
            if (is_dir($full)) {
                if ($isUploadsTree) {
                    $folders[] = $relPath;
                }
                $scanRecursive($full, $relPath, $isUploadsTree);
            } elseif (is_file($full)) {
                $ext = strtolower(pathinfo($entry, PATHINFO_EXTENSION));
                $type = 'other';
                if (in_array($ext, ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'])) $type = 'image';
                elseif ($ext === 'pdf') $type = 'pdf';
                elseif (in_array($ext, ['mp3', 'wav', 'ogg', 'm4a', 'wma', 'flac'])) $type = 'audio';

                $files[] = [
                    'name' => $entry,
                    'path' => $relPath,
                    'folder' => $relPrefix,
                    'type' => $type,
                    'size' => filesize($full),
                    'mtime' => filemtime($full)
                ];
            }
        }
    };

    $scanRecursive($uploadsDir, 'uploads', true);
    $scanRecursive($uschovnaDir, 'uschovna', false);
    if (is_dir($uschovnaDir)) {
        $folders[] = 'uschovna';
    }
    usort($files, function($a, $b) { return $b['mtime'] - $a['mtime']; });
    return ['files' => $files, 'folders' => $folders];
}

function loadBackupsIndex($backupsDir, $backupsIndexFile) {
    $list = [];
    if (file_exists($backupsIndexFile)) {
        $parsed = @json_decode(@file_get_contents($backupsIndexFile), true);
        if (is_array($parsed)) $list = $parsed;
    }

    $known = [];
    foreach ($list as $b) {
        if (isset($b['filename'])) $known[$b['filename']] = true;
    }

    if (is_dir($backupsDir)) {
        foreach (scandir($backupsDir) as $f) {
            if (( strpos($f, 'content-backup-') === 0 || strpos($f, 'save-') === 0 ) &&
                ( substr($f, -5) === '.json' || substr($f, -3) === '.js' )) {
                if (!isset($known[$f])) {
                    $mtime = filemtime($backupsDir . '/' . $f);
                    $iso = date('c', $mtime);
                    $list[] = [
                        'id' => 'bkp-' . preg_replace('/[^a-zA-Z0-9_-]/', '', $f),
                        'name' => 'Automatická záloha (' . date('d. m. Y H:i', $mtime) . ')',
                        'createdAt' => $iso,
                        'type' => 'published',
                        'filename' => $f
                    ];
                }
            }
        }
    }

    $filtered = [];
    foreach ($list as $b) {
        if (isset($b['filename']) && file_exists($backupsDir . '/' . $b['filename'])) {
            $filtered[] = $b;
        }
    }
    usort($filtered, function($a, $b) {
        return strtotime($b['createdAt']) - strtotime($a['createdAt']);
    });
    return $filtered;
}

function saveBackupsIndex($backupsIndexFile, $list) {
    @file_put_contents($backupsIndexFile, json_encode($list, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX);
}

function createBackupSnapshot($backupsDir, $backupsIndexFile, $siteData, $customName, $saveType = 'manual') {
    $iso = date('c');
    $stamp = date('Y-m-d_H-i-s');
    $id = 'save-' . $stamp . '-' . substr(bin2hex(random_bytes(3)), 0, 4);
    $filename = $id . '.json';
    $defaultLabel = ($saveType === 'published')
        ? 'Publikovaná verze (' . date('d. m. Y H:i') . ')'
        : 'Rozpracované uložení (' . date('d. m. Y H:i') . ')';
    $name = (isset($customName) && trim((string)$customName) !== '') ? trim((string)$customName) : $defaultLabel;

    $pretty = json_encode($siteData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    @file_put_contents($backupsDir . '/' . $filename, $pretty, LOCK_EX);

    $list = loadBackupsIndex($backupsDir, $backupsIndexFile);
    array_unshift($list, [
        'id' => $id,
        'name' => $name,
        'createdAt' => $iso,
        'type' => $saveType,
        'filename' => $filename
    ]);

    while (count($list) > 40) {
        $removed = array_pop($list);
        if (isset($removed['filename'])) {
            @unlink($backupsDir . '/' . $removed['filename']);
        }
    }
    saveBackupsIndex($backupsIndexFile, $list);
    return ['entry' => $list[0], 'backups' => $list];
}

function readBackupSnapshotData($backupsDir, $entry) {
    $full = $backupsDir . '/' . $entry['filename'];
    if (!file_exists($full)) return null;
    $raw = @file_get_contents($full);
    if (substr($entry['filename'], -3) === '.js') {
        $cleaned = preg_replace('/^\s*const\s+SITE_DATA\s*=\s*/', '', $raw);
        $cleaned = preg_replace('/;\s*$/', '', $cleaned);
        return @json_decode($cleaned, true);
    }
    return @json_decode($raw, true);
}

$action = isset($_GET['action']) ? $_GET['action'] : 'status';

if ($action === 'admin_bundle') {
    if (!isAuthenticated()) {
        http_response_code(401);
        header('Content-Type: application/javascript; charset=utf-8');
        echo "/* 401 Unauthorized: CMS bundle requires login at /admin.html */\n";
        exit;
    }
    header('Content-Type: application/javascript; charset=utf-8');
    $adminJsPath = $baseDir . '/js/admin.js';
    if (file_exists($adminJsPath)) {
        readfile($adminJsPath);
    }
    exit;
}

if ($action === 'admin_css') {
    if (!isAuthenticated()) {
        http_response_code(401);
        header('Content-Type: text/css; charset=utf-8');
        echo "/* 401 Unauthorized */\n";
        exit;
    }
    header('Content-Type: text/css; charset=utf-8');
    $adminCssPath = $baseDir . '/css/admin.css';
    if (file_exists($adminCssPath)) {
        readfile($adminCssPath);
    }
    exit;
}

if ($action === 'status') {
    $authed = isAuthenticated();
    $hasDraft = false;
    $draftData = null;
    if ($authed && file_exists($draftJsonFile)) {
        $parsedDraft = @json_decode(@file_get_contents($draftJsonFile), true);
        if (is_array($parsedDraft)) {
            $hasDraft = true;
            $draftData = $parsedDraft;
        }
    }
    $media = $authed ? listMediaAndFolders($uploadsDir, $uschovnaDir) : ['files' => [], 'folders' => []];
    $backups = $authed ? loadBackupsIndex($backupsDir, $backupsIndexFile) : [];
    echo json_encode([
        'ok' => true,
        'authenticated' => $authed,
        'csrfToken' => $authed ? getCsrfToken() : null,
        'hasDraft' => $hasDraft,
        'draftData' => $draftData,
        'files' => $media['files'],
        'folders' => $media['folders'],
        'backups' => $backups,
        'lastSavedAt' => isset($backups[0]['createdAt']) ? $backups[0]['createdAt'] : null
    ]);
    exit;
}

if ($action === 'login' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $attemptsData = checkRateLimit($attemptsFile);
    $body = json_decode(file_get_contents('php://input'), true);
    $password = isset($body['password']) ? (string)$body['password'] : '';
    $cfg = getAdminConfig($configFile, $defaultPasswordHash);

    if (hash_equals($cfg['passwordHash'], hash('sha256', $password))) {
        session_regenerate_id(true);
        $_SESSION['pokorny_cms_auth'] = true;
        clearFailedLogin($attemptsFile, $attemptsData);
        $hasDraft = false;
        $draftData = null;
        if (file_exists($draftJsonFile)) {
            $parsedDraft = @json_decode(@file_get_contents($draftJsonFile), true);
            if (is_array($parsedDraft)) {
                $hasDraft = true;
                $draftData = $parsedDraft;
            }
        }
        $media = listMediaAndFolders($uploadsDir, $uschovnaDir);
        $backups = loadBackupsIndex($backupsDir, $backupsIndexFile);
        echo json_encode([
            'ok' => true,
            'authenticated' => true,
            'csrfToken' => getCsrfToken(),
            'hasDraft' => $hasDraft,
            'draftData' => $draftData,
            'files' => $media['files'],
            'folders' => $media['folders'],
            'backups' => $backups,
            'lastSavedAt' => isset($backups[0]['createdAt']) ? $backups[0]['createdAt'] : null
        ]);
    } else {
        recordFailedLogin($attemptsFile, $attemptsData);
        http_response_code(403);
        echo json_encode(['ok' => false, 'error' => 'Nesprávné heslo.']);
    }
    exit;
}

if ($action === 'logout') {
    $_SESSION = [];
    session_destroy();
    echo json_encode(['ok' => true, 'authenticated' => false]);
    exit;
}

if ($action === 'save_draft' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireAuthAndCsrf();
    $payload = json_decode(file_get_contents('php://input'), true);
    if (!is_array($payload) || !isset($payload['siteData']) || !is_array($payload['siteData'])) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Neplatný formát dat konceptu.']);
        exit;
    }

    $prettyJson = json_encode($payload['siteData'], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $okDraft = @file_put_contents($draftJsonFile, $prettyJson, LOCK_EX);
    if ($okDraft === false) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'Nepodařilo se uložit koncept do data/draft-data.json.']);
        exit;
    }

    $saveName = isset($payload['saveName']) ? $payload['saveName'] : '';
    $snap = createBackupSnapshot($backupsDir, $backupsIndexFile, $payload['siteData'], $saveName, 'draft');

    echo json_encode([
        'ok' => true,
        'savedDraftAt' => $snap['entry']['createdAt'],
        'backupEntry' => $snap['entry'],
        'backups' => $snap['backups']
    ]);
    exit;
}

if ($action === 'save' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireAuthAndCsrf();
    $payload = json_decode(file_get_contents('php://input'), true);
    if (!is_array($payload) || !isset($payload['siteData']) || !is_array($payload['siteData'])) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Neplatný formát dat.']);
        exit;
    }

    $siteData = $payload['siteData'];
    $prettyJson = json_encode($siteData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $jsOutput = "const SITE_DATA = " . $prettyJson . ";\n";

    $okJs = @file_put_contents($contentJsFile, $jsOutput, LOCK_EX);
    @file_put_contents($siteJsonFile, $prettyJson, LOCK_EX);

    if ($okJs === false) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'Nepodařilo se zapsat do data/content.js.']);
        exit;
    }

    if (file_exists($draftJsonFile)) {
        @unlink($draftJsonFile);
    }

    $saveName = isset($payload['saveName']) ? $payload['saveName'] : '';
    $snap = createBackupSnapshot($backupsDir, $backupsIndexFile, $siteData, $saveName, 'published');

    echo json_encode([
        'ok' => true,
        'savedAt' => $snap['entry']['createdAt'],
        'backupEntry' => $snap['entry'],
        'backups' => $snap['backups']
    ]);
    exit;
}

if ($action === 'list_backups') {
    requireAuthAndCsrf();
    echo json_encode([
        'ok' => true,
        'backups' => loadBackupsIndex($backupsDir, $backupsIndexFile)
    ]);
    exit;
}

if ($action === 'rename_backup' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireAuthAndCsrf();
    $body = json_decode(file_get_contents('php://input'), true);
    $id = isset($body['id']) ? (string)$body['id'] : '';
    $newName = isset($body['name']) ? trim((string)$body['name']) : '';
    $list = loadBackupsIndex($backupsDir, $backupsIndexFile);
    $found = false;
    foreach ($list as &$b) {
        if ($b['id'] === $id) {
            if ($newName !== '') $b['name'] = $newName;
            $found = true;
            break;
        }
    }
    if (!$found) {
        http_response_code(404);
        echo json_encode(['ok' => false, 'error' => 'Záloha nebyla nalezena.']);
        exit;
    }
    saveBackupsIndex($backupsIndexFile, $list);
    echo json_encode(['ok' => true, 'backups' => $list]);
    exit;
}

if ($action === 'restore_backup' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireAuthAndCsrf();
    $body = json_decode(file_get_contents('php://input'), true);
    $id = isset($body['id']) ? (string)$body['id'] : '';
    $list = loadBackupsIndex($backupsDir, $backupsIndexFile);
    $target = null;
    foreach ($list as $b) {
        if ($b['id'] === $id) { $target = $b; break; }
    }
    if (!$target) {
        http_response_code(404);
        echo json_encode(['ok' => false, 'error' => 'Záloha nebyla nalezena.']);
        exit;
    }
    $siteData = readBackupSnapshotData($backupsDir, $target);
    if (!is_array($siteData)) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'Nelze načíst data ze souboru zálohy.']);
        exit;
    }
    @file_put_contents($draftJsonFile, json_encode($siteData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX);
    echo json_encode(['ok' => true, 'siteData' => $siteData, 'restoredFrom' => $target]);
    exit;
}

if ($action === 'delete_backup' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireAuthAndCsrf();
    $body = json_decode(file_get_contents('php://input'), true);
    $id = isset($body['id']) ? (string)$body['id'] : '';
    $list = loadBackupsIndex($backupsDir, $backupsIndexFile);
    $newList = [];
    foreach ($list as $b) {
        if ($b['id'] === $id) {
            if (isset($b['filename'])) @unlink($backupsDir . '/' . $b['filename']);
        } else {
            $newList[] = $b;
        }
    }
    saveBackupsIndex($backupsIndexFile, $newList);
    echo json_encode(['ok' => true, 'backups' => $newList]);
    exit;
}

if ($action === 'create_folder' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireAuthAndCsrf();
    $body = json_decode(file_get_contents('php://input'), true);
    $parentRel = normalizeUploadFolder(isset($body['parentFolder']) ? $body['parentFolder'] : 'uploads');
    $cleanName = sanitizeSegment(isset($body['folderName']) ? $body['folderName'] : '');
    if ($cleanName === '') {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Zadejte platný název složky.']);
        exit;
    }
    $newFolderRel = $parentRel . '/' . $cleanName;
    $fullDir = $baseDir . '/' . $newFolderRel;
    if (!is_dir($fullDir)) {
        @mkdir($fullDir, 0755, true);
    }
    $media = listMediaAndFolders($uploadsDir, $uschovnaDir);
    echo json_encode([
        'ok' => true,
        'createdFolder' => $newFolderRel,
        'files' => $media['files'],
        'folders' => $media['folders']
    ]);
    exit;
}

if ($action === 'delete_folder' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireAuthAndCsrf();
    $body = json_decode(file_get_contents('php://input'), true);
    $folderRel = normalizeUploadFolder(isset($body['folderPath']) ? $body['folderPath'] : '');
    if ($folderRel === 'uploads') {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Kořenovou složku uploads nelze smazat.']);
        exit;
    }
    $fullDir = $baseDir . '/' . $folderRel;
    if (is_dir($fullDir)) {
        $items = array_diff(scandir($fullDir), ['.', '..']);
        if (count($items) > 0) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Složka není prázdná. Nejprve přesuňte nebo smažte soubory uvnitř.']);
            exit;
        }
        @rmdir($fullDir);
    }
    $media = listMediaAndFolders($uploadsDir, $uschovnaDir);
    echo json_encode(['ok' => true, 'files' => $media['files'], 'folders' => $media['folders']]);
    exit;
}

if ($action === 'move_file' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireAuthAndCsrf();
    $body = json_decode(file_get_contents('php://input'), true);
    $fromRel = isset($body['fromPath']) ? str_replace('\\', '/', (string)$body['fromPath']) : '';
    $targetFolderRel = normalizeUploadFolder(isset($body['targetFolder']) ? $body['targetFolder'] : 'uploads');
    if (strpos($fromRel, 'uploads/') !== 0 || strpos($fromRel, '..') !== false) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Přesouvat lze pouze soubory ve složce uploads/.']);
        exit;
    }
    $srcFull = $baseDir . '/' . $fromRel;
    if (!is_file($srcFull)) {
        http_response_code(404);
        echo json_encode(['ok' => false, 'error' => 'Zdrojový soubor neexistuje.']);
        exit;
    }
    $destDirFull = $baseDir . '/' . $targetFolderRel;
    if (!is_dir($destDirFull)) @mkdir($destDirFull, 0755, true);
    $fileName = basename($srcFull);
    $destFull = $destDirFull . '/' . $fileName;
    if ($srcFull !== $destFull) {
        @rename($srcFull, $destFull);
    }
    $media = listMediaAndFolders($uploadsDir, $uschovnaDir);
    echo json_encode([
        'ok' => true,
        'newPath' => $targetFolderRel . '/' . $fileName,
        'files' => $media['files'],
        'folders' => $media['folders']
    ]);
    exit;
}

if ($action === 'upload' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireAuthAndCsrf();
    if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Soubor se nepodařilo nahrát.']);
        exit;
    }

    $reqFolder = isset($_POST['folder']) ? $_POST['folder'] : (isset($_GET['folder']) ? $_GET['folder'] : 'uploads');
    $folderRel = normalizeUploadFolder($reqFolder);
    $targetDirFull = $baseDir . '/' . $folderRel;
    if (!is_dir($targetDirFull)) @mkdir($targetDirFull, 0755, true);

    $origName = $_FILES['file']['name'];
    $tmpPath = $_FILES['file']['tmp_name'];
    $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
    $allowedExts = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'pdf', 'mp3', 'wav', 'ogg', 'm4a', 'wma', 'flac'];
    if (!in_array($ext, $allowedExts, true)) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Nepovolený typ souboru (.' . $ext . ').']);
        exit;
    }

    $safeBase = sanitizeSegment(pathinfo($origName, PATHINFO_FILENAME));
    if ($safeBase === '') $safeBase = 'soubor';

    $finalName = $safeBase . '.' . $ext;
    $targetPath = $targetDirFull . '/' . $finalName;
    $counter = 1;
    while (file_exists($targetPath)) {
        $finalName = $safeBase . '-' . $counter . '.' . $ext;
        $targetPath = $targetDirFull . '/' . $finalName;
        $counter++;
    }

    if (!move_uploaded_file($tmpPath, $targetPath)) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'Nelze uložit nahraný soubor do složky ' . $folderRel . '.']);
        exit;
    }

    $media = listMediaAndFolders($uploadsDir, $uschovnaDir);
    echo json_encode([
        'ok' => true,
        'path' => $folderRel . '/' . $finalName,
        'folder' => $folderRel,
        'name' => $finalName,
        'files' => $media['files'],
        'folders' => $media['folders']
    ]);
    exit;
}

if ($action === 'delete_file' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireAuthAndCsrf();
    $body = json_decode(file_get_contents('php://input'), true);
    $relPath = isset($body['path']) ? str_replace('\\', '/', (string)$body['path']) : '';

    if (strpos($relPath, 'uploads/') !== 0 || strpos($relPath, '..') !== false) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Mazat lze pouze soubory ve složce uploads/.']);
        exit;
    }

    $fullPath = $baseDir . '/' . $relPath;
    if (is_file($fullPath)) {
        @unlink($fullPath);
    }

    $media = listMediaAndFolders($uploadsDir, $uschovnaDir);
    echo json_encode([
        'ok' => true,
        'files' => $media['files'],
        'folders' => $media['folders']
    ]);
    exit;
}

if ($action === 'change_password' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireAuthAndCsrf();
    $body = json_decode(file_get_contents('php://input'), true);
    $newPassword = isset($body['newPassword']) ? trim((string)$body['newPassword']) : '';

    if (strlen($newPassword) < 6) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Nové heslo musí mít alespoň 6 znaků.']);
        exit;
    }

    file_put_contents($configFile, json_encode([
        'passwordHash' => hash('sha256', $newPassword),
        'updatedAt' => date('c')
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);

    echo json_encode(['ok' => true]);
    exit;
}

http_response_code(400);
echo json_encode(['ok' => false, 'error' => 'Neznámá akce API.']);
