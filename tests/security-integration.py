"""Python標準ライブラリとPHP CLIで実際のHTTP認証・負荷制限を検証する。

認証情報と保存データはすべて使い捨て。本番サーバーには接続しない。
実行例: python tests/security-integration.py [--php /path/to/php]
"""
import argparse
import contextlib
import http.cookiejar
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
KEY = "test-device-key-with-at-least-32-characters"
PASSWORD = "disposable-demo-password"
PHP = shutil.which("php")


class Server:
    """公開APIと、その外側の秘密コード・保存先を配布時と同じ構成で分離する。"""
    def __init__(self, allow_http=True, public_storage=False):
        self.temp = tempfile.TemporaryDirectory(prefix="edl-security-")
        self.root = Path(self.temp.name)
        self.public = self.root / "public"
        shutil.copytree(ROOT / "server/public/api", self.public / "api")
        shutil.copytree(ROOT / "server/private", self.root / "private")
        self.data = (self.public if public_storage else self.root) / "data"
        self.data.mkdir()
        (self.data / "config.json").write_text(json.dumps({"device_key": KEY}))
        password_hash = subprocess.check_output(
            [PHP, "-r", "echo password_hash($argv[1], PASSWORD_DEFAULT);", PASSWORD], text=True
        )
        (self.data / "pass").write_text(password_hash)
        self.env = dict(os.environ, EDL_DATA_DIR=str(self.data))
        self.env.pop("EDL_CONFIG_FILE", None)
        self.env.pop("EDL_PASSWORD_FILE", None)
        self.env.pop("EDL_ALLOW_HTTP", None)
        if allow_http:
            self.env["EDL_ALLOW_HTTP"] = "1"
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        self.url = f"http://127.0.0.1:{port}"
        self.log = open(self.root / "php.log", "w+")
        self.process = subprocess.Popen(
            [PHP, "-S", f"127.0.0.1:{port}", "-t", str(self.public)],
            env=self.env, stdout=self.log, stderr=self.log,
        )
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=.1):
                    return
            except OSError:
                if self.process.poll() is not None:
                    break
                time.sleep(.03)
        self.close()
        raise RuntimeError("PHP development server failed to start")

    def close(self):
        self.process.terminate()
        with contextlib.suppress(subprocess.TimeoutExpired):
            self.process.wait(timeout=5)
        if self.process.poll() is None:
            self.process.kill()
            self.process.wait()
        self.log.close()
        self.temp.cleanup()

    def client(self):
        return urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
        )

    def request(self, path, body=None, headers=None, method=None, client=None, raw=None):
        headers = dict(headers or {})
        if body is not None:
            raw = json.dumps(body).encode()
            headers.setdefault("Content-Type", "application/json")
        request = urllib.request.Request(
            self.url + path, data=raw, headers=headers, method=method
        )
        try:
            result = (client or self.client()).open(request, timeout=15)
        except urllib.error.HTTPError as error:
            result = error
        with result:
            content = result.read().decode()
            return result.status, result.headers, json.loads(content)

    def clear_rates(self):
        for path in (self.data / "rate").glob("*.json"):
            path.unlink()


class SecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = Server()

    @classmethod
    def tearDownClass(cls):
        cls.server.close()

    def setUp(self):
        self.server.clear_rates()
        self.client = self.server.client()

    def admin(self):
        status, headers, result = self.server.request("/api/admin.php", client=self.client)
        self.assertEqual(status, 200)
        return headers, result

    def login(self):
        _, guest = self.admin()
        status, headers, result = self.server.request(
            "/api/admin.php", {"action": "login", "password": PASSWORD},
            {"X-CSRF-Token": guest["csrf"]}, client=self.client,
        )
        self.assertEqual(status, 200)
        return headers, result

    def ingest(self, body=None, headers=None):
        body = body or {"device_id": "edl-arduino", "uptime_ms": 10000,
                        "temperature_c": 23.5, "humidity_pct": 50.5,
                        "eco2_ppm": 600, "noise_db": 45,
                        "validity": {"temperature": True, "humidity": True,
                                     "eco2": True, "noise": True}}
        return self.server.request("/api/ingest.php", body,
                                   headers or {"X-Device-Key": KEY})

    def test_settings_require_authentication_and_csrf(self):
        _, guest = self.admin()
        status, _, _ = self.server.request("/api/admin.php", {
            "action": "settings", "interval_minutes": 1}, client=self.client)
        self.assertEqual(status, 403)
        status, _, _ = self.server.request("/api/admin.php", {
            "action": "settings", "interval_minutes": 1},
            {"X-CSRF-Token": guest["csrf"]}, client=self.client)
        self.assertEqual(status, 401)

    def test_cookie_flags_session_rotation_logout_and_settings_boundaries(self):
        guest_headers, guest = self.admin()
        cookie = guest_headers.get("Set-Cookie", "")
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Strict", cookie)
        self.assertIn("path=/api/", cookie)
        auth_headers, auth = self.login()
        self.assertNotEqual(guest["csrf"], auth["csrf"])
        self.assertNotEqual(cookie.split(";")[0], auth_headers["Set-Cookie"].split(";")[0])
        for value in [1, 60]:
            status, _, result = self.server.request("/api/admin.php", {
                "action": "settings", "interval_minutes": value},
                {"X-CSRF-Token": auth["csrf"]}, client=self.client)
            self.assertEqual(status, 200)
            self.assertEqual(result["interval_minutes"], value)
        for value in [0, 61, True, 1.5, "30", None]:
            status, _, _ = self.server.request("/api/admin.php", {
                "action": "settings", "interval_minutes": value},
                {"X-CSRF-Token": auth["csrf"]}, client=self.client)
            self.assertEqual(status, 400, value)
        status, _, _ = self.server.request("/api/admin.php", {"action": "logout"},
            {"X-CSRF-Token": auth["csrf"]}, client=self.client)
        self.assertEqual(status, 200)
        self.assertFalse(self.admin()[1]["authenticated"])

    def test_expired_session_cannot_change_settings(self):
        headers, auth = self.login()
        session_id = headers["Set-Cookie"].split(";", 1)[0].split("=", 1)[1]
        session_file = self.server.data / "sessions" / ("sess_" + session_id)
        saved = session_file.read_text()
        self.assertRegex(saved, r"expires\|i:\d+;")
        session_file.write_text(re.sub(r"expires\|i:\d+;", "expires|i:1;", saved))
        status, _, _ = self.server.request("/api/admin.php", {
            "action": "settings", "interval_minutes": 2},
            {"X-CSRF-Token": auth["csrf"]}, client=self.client)
        self.assertEqual(status, 403)
        self.assertFalse(self.admin()[1]["authenticated"])

    def test_login_throttles_and_ignores_forwarded_addresses(self):
        _, guest = self.admin()
        for index in range(6):
            status, headers, _ = self.server.request("/api/admin.php", {
                "action": "login", "password": "wrong"},
                {"X-CSRF-Token": guest["csrf"], "X-Forwarded-For": f"192.0.2.{index}"},
                client=self.client)
            self.assertEqual(status, 401 if index < 5 else 429)
        self.assertGreater(int(headers["Retry-After"]), 0)

    def test_ingest_auth_nulls_type_and_range_validation(self):
        self.assertEqual(self.ingest(headers={"X-Device-Key": "wrong"})[0], 401)
        body = {"device_id": "edl-arduino", "uptime_ms": 4294967295,
                "temperature_c": None, "humidity_pct": 0, "eco2_ppm": 65000,
                "noise_db": 150, "validity": {"temperature": False,
                "humidity": True, "eco2": True, "noise": True}}
        self.assertEqual(self.ingest(body)[0], 200)
        for field, value in [("temperature_c", 23), ("humidity_pct", 101),
                             ("eco2_ppm", "600"), ("noise_db", -1),
                             ("uptime_ms", True), ("validity", "bad")]:
            bad = dict(body, **{field: value})
            self.assertEqual(self.ingest(bad)[0], 400, field)
        latest = self.server.request("/api/latest.php")[2]["latest"]
        self.assertIsNone(latest["temperature_c"])
        self.assertEqual(latest["uptime_ms"], 4294967295)
        self.assertIn("received_at", latest)

    def test_body_and_method_limits(self):
        self.assertEqual(self.server.request("/api/ingest.php", method="GET")[0], 405)
        headers = {"X-Device-Key": KEY, "Content-Type": "application/json"}
        self.assertEqual(self.server.request("/api/ingest.php", raw=b"{" + b"x" * 2048,
                                            headers=headers)[0], 413)
        self.assertEqual(self.server.request("/api/ingest.php", raw=b"{broken",
                                            headers=headers)[0], 400)
        self.assertEqual(self.server.request("/api/ingest.php", raw=b"[]",
                                            headers=headers)[0], 400)
        headers["Content-Type"] = "text/plain"
        self.assertEqual(self.server.request("/api/ingest.php", raw=b"{}",
                                            headers=headers)[0], 415)

    def test_read_throttling_and_history_bounds(self):
        for days in ["0", "8", "../../pass", "1.5"]:
            self.assertEqual(self.server.request("/api/history.php?days=" + days)[0], 400)
        for index in range(91):
            status, _, _ = self.server.request("/api/latest.php",
                headers={"X-Forwarded-For": f"192.0.2.{index}"})
            self.assertEqual(status, 200 if index < 90 else 429)

    def test_production_http_and_public_secrets_fail_closed(self):
        for options, expected in [({"allow_http": False}, 403),
                                   ({"public_storage": True}, 503)]:
            server = Server(**options)
            try:
                status, _, result = server.request("/api/latest.php")
                self.assertEqual(status, expected)
                self.assertNotIn(KEY, json.dumps(result))
                self.assertNotIn(str(server.root), json.dumps(result))
            finally:
                server.close()

    def test_corrupt_secret_configuration_returns_generic_error(self):
        path = self.server.data / "config.json"
        previous = path.read_text()
        try:
            path.write_text("{broken-secret-config")
            status, _, result = self.ingest()
            self.assertEqual(status, 503)
            self.assertEqual(result, {"error": "Service unavailable"})
        finally:
            path.write_text(previous)

    def test_busy_storage_releases_worker_with_bounded_wait(self):
        # OSごとのロック方式の差を避けるため、保持側と検証側の両方でPHPのflockを使う。
        process = subprocess.Popen([PHP, "-r",
            "$f=fopen($argv[1], 'c'); flock($f, LOCK_EX); "
            "echo 'ready\\n'; fflush(STDOUT); sleep(30);",
            str(self.server.data / "state.lock")], stdout=subprocess.PIPE, text=True)
        try:
            # PHPの単引用符による改行解釈に依存せず、ロック取得済みの印を読む。
            self.assertEqual(process.stdout.read(5), "ready")
            started = time.monotonic()
            self.assertEqual(self.ingest()[0], 503)
            # 並行ビルド中のCPU待ちを許容しつつ、30秒のロック保持まで待たないことを確認する。
            self.assertLess(time.monotonic() - started, 10.0)
        finally:
            process.terminate()
            process.wait(timeout=5)
            process.stdout.close()

    def test_global_admin_cap_prevents_new_session_files(self):
        self.admin()
        for path in (self.server.data / "rate").glob("admin-global-*.json"):
            path.write_text(json.dumps({"count": 120, "reset": int(time.time()) + 60}))
        before = set((self.server.data / "sessions").glob("sess_*"))
        status, _, _ = self.server.request("/api/admin.php")
        self.assertEqual(status, 429)
        self.assertEqual(set((self.server.data / "sessions").glob("sess_*")), before)

    def test_cron_cleans_expired_private_sessions(self):
        expired = self.server.data / "sessions" / "sess_expiredtest"
        active = self.server.data / "sessions" / "sess_activetest"
        expired.write_text("")
        active.write_text("")
        old = time.time() - 4000
        os.utime(expired, (old, old))
        completed = subprocess.run([PHP, str(ROOT / "server/bin/aggregate.php")],
                                   env=self.server.env, capture_output=True, text=True)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertFalse(expired.exists())
        self.assertTrue(active.exists())

    def test_corrupt_throttle_state_does_not_reset_request_count(self):
        self.assertEqual(self.server.request("/api/history.php")[0], 200)
        paths = list((self.server.data / "rate").glob("history-*.json"))
        self.assertTrue(paths)
        for damaged in ["{partial-write", ""]:
            for path in paths:
                path.write_text(damaged)
            status, _, result = self.server.request("/api/history.php")
            self.assertEqual(status, 503)
            self.assertEqual(result, {"error": "Service unavailable"})
            self.assertEqual(paths[0].read_text(), damaged)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--php", default=PHP)
    args, remaining = parser.parse_known_args()
    PHP = args.php
    if not PHP:
        parser.error("PHP CLI is required (use --php)")
    unittest.main(argv=[__file__] + remaining, verbosity=2)
