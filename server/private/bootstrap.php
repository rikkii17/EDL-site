<?php
declare(strict_types=1);
// PHP warnings must stay in server logs, never disclose private paths to clients.
ini_set('display_errors', '0');
ini_set('log_errors', '1');

// Private configuration/data must live outside Apache's DocumentRoot.
function data_dir(): string { return getenv('EDL_DATA_DIR') ?: dirname(__DIR__, 2) . '/var'; }
function initialize(): void {
    foreach (['', '/rate', '/history', '/sessions'] as $part) {
        $path = data_dir() . $part;
        if (!is_dir($path) && !mkdir($path, 0700, true) && !is_dir($path)) throw new RuntimeException('Storage unavailable');
    }
    // Refuse accidental deployment of secrets below the public document root.
    $root = realpath($_SERVER['DOCUMENT_ROOT'] ?? '');
    $paths = [data_dir(), getenv('EDL_CONFIG_FILE') ?: data_dir() . '/config.json', getenv('EDL_PASSWORD_FILE') ?: data_dir() . '/pass'];
    if (PHP_SAPI !== 'cli' && $root) foreach ($paths as $path) {
        $resolved = realpath($path) ?: realpath(dirname($path));
        if ($resolved && ($resolved === $root || str_starts_with(str_replace('\\', '/', $resolved), rtrim(str_replace('\\', '/', $root), '/') . '/'))) throw new RuntimeException('Private storage must be outside DocumentRoot');
    }
    // Only an explicitly opted-in loopback development server may use HTTP.
    if (PHP_SAPI !== 'cli' && ($_SERVER['HTTPS'] ?? '') !== 'on' && !(getenv('EDL_ALLOW_HTTP') === '1' && in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true))) response(['error'=>'HTTPS required'], 403);
}
function config(): array {
    $path = getenv('EDL_CONFIG_FILE') ?: data_dir() . '/config.json';
    $value = is_file($path) ? json_decode((string)file_get_contents($path), true, 16, JSON_THROW_ON_ERROR) : [];
    if (!is_string($value['device_key'] ?? null) || strlen($value['device_key']) < 32) throw new RuntimeException('Configuration missing');
    return $value;
}
function password_hash_value(): string {
    $path = getenv('EDL_PASSWORD_FILE') ?: data_dir() . '/pass';
    $hash = is_file($path) ? trim((string)file_get_contents($path)) : '';
    if ($hash === '' || (password_get_info($hash)['algoName'] ?? 'unknown') === 'unknown') throw new RuntimeException('Password configuration missing');
    return $hash;
}
function read_json(string $path, array $default = []): array {
    return is_file($path) ? json_decode((string)file_get_contents($path), true, 32, JSON_THROW_ON_ERROR) : $default;
}
function atomic_json(string $path, array $value): void {
    $temp = tempnam(dirname($path), '.edl-');
    if ($temp === false) throw new RuntimeException('Storage unavailable');
    try {
        if (file_put_contents($temp, json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE)) === false || !rename($temp, $path)) throw new RuntimeException('Storage unavailable');
    } finally { if (is_file($temp)) unlink($temp); }
}
// A global lock keeps ingest and cron snapshots consistent, including settings changes.
function acquire_lock($file): void {
    // A stuck cron process must not hold every Apache worker indefinitely.
    $deadline = microtime(true) + 0.2;
    do {
        if (flock($file, LOCK_EX | LOCK_NB)) return;
        usleep(10000);
    } while (microtime(true) < $deadline);
    throw new RuntimeException('Storage busy');
}
function locked(callable $action): mixed {
    $file = fopen(data_dir() . '/state.lock', 'c');
    if (!$file) throw new RuntimeException('Storage unavailable');
    try { acquire_lock($file); } catch (Throwable $error) { fclose($file); throw $error; }
    try { return $action(); } finally { flock($file, LOCK_UN); fclose($file); }
}
function response(array $body, int $status = 200): never {
    // Release the session lock before sending an answer or allowing polling again.
    if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
    http_response_code($status); header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store'); header('X-Content-Type-Options: nosniff');
    echo json_encode($body, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE); exit;
}
function require_method(string $method): void { if ($_SERVER['REQUEST_METHOD'] !== $method) response(['error'=>'Method not allowed'], 405); }
function input(): array {
    if (strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0])) !== 'application/json') response(['error'=>'JSON required'], 415);
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 2048) response(['error'=>'Request too large'], 413);
    $raw = file_get_contents('php://input', false, null, 0, 2049);
    if ($raw === false || strlen($raw) > 2048) response(['error'=>'Request too large'], 413);
    try { $body = json_decode($raw, true, 8, JSON_THROW_ON_ERROR); } catch (JsonException) { response(['error'=>'Invalid JSON'], 400); }
    if (!is_array($body) || array_is_list($body)) response(['error'=>'Object required'], 400);
    return $body;
}
// Fixed buckets bound memory/disk usage even when source IPs are spoofed/varied.
function rate_limit(string $kind, int $limit, int $seconds, bool $global = false): void {
    $address = $global ? 'global' : ($_SERVER['REMOTE_ADDR'] ?? 'cli'); // Never trust forwarded headers.
    $slot = hexdec(substr(hash('sha256', $address), 0, 4)) % 256;
    $path = data_dir() . '/rate/' . $kind . '-' . $slot . '.json';
    $file = fopen($path, 'c+');
    if (!$file) throw new RuntimeException('Storage unavailable');
    try { acquire_lock($file); } catch (Throwable $error) { fclose($file); throw $error; }
    try {
        $state = json_decode(stream_get_contents($file) ?: '{}', true) ?: [];
        $now = time();
        if (($state['reset'] ?? 0) <= $now) $state = ['reset'=>$now+$seconds, 'count'=>0];
        $state['count']++;
        rewind($file); ftruncate($file, 0); fwrite($file, json_encode($state));
        $blocked = $state['count'] > $limit;
    } finally { flock($file, LOCK_UN); fclose($file); }
    if ($blocked) { header('Retry-After: ' . max(1, $state['reset'] - time())); response(['error'=>'Too many requests'], 429); }
}
function start_session(): void {
    $https = ($_SERVER['HTTPS'] ?? '') === 'on';
    if (!$https && !(getenv('EDL_ALLOW_HTTP') === '1' && in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true))) response(['error'=>'HTTPS required'], 403);
    ini_set('session.use_strict_mode', '1'); ini_set('session.use_only_cookies', '1');
    ini_set('session.gc_maxlifetime', '3600');
    session_save_path(data_dir() . '/sessions'); session_name('edl_session');
    session_set_cookie_params(['lifetime'=>0,'path'=>'/api/','secure'=>$https,'httponly'=>true,'samesite'=>'Strict']);
    session_start();
    if (isset($_SESSION['expires']) && $_SESSION['expires'] <= time()) $_SESSION = [];
    $_SESSION['csrf'] ??= bin2hex(random_bytes(32));
}
function authorized(): bool { return ($_SESSION['authenticated'] ?? false) === true && ($_SESSION['expires'] ?? 0) > time(); }
function csrf(): void {
    if (!hash_equals($_SESSION['csrf'], $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '')) response(['error'=>'Invalid CSRF token'], 403);
}
set_exception_handler(function (Throwable $error): void {
    error_log($error->getMessage());
    if (PHP_SAPI === 'cli') { fwrite(STDERR,"EDL operation failed\n"); exit(1); }
    response(['error'=>'Service unavailable'], 503);
});
initialize();
