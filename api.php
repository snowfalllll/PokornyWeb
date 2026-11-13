<?php
/**
 * Pokorní z Příbora — CMS Backend API (pro standardní český PHP webhosting: Wedos, Forpsi, Active24, Webglobe atd.)
 * Zajišťuje:
 * - Přihlášení heslem (SHA-256 hash v data/admin-config.json)
 * - Ukládání obsahu webu do data/content.js a data/site-data.json + automatické zálohy v data/backups/
 * - Nahrávání a mazání souborů (obrázky, PDF, audio) ve složce uploads/
 */

session_start();
header('Content-Type: application/json; charset=utf-8');

$baseDir = __DIR__;
$dataDir = $baseDir . '/data';
$backupsDir = $dataDir . '/backups';
$uploadsDir = $baseDir . '/uploads';
$uschovnaDir = $baseDir . '/uschovna';
$configFile = $dataDir . '/admin-config.json';
$contentJsFile = $dataDir . '/content.js';
$siteJsonFile = $dataDir . '/site-data.json';

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

function isAuthenticated() {
    return !empty($_SESSION['pokorny_cms_auth']) && $_SESSION['pokorny_cms_auth'] === true;
}

function requireAuth() {
    if (!isAuthenticated()) {
        http_response_code(401);
        echo json_encode(['ok' => false, 'error' => 'Nejste přihlášeni. Prosím přihlaste se heslem.']);
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
                if (in_array($ext, ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'])) $type = 'image';
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
    echo json_encode([
        'ok' => true,
        'authenticated' => isAuthenticated(),
        'files' => isAuthenticated() ? listMediaFiles($uploadsDir, $uschovnaDir) : []
    ]);
    exit;
}

if ($action === 'login' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true);
    $password = isset($body['password']) ? (string)$body['password'] : '';
    $cfg = getAdminConfig($configFile, $defaultPasswordHash);

    if (hash_equals($cfg['passwordHash'], hash('sha256', $password))) {
        $_SESSION['pokorny_cms_auth'] = true;
        echo json_encode([
            'ok' => true,
            'authenticated' => true,
            'files' => listMediaFiles($uploadsDir, $uschovnaDir)
        ]);
    } else {
        http_response_code(403);
        echo json_encode(['ok' => false, 'error' => 'Nesprávné heslo.']);
    }
    exit;
}

if ($action === 'logout') {
    $_SESSION['pokorny_cms_auth'] = false;
    session_destroy();
    echo json_encode(['ok' => true, 'authenticated' => false]);
    exit;
}

if ($action === 'save' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireAuth();
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

    $okJs = @file_put_contents($contentJsFile, $jsOutput);
    $okJson = @file_put_contents($siteJsonFile, $prettyJson);

    if ($okJs === false) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'Nepodařilo se zapsat do data/content.js. Zkontrolujte oprávnění složky data/.']);
        exit;
    }

    echo json_encode([
        'ok' => true,
        'savedAt' => date('c')
    ]);
    exit;
}

if ($action === 'upload' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireAuth();
    if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Soubor se nepodařilo nahrát.']);
        exit;
    }

    $origName = $_FILES['file']['name'];
    $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
    $allowed = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'pdf', 'mp3', 'wav', 'ogg', 'm4a', 'wma', 'flac'];
    if (!in_array($ext, $allowed)) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Nepovolený typ souboru (.' . $ext . ').']);
        exit;
    }

    $baseName = pathinfo($origName, PATHINFO_FILENAME);
    $safeBase = preg_replace('/[^a-zA-Z0-9_-]+/', '-', iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $baseName));
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

    if (!move_uploaded_file($_FILES['file']['tmp_name'], $targetPath)) {
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
    requireAuth();
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
    requireAuth();
    $body = json_decode(file_get_contents('php://input'), true);
    $newPassword = isset($body['newPassword']) ? trim((string)$body['newPassword']) : '';

    if (strlen($newPassword) < 4) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Nové heslo musí mít alespoň 4 znaky.']);
        exit;
    }

    file_put_contents($configFile, json_encode([
        'passwordHash' => hash('sha256', $newPassword),
        'updatedAt' => date('c')
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

    echo json_encode(['ok' => true]);
    exit;
}

http_response_code(400);
echo json_encode(['ok' => false, 'error' => 'Neznámá akce API.']);
