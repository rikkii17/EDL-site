import { useEffect, useState } from "react";
import { api, HttpError } from "../types";
interface AdminState {
  authenticated: boolean;
  csrf: string;
  interval_minutes: number;
}
// セッションはHttpOnly Cookieに保持し、JavaScriptはCSRFトークンだけを扱う。
// 認証期限切れやログイン時の更新後は新しいトークンを取得する。
export function SettingsPanel({ onSaved }: { onSaved: () => void }) {
  const [authenticated, setAuthenticated] = useState(false),
    [csrf, setCsrf] = useState(""),
    [password, setPassword] = useState(""),
    [minutes, setMinutes] = useState(30),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    api<{
      authenticated: boolean;
      csrf: string;
      interval_minutes: number;
    }>("admin.php", { signal: controller.signal })
      .then((data) => {
        setAuthenticated(data.authenticated);
        setCsrf(data.csrf);
        setMinutes(data.interval_minutes);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setMessage(error.message);
      });
    return () => controller.abort();
  }, []);
  async function submit(action: "login" | "settings" | "logout") {
    setBusy(true);
    setMessage("");
    try {
      const data = await api<{
        csrf?: string;
      }>("admin.php", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({
          action,
          ...(action === "login"
            ? { password }
            : action === "settings"
              ? { interval_minutes: minutes }
              : {}),
        }),
      });
      if (action === "login") {
        setAuthenticated(true);
        setCsrf(data.csrf!);
        setPassword("");
      } else if (action === "logout") {
        setAuthenticated(false);
        setCsrf("");
        onSaved();
      } else setMessage("保存しました。次の集計から適用されます。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "通信エラー");
      if (
        error instanceof HttpError &&
        (error.status === 401 || error.status === 403)
      ) {
        try {
          const fresh = await api<AdminState>("admin.php");
          setAuthenticated(fresh.authenticated);
          setCsrf(fresh.csrf);
        } catch {
          setCsrf("");
        }
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings">
      <h2>保存設定</h2>
      <p className="muted">管理パスワードを知っている方のみ変更できます。</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(authenticated ? "settings" : "login");
        }}
      >
        {authenticated ? (
          <label>
            履歴の保存間隔（分）
            <input
              type="number"
              min="1"
              max="60"
              step="1"
              required
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
            />
          </label>
        ) : (
          <label>
            管理パスワード
            <input
              type="password"
              autoComplete="current-password"
              maxLength={256}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
        <button disabled={busy || !csrf}>
          {authenticated ? "設定を保存" : "ログイン"}
        </button>
        {authenticated && (
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={() => void submit("logout")}
          >
            ログアウト
          </button>
        )}
      </form>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
    </section>
  );
}
