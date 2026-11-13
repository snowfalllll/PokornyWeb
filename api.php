<?php
/**
 * Pokorní z Příbora — CMS Backend API (pro standardní český PHP webhosting: Wedos, Forpsi, Active24, Webglobe atd.)
 * Zajišťuje:
 * - Přihlášení heslem (SHA-256 hash v data/admin-config.json) + ochrana proti hádání hesel (Brute-Force Rate Limit)
 * - CSRF ochrana pro všechny změnové požadavky (X-CSRF-Token)
 * - Ukládání obsahu webu do data/content.js a data/site-data.json + automatické zálohy v data/backups/
 * - Bezpečné nahrávání a mazání souborů (kontrola přípony i skutečného MIME typu přes finfo) ve složce uploads/
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

// Výchozí heslo: "pribor1756"
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
    $windowSeconds = 15 * 60; // 15 minut
    $maxAttempts = 5;

    $data = [];
    if (file_exists($attemptsFile)) {
        $parsed = @json_decode(@file_get_contents($attemptsFile), true);
        if (is_array($parsed)) $data = $parsed;
    }

    // Vyčistit staré záznamy
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

function listMediaFiles($uploadsDir, $uschovnaDir) {
    $files = [];
    $scanFolder = function($dirPath, $urlPrefix) use (&$files) {
        if (!is_dir($dirPath)) return;
        foreach (scandir($dirPath) as $entry) {
            if ($entry === '.' || $entry === '..' || $entry[0] === '.') continue;
            $full = $dirPath . '/' . $entry;
            if (is_file($full)) {
                $ext = strtolower(pathinfo($entry, PATHINFO_EXTENSION));
                $type = 'other';
                if (in_array($ext, ['jpg', 'jpeg', 'png', 'webp', 'gif'])) $type = 'image';
                elseif ($ext === 'pdf') $type = 'pdf';
                elseif (in_array($ext, ['mp3', 'wav', 'ogg', 'm4a', 'wma', 'flac'])) $type = 'audio';

                $files[] = [
                    'name' => $entry,
                    'path' => $urlPrefix . '/' . $entry,
                    'folder' => $urlPrefix,
                    'type' => $type,
                    'size' => filesize($full),
                    'mtime' => filemtime($full)
                ];
            }
        }
    };
    $scanFolder($uploadsDir, 'uploads');
    $scanFolder($uschovnaDir, 'uschovna');
    usort($files, function($a, $b) { return $b['mtime'] - $a['mtime']; });
    return $files;
}

$action = isset($_GET['action']) ? $_GET['action'] : 'status';

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
    echo json_encode([
        'ok' => true,
        'authenticated' => $authed,
        'csrfToken' => $authed ? getCsrfToken() : null,
        'hasDraft' => $hasDraft,
        'draftData' => $draftData,
        'files' => $authed ? listMediaFiles($uploadsDir, $uschovnaDir) : []
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
        echo json_encode([
            'ok' => true,
            'authenticated' => true,
            'csrfToken' => getCsrfToken(),
            'hasDraft' => $hasDraft,
            'draftData' => $draftData,
            'files' => listMediaFiles($uploadsDir, $uschovnaDir)
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
    $rawBody = file_get_contents('php://input');
    $payload = json_decode($rawBody, true);

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

    echo json_encode([
        'ok' => true,
        'savedDraftAt' => date('c')
    ]);
    exit;
}

if ($action === 'save' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireAuthAndCsrf();
    $rawBody = file_get_contents('php://input');
    $payload = json_decode($rawBody, true);

    if (!is_array($payload) || !isset($payload['siteData']) || !is_array($payload['siteData'])) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Neplatný formát dat.']);
        exit;
    }

    $siteData = $payload['siteData'];

    // Vytvořit automatickou zálohu před přepsáním
    if (file_exists($contentJsFile)) {
        $backupName = 'content-backup-' . date('Y-m-d_H-i-s') . '.js';
        @copy($contentJsFile, $backupsDir . '/' . $backupName);

        // Ponechat posledních 15 záloh
        $existingBackups = glob($backupsDir . '/content-backup-*.js');
        if (is_array($existingBackups) && count($existingBackups) > 15) {
            sort($existingBackups);
            $toDelete = array_slice($existingBackups, 0, count($existingBackups) - 15);
            foreach ($toDelete as $oldFile) {
                @unlink($oldFile);
            }
        }
    }

    $prettyJson = json_encode($siteData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $jsOutput = "const SITE_DATA = " . $prettyJson . ";\n";

    $okJs = @file_put_contents($contentJsFile, $jsOutput, LOCK_EX);
    $okJson = @file_put_contents($siteJsonFile, $prettyJson, LOCK_EX);

    if ($okJs === false) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'Nepodařilo se zapsat do data/content.js. Zkontrolujte oprávnění složky data/.']);
        exit;
    }

    // Po úspěšném publikování smazat rozpracovaný koncept (nyní je již publikován naživo)
    if (file_exists($draftJsonFile)) {
        @unlink($draftJsonFile);
    }

    echo json_encode([
        'ok' => true,
        'savedAt' => date('c')
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

    $origName = $_FILES['file']['name'];
    $tmpPath = $_FILES['file']['tmp_name'];
    $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
    $allowedExts = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf', 'mp3', 'wav', 'ogg', 'm4a', 'wma', 'flac'];
    if (!in_array($ext, $allowedExts, true)) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Nepovolený typ souboru (.' . $ext . ').']);
        exit;
    }

    // Ověření skutečného MIME typu souboru
    if (function_exists('finfo_open')) {
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $realMime = finfo_file($finfo, $tmpPath);
        finfo_close($finfo);
        $allowedMimePrefixes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'audio/', 'video/x-ms-asf', 'application/octet-stream'];
        $mimeValid = false;
        foreach ($allowedMimePrefixes as $prefix) {
            if (strpos($realMime, $prefix) === 0) {
                $mimeValid = true;
                break;
            }
        }
        if (!$mimeValid) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Soubor nemá platný multimediální obsah (' . $realMime . ').']);
            exit;
        }
    }

    $baseName = pathinfo($origName, PATHINFO_FILENAME);
    $safeBase = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $baseName);
    if (!$safeBase) $safeBase = $baseName;
    $safeBase = preg_replace('/[^a-zA-Z0-9_-]+/', '-', $safeBase);
    $safeBase = trim($safeBase, '-');
    if ($safeBase === '') $safeBase = 'soubor';

    $finalName = $safeBase . '.' . $ext;
    $targetPath = $uploadsDir . '/' . $finalName;
    $counter = 1;
    while (file_exists($targetPath)) {
        $finalName = $safeBase . '-' . $counter . '.' . $ext;
        $targetPath = $uploadsDir . '/' . $finalName;
        $counter++;
    }

    if (!move_uploaded_file($tmpPath, $targetPath)) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'Nelze uložit nahraný soubor do složky uploads/.']);
        exit;
    }

    echo json_encode([
        'ok' => true,
        'path' => 'uploads/' . $finalName,
        'name' => $finalName,
        'files' => listMediaFiles($uploadsDir, $uschovnaDir)
    ]);
    exit;
}

if ($action === 'delete_file' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireAuthAndCsrf();
    $body = json_decode(file_get_contents('php://input'), true);
    $relPath = isset($body['path']) ? (string)$body['path'] : '';

    if (strpos($relPath, 'uploads/') !== 0 || strpos($relPath, '..') !== false) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Mazat lze pouze soubory ve složce uploads/.']);
        exit;
    }

    $fullPath = $baseDir . '/' . $relPath;
    if (is_file($fullPath)) {
        @unlink($fullPath);
    }

    echo json_encode([
        'ok' => true,
        'files' => listMediaFiles($uploadsDir, $uschovnaDir)
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
