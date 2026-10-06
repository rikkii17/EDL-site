<?php
// CLI-only initialization: never place this script or its output in public/.
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
$directory = $argv[1] ?? '/var/lib/edl';
if (!is_dir($directory)) mkdir($directory,0700,true);
if (is_file($directory.'/pass') || is_file($directory.'/config.json')) { fwrite(STDERR,"Already configured; refusing overwrite.\n"); exit(1); }
fwrite(STDOUT,"Admin password (input is visible; use a private terminal): ");
$password = trim(fgets(STDIN));
if (strlen($password)<8) { fwrite(STDERR,"At least 8 characters required.\n");exit(1); }
$key = bin2hex(random_bytes(32));
file_put_contents($directory.'/pass',password_hash($password,PASSWORD_DEFAULT));
file_put_contents($directory.'/config.json',json_encode(['device_key'=>$key],JSON_PRETTY_PRINT));
chmod($directory.'/pass',0600);chmod($directory.'/config.json',0600);
fwrite(STDOUT,"Device key (copy to Arduino's private config): ".$key."\n");
