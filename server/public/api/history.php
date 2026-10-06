<?php
declare(strict_types=1);
require dirname(__DIR__, 2) . '/private/bootstrap.php';
require_method('GET'); rate_limit('history', 20, 60);
$days = filter_var($_GET['days'] ?? '1', FILTER_VALIDATE_INT);
if ($days === false || $days < 1 || $days > 7) response(['error'=>'days must be 1..7'], 400);
// Read cached snapshots, never rescan or aggregate all historical files per request.
$records = read_json(data_dir() . '/history-cache.json')['records'] ?? [];
$cutoff = time() - $days * 86400;
response(['records'=>array_values(array_filter($records, fn(array $row): bool => strtotime($row['ended_at']) >= $cutoff))]);
