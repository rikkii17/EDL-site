import { useState } from "react";
import { useMeasurements } from "./hooks/useMeasurements";
import { MetricCard } from "./components/MetricCard";
import { HistoryChart } from "./components/HistoryChart";
import { SettingsPanel } from "./components/SettingsPanel";
import { metrics } from "./types";
import "./App.css";
export default function App() {
  const [days, setDays] = useState(1),
    [settings, setSettings] = useState(false);
  const { latest, records, interval, error, checkedAt } = useMeasurements(days);
  const stale = !latest || checkedAt - Date.parse(latest.received_at) > 60000;
  return (
    <main className="dashboard">
      <header>
        <div>
          <span className="eyebrow">ENGINEERING DESIGN LABORATORY</span>
          <h1>空間のいまを、知る。</h1>
          <p>EDL 環境モニター</p>
        </div>
        <button
          className="quiet"
          onClick={() => setSettings(!settings)}
          aria-expanded={settings}
        >
          設定
        </button>
      </header>
      <section className="connection" aria-live="polite">
        <span className={`dot ${stale ? "offline" : ""}`} />
        <strong>{stale ? "測定データを待っています" : "測定中"}</strong>
        <span>
          {latest
            ? new Date(latest.received_at).toLocaleTimeString("ja-JP") + " 受信"
            : "Arduino 未接続"}
        </span>
      </section>
      {error && (
        <p className="notice" role="status">
          {error}
        </p>
      )}
      <section className="metric-grid" aria-label="最新測定値">
        {metrics.map((metric) => (
          <MetricCard
            key={metric.key}
            metric={metric}
            value={latest?.[metric.key] ?? null}
            stale={stale}
          />
        ))}
      </section>
      <section className="history">
        <div className="section-heading">
          <div>
            <span className="eyebrow">HISTORY</span>
            <h2>環境の変化</h2>
          </div>
          <select
            aria-label="履歴の表示期間"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={1}>24時間</option>
            <option value={3}>3日間</option>
            <option value={7}>7日間</option>
          </select>
        </div>
        <p className="muted">
          {interval}分ごとの平均値 · 欠測はグラフに接続しません
        </p>
        {metrics.map((metric) => (
          <HistoryChart key={metric.key} metric={metric} records={records} />
        ))}
      </section>
      {settings && <SettingsPanel onSaved={() => setSettings(false)} />}
      <footer>
        最新値は10秒ごとに更新。画面の履歴は直近7日まで。eCO₂は推定値、騒音は換算値です。評価はデモ用の目安です。
      </footer>
    </main>
  );
}
