<?php
declare(strict_types=1);
require dirname(__DIR__, 2) . '/private/bootstrap.php';
rate_limit('admin', 30, 60); rate_limit('admin-global', 120, 60, true); start_session();
if ($_SERVER['REQUEST_METHOD'] === 'GET') response(['authenticated'=>authorized(), 'csrf'=>$_SESSION['csrf'], 'interval_minutes'=>read_json(data_dir() . '/settings.json',['interval_minutes'=>30])['interval_minutes']]);
require_method('POST'); csrf(); $body = input();
switch ($body['action'] ?? '') {
    case 'login':
        rate_limit('login', 5, 300);
        if (!is_string($body['password'] ?? null) || strlen($body['password']) > 256 || !password_verify($body['password'], password_hash_value())) response(['error'=>'Password incorrect'], 401);
        session_regenerate_id(true); $_SESSION['authenticated'] = true; $_SESSION['expires'] = time()+3600; $_SESSION['csrf'] = bin2hex(random_bytes(32));
        response(['authenticated'=>true,'csrf'=>$_SESSION['csrf']]);
    case 'logout':
        $_SESSION = []; session_destroy(); response(['ok'=>true]);
    case 'settings':
        if (!authorized()) response(['error'=>'Unauthorized'], 401);
        $minutes = $body['interval_minutes'] ?? null;
        if (!is_int($minutes) || $minutes < 1 || $minutes > 60) response(['error'=>'Interval must be 1..60'], 400);
        locked(fn()=>atomic_json(data_dir() . '/settings.json',['interval_minutes'=>$minutes]));
        response(['interval_minutes'=>$minutes]);
    default: response(['error'=>'Unknown action'], 400);
}
