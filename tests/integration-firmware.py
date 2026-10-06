"""実際のC++ JSON生成処理をPHPの受信API・履歴保存処理へ接続する結合検証。

隣接するArduinoリポジトリ、ネイティブC++コンパイラ、PHP、Pythonが必要。
サーバー、認証情報、実行ファイルはすべてローカルの一時領域だけで使用する。
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--firmware", type=Path,
                        default=ROOT.parent / "engineering_design_laboratory")
    parser.add_argument("--compiler", default=shutil.which("clang++") or shutil.which("g++"))
    parser.add_argument("--php", default=shutil.which("php"))
    args = parser.parse_args()
    if not args.compiler or not args.php:
        parser.error("Provide --compiler and --php when they are not on PATH")

    # セキュリティ検証と同じ一時サーバーを使い、配置構成の食い違いを防ぐ。
    spec = importlib.util.spec_from_file_location("security_harness", ROOT / "tests/security-integration.py")
    harness = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(harness)
    harness.PHP = args.php
    edl = args.firmware.resolve() / "EDL"
    with tempfile.TemporaryDirectory(prefix="edl-contract-") as temporary:
        binary = Path(temporary) / ("contract.exe" if os.name == "nt" else "contract")
        subprocess.run([
            args.compiler, "-std=c++17", "-Wall", "-Wextra", "-Werror",
            "-I", str(edl / "test/contract/mocks"),
            "-I", str(edl / "lib/telemetry/include"),
            "-I", str(edl / "lib/helper/include"),
            "-I", str(edl / "lib/hardware/include"),
            "-I", str(edl / "lib/config"),
            str(edl / "test/contract/contract_test.cpp"),
            str(edl / "lib/telemetry/src/measurement_json.cpp"),
            str(edl / "lib/helper/src/conversion_data.cpp"), "-o", str(binary),
            str(edl / "test/contract/sensor_test.cpp"),
            str(edl / "lib/hardware/src/ens160sensor.cpp"),
        ], check=True)
        output = subprocess.check_output([str(binary)], text=True)
        measurements = [json.loads(line) for line in output.splitlines() if line.startswith("{")]
        assert len(measurements) >= 2, "Contract executable must emit valid and missing samples"

        server = harness.Server()
        try:
            for sample in measurements:
                status, _, answer = server.request("/api/ingest.php", body=sample,
                                                   headers={"X-Device-Key": harness.KEY})
                assert status == 200 and answer["ok"], (status, answer)

            status, _, latest = server.request("/api/latest.php")
            assert status == 200
            for field in ("temperature_c", "humidity_pct", "eco2_ppm", "noise_db", "validity", "uptime_ms"):
                assert latest["latest"][field] == measurements[-1][field], field

            # 管理画面は送信キーと別の認証セッションを使用する。
            # 保存間隔を変更しても、進行中の集計期間は元の設定を維持する。
            client = server.client()
            status, _, admin = server.request("/api/admin.php", client=client)
            assert status == 200 and not admin["authenticated"]
            status, _, login = server.request("/api/admin.php", client=client,
                body={"action": "login", "password": harness.PASSWORD},
                headers={"X-CSRF-Token": admin["csrf"]})
            assert status == 200 and login["authenticated"]
            status, _, settings = server.request("/api/admin.php", client=client,
                body={"action": "settings", "interval_minutes": 1},
                headers={"X-CSRF-Token": login["csrf"]})
            assert status == 200 and settings["interval_minutes"] == 1

            # 30分待機せず検証するため、一時データの集計開始時刻だけを遡らせる。
            # 本番の時刻設定やデータは変更しない。
            state_file = server.data / "aggregate.json"
            state = json.loads(state_file.read_text())
            assert state["interval_minutes"] == 30, "New settings must not mutate the active window"
            state["started_at"] = int(time.time()) - 3601
            state_file.write_text(json.dumps(state))
            subprocess.run([args.php, str(ROOT / "server/bin/aggregate.php")],
                           env=server.env, check=True)
            status, _, history = server.request("/api/history.php?days=1")
            assert status == 200 and len(history["records"]) == 1, history
            record = history["records"][0]
            assert record["samples"] == len(measurements)
            assert record["interval_minutes"] == 30
            assert json.loads(state_file.read_text())["interval_minutes"] == 1
            for field in ("temperature_c", "humidity_pct", "eco2_ppm", "noise_db"):
                values = [sample[field] for sample in measurements if sample[field] is not None]
                metric = record["metrics"][field]
                assert metric["count"] == len(values), field
                assert metric["min"] == min(values) and metric["max"] == max(values), field
                assert abs(metric["mean"] - sum(values) / len(values)) < 0.0001, field
            daily_files = list((server.data / "history").glob("*.jsonl"))
            assert len(daily_files) == 1
            assert json.loads(daily_files[0].read_text().strip()) == record

            # cronを再実行しても、保存済みの集計期間を重複保存しないことを確認。
            subprocess.run([args.php, str(ROOT / "server/bin/aggregate.php")],
                           env=server.env, check=True)
            assert len(daily_files[0].read_text().splitlines()) == 1
            print("PASS: real firmware JSON -> authenticated PHP ingest -> latest -> JSONL/history")
            print("PASS: missing samples excluded from aggregates; repeated cron creates no duplicate")
            print("PASS: authenticated interval change takes effect in the next window")
        finally:
            server.close()


if __name__ == "__main__":
    main()
