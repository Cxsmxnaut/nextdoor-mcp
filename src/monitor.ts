import crypto from "node:crypto";
import { browse } from "./platform.js";
import { load, mutate, audit } from "./store.js";
import type { Surface } from "./types.js";

interface Monitor { id: string; name: string; surface: Surface; query?: string; intervalMinutes?: number; createdAt: string; lastRunAt?: string; seenIds: string[] }

export function createMonitor(name: string, surface: Surface, query?: string, intervalMinutes?: number) {
  const monitor: Monitor = { id: crypto.randomUUID(), name, surface, query, intervalMinutes, createdAt: new Date().toISOString(), seenIds: [] };
  mutate(state => { state.monitors[monitor.id] = monitor; });
  audit({ event: "monitor_created", monitorId: monitor.id, name, surface });
  return monitor;
}

export function startMonitorScheduler() {
  const pollMs = Math.max(30_000, Number(process.env.NEXTDOOR_MONITOR_POLL_MS || 60_000));
  const timer = setInterval(async () => {
    for (const raw of listMonitors()) {
      const monitor = raw as Monitor;
      if (!monitor.intervalMinutes) continue;
      const due = !monitor.lastRunAt || Date.now() - Date.parse(monitor.lastRunAt) >= monitor.intervalMinutes * 60_000;
      if (due) await runMonitor(monitor.id).catch(error => audit({ event: "monitor_failed", monitorId: monitor.id, error: error instanceof Error ? error.message : String(error) }));
    }
  }, pollMs);
  timer.unref();
}

export function listMonitors() {
  return Object.values(load().monitors).filter(x => x && typeof x === "object" && "id" in (x as object));
}

export async function runMonitor(id: string) {
  const monitor = load().monitors[id] as Monitor | undefined;
  if (!monitor) throw new Error("Monitor not found.");
  const result = await browse(monitor.surface, { query: monitor.query, limit: 100, fresh: true });
  const seen = new Set(monitor.seenIds);
  const fresh = result.entities.filter(entity => !seen.has(entity.id));
  mutate(state => {
    const saved = state.monitors[id] as Monitor;
    saved.lastRunAt = new Date().toISOString();
    saved.seenIds = result.entities.map(x => x.id).slice(0, 1000);
  });
  audit({ event: "monitor_run", monitorId: id, newCount: fresh.length });
  return { monitorId: id, newCount: fresh.length, entities: fresh, checkedAt: new Date().toISOString() };
}

export function deleteMonitor(id: string) {
  return mutate(state => ({ deleted: delete state.monitors[id], id }));
}
