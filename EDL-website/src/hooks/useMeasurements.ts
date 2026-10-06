import { useEffect, useState } from "react";
import { api, type Latest, type HistoryRecord } from "../types";
// 完了後のタイマー予約で通信の重複を防ぐ。非表示タブでは更新を停止する。
export function useMeasurements(days: number) {
  const [checkedAt, setCheckedAt] = useState(0);
  const [latest, setLatest] = useState<Latest | null>(null),
    [records, setRecords] = useState<HistoryRecord[]>([]),
    [interval, setIntervalMinutes] = useState(30),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let round = 0;
    async function poll() {
      setCheckedAt(Date.now());
      try {
        if (!document.hidden) {
          const data = await api<{
            latest: Latest | null;
            settings: {
              interval_minutes: number;
            };
          }>("latest.php", { signal: controller.signal });
          if (controller.signal.aborted) return;
          setLatest(data.latest);
          setIntervalMinutes(data.settings.interval_minutes);
          setError("");
          if (round++ % 6 === 0) {
            const history = await api<{
              records: HistoryRecord[];
            }>(`history.php?days=${days}`, { signal: controller.signal });
            if (!controller.signal.aborted) setRecords(history.records);
          }
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "通信エラー");
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 10000);
      }
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [days]);
  return { latest, records, interval, error, checkedAt };
}
