import type { Metric } from "../types";
function evaluation(metric: Metric, value: number | null): string {
  if (value === null) return "有効な測定値なし";
  // Preserve the Arduino's existing 1..8 evaluation, including round for noise.
  let deviation: number;
  switch (metric.key) {
    case "temperature_c":
      deviation = Math.floor(Math.abs(value - 23) / 2);
      break;
    case "humidity_pct":
      deviation = Math.floor(Math.abs(value - 50) / 6);
      break;
    case "eco2_ppm":
      deviation = Math.floor(Math.max(0, value - 400) / 575);
      break;
    case "noise_db":
      deviation = Math.round(Math.max(0, value - 35) / 5);
      break;
  }
  return `EDL 評価 ${Math.max(1, Math.min(8, 8 - deviation))}/8`;
}
export function MetricCard({
  metric,
  value,
  stale,
}: {
  metric: Metric;
  value: number | null;
  stale: boolean;
}) {
  return (
    <article className="metric-card" style={{ borderTopColor: metric.color }}>
      <h2>{metric.label}</h2>
      <p className="value">
        {value === null ? "—" : value.toFixed(metric.digits)}
        <span>{metric.unit}</span>
      </p>
      <p className="muted">
        {stale ? "更新待ち · 最終受信値" : evaluation(metric, value)}
      </p>
    </article>
  );
}
