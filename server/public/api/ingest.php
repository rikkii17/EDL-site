<?php
declare(strict_types=1);
require dirname(__DIR__, 2) . "/private/bootstrap.php";
require_method("POST");
rate_limit("ingest", 20, 60);
$config = config();
// 閲覧用セッションとは別のArduino専用キーで送信元を確認する。
if (!hash_equals($config["device_key"], $_SERVER["HTTP_X_DEVICE_KEY"] ?? "")) {
    response(["error" => "Unauthorized"], 401);
}
$body = input();
if (!is_array($body["validity"] ?? null) || array_is_list($body["validity"])) {
    response(["error" => "Invalid validity"], 400);
}
if (($body["device_id"] ?? "") !== "edl-arduino") {
    response(["error" => "Unknown device"], 400);
}
if (
    !isset($body["uptime_ms"]) ||
    !is_int($body["uptime_ms"]) ||
    $body["uptime_ms"] < 0 ||
    $body["uptime_ms"] > 4294967295
) {
    response(["error" => "Invalid uptime"], 400);
}
$fields = [
    "temperature_c" => [-40, 125, "temperature"],
    "humidity_pct" => [0, 100, "humidity"],
    "eco2_ppm" => [0, 65000, "eco2"],
    "noise_db" => [0, 150, "noise"],
];
// Arduinoの起動時間は折り返し・再起動があるため、保存時刻はサーバー受信時刻を使う。
$record = [
    "device_id" => "edl-arduino",
    "uptime_ms" => $body["uptime_ms"],
    "received_at" => gmdate("c"),
    "validity" => [],
];
foreach ($fields as $field => $range) {
    // 測定失敗はnullかつvalidity=false。有効値は数値型と物理範囲を確認する。
    if (!array_key_exists($field, $body)) {
        response(["error" => "Missing measurement"], 400);
    }
    $value = $body[$field];
    $valid = $body["validity"][$range[2]] ?? null;
    if (
        !is_bool($valid) ||
        ($value === null && $valid) ||
        ($value !== null &&
            (!$valid ||
                (!is_int($value) && !is_float($value)) ||
                !is_finite((float) $value) ||
                $value < $range[0] ||
                $value > $range[1]))
    ) {
        response(["error" => "Invalid measurement"], 400);
    }
    $record[$field] = $value;
    $record["validity"][$range[2]] = $valid;
}
locked(function () use ($record, $fields): void {
    $now = time();
    $settings = read_json(data_dir() . "/settings.json", [
        "interval_minutes" => 30,
    ]);
    $state = read_json(data_dir() . "/aggregate.json", [
        "started_at" => $now,
        "interval_minutes" => $settings["interval_minutes"],
        "metrics" => [],
        "samples" => 0,
    ]);
    $state["samples"]++;
    foreach ($fields as $field => $_) {
        $value = $record[$field];
        // 欠測を0とみなさず、各項目の有効な測定だけを平均・最小・最大へ加える。
        if ($value === null) {
            continue;
        }
        $metric = $state["metrics"][$field] ?? [
            "sum" => 0,
            "count" => 0,
            "min" => $value,
            "max" => $value,
        ];
        $metric["sum"] += $value;
        $metric["count"]++;
        $metric["min"] = min($metric["min"], $value);
        $metric["max"] = max($metric["max"], $value);
        $state["metrics"][$field] = $metric;
    }
    atomic_json(data_dir() . "/aggregate.json", $state);
    atomic_json(data_dir() . "/latest.json", $record);
});
response(["ok" => true, "received_at" => $record["received_at"]]);
