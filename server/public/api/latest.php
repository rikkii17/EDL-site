<?php
declare(strict_types=1);
require dirname(__DIR__, 2) . "/private/bootstrap.php";
require_method("GET");
rate_limit("read", 90, 60);
response([
    "latest" => read_json(data_dir() . "/latest.json") ?: null,
    "settings" => read_json(data_dir() . "/settings.json", [
        "interval_minutes" => 30,
    ]),
]);
