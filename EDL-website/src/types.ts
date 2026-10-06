export type MetricKey =
  "temperature_c" | "humidity_pct" | "eco2_ppm" | "noise_db";
export interface Metric {
  key: MetricKey;
  label: string;
  unit: string;
  color: string;
  digits: number;
}
export interface Latest extends Record<MetricKey, number | null> {
  received_at: string;
  device_id: string;
}
export interface HistoryRecord {
  started_at: string;
  ended_at: string;
  samples: number;
  metrics: Record<
    MetricKey,
    {
      mean: number | null;
      min: number | null;
      max: number | null;
      count: number;
    }
  >;
}
export const metrics: Metric[] = [
  {
    key: "temperature_c",
    label: "温度",
    unit: "°C",
    color: "#e48052",
    digits: 1,
  },
  {
    key: "humidity_pct",
    label: "湿度",
    unit: "%",
    color: "#508ebd",
    digits: 1,
  },
  { key: "eco2_ppm", label: "eCO₂", unit: "ppm", color: "#569d80", digits: 0 },
  { key: "noise_db", label: "騒音", unit: "dB", color: "#9c83bf", digits: 1 },
];
export class HttpError extends Error {
  public status: number;
  constructor(
    status: number,
    message: string,
  ) {
    super(message);
    this.status = status;
  }
}
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    credentials: "same-origin",
    ...init,
  });
  if (!response.ok)
    throw new HttpError(
      response.status,
      response.status === 429
        ? "アクセスが集中しています。しばらく待ってください。"
        : response.status === 401
          ? "パスワードまたは認証状態を確認してください。"
          : "サーバーとの通信に失敗しました。",
    );
  return response.json() as Promise<T>;
}
