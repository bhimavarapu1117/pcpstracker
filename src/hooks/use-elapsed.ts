import { useEffect, useState } from "react";

/** Seconds elapsed since `startIso`, ticking every second while it is set. */
export function useElapsed(startIso: string | null | undefined, baseSeconds = 0) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startIso) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startIso]);

  if (!startIso) return baseSeconds;
  const started = new Date(startIso).getTime();
  if (Number.isNaN(started)) return baseSeconds;
  return baseSeconds + Math.max(0, Math.floor((now - started) / 1000));
}

export function formatDuration(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
}

export function formatShort(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}
