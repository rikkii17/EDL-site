<?php
declare(strict_types=1);
require dirname(__DIR__) . "/private/bootstrap.php";
if (PHP_SAPI !== "cli") {
    response(["error" => "Forbidden"], 403);
}
locked(function (): void {
    $now = time();
    $settings = read_json(data_dir() . "/settings.json", [
        "interval_minutes" => 30,
    ]);
    $state = read_json(data_dir() . "/aggregate.json");
    // 保存間隔の変更は進行中の集計を閉じた後、次の集計から適用する。
    $minutes = $state["interval_minutes"] ?? $settings["interval_minutes"];
    $scanned = 0;
    foreach (
        new FilesystemIterator(
            data_dir() . "/sessions",
            FilesystemIterator::SKIP_DOTS,
        )
        as $file
    ) {
        if (++$scanned > 10000) {
            break;
        }
        if (
            $file->isFile() &&
            str_starts_with($file->getFilename(), "sess_") &&
            $file->getMTime() < $now - 3600
        ) {
            unlink($file->getPathname());
        }
    }
    if (!$state || $now - $state["started_at"] < $minutes * 60) {
        return;
    }
    $id = (string) $state["started_at"];
    $record = [
        "window_id" => $id,
        "started_at" => gmdate("c", $state["started_at"]),
        "ended_at" => gmdate("c", $now),
        "interval_minutes" => $minutes,
        "samples" => $state["samples"],
        "metrics" => [],
    ];
    foreach (
        ["temperature_c", "humidity_pct", "eco2_ppm", "noise_db"]
        as $field
    ) {
        $metric = $state["metrics"][$field] ?? null;
        $record["metrics"][$field] = $metric
            ? [
                "mean" => $metric["sum"] / $metric["count"],
                "min" => $metric["min"],
                "max" => $metric["max"],
                "count" => $metric["count"],
            ]
            : ["mean" => null, "min" => null, "max" => null, "count" => 0];
    }
    $day = new DateTimeImmutable("@" . $now)
        ->setTimezone(new DateTimeZone("Asia/Tokyo"))
        ->format("Y-m-d");
    $path = data_dir() . "/history/" . $day . ".jsonl";
    // 履歴追記後・集計状態リセット前に停止した場合、直前の記録を再利用する。
    // 重複候補は最後の記録だけなので、読み取り範囲はファイル末尾に限定する。
    $tail = "";
    if (is_file($path)) {
        $file = fopen($path, "rb");
        fseek($file, max(0, filesize($path) - 4096));
        $tail = stream_get_contents($file);
        fclose($file);
    }
    $lines = array_values(array_filter(explode("\n", $tail)));
    $last = $lines ? json_decode($lines[count($lines) - 1], true) : null;
    if (($last["window_id"] ?? null) === $id) {
        $record = $last;
    } else {
        $line = json_encode($record, JSON_THROW_ON_ERROR) . "\n";
        if (
            file_put_contents($path, $line, FILE_APPEND | LOCK_EX) !==
            strlen($line)
        ) {
            throw new RuntimeException("History unavailable");
        }
    }
    $cache = read_json(data_dir() . "/history-cache.json", ["records" => []]);
    if (
        !array_filter(
            $cache["records"],
            fn(array $row): bool => ($row["window_id"] ?? null) === $id,
        )
    ) {
        $cache["records"][] = $record;
    }
    $cache["records"] = array_slice(
        array_values(
            array_filter(
                $cache["records"],
                fn(array $row): bool => strtotime($row["ended_at"]) >=
                    $now - 7 * 86400,
            ),
        ),
        -10080,
    );
    atomic_json(data_dir() . "/history-cache.json", $cache);
    atomic_json(data_dir() . "/aggregate.json", [
        "started_at" => $now,
        "interval_minutes" => $settings["interval_minutes"],
        "metrics" => [],
        "samples" => 0,
    ]);
    // 1年以上経過した日別ファイルは専用履歴ディレクトリ内だけで削除する。
    foreach (glob(data_dir() . "/history/*.jsonl") ?: [] as $file) {
        if (filemtime($file) < $now - 366 * 86400) {
            unlink($file);
        }
    }
});
