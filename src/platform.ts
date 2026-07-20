import path from "node:path";
import fs from "node:fs";
import type { Page } from "playwright";
import { openNextdoor, loggedIn, textSnapshot, diagnose } from "./browser.js";
import { extractEntities, discoverNavigation } from "./extract.js";
import { audit, load, mutate } from "./store.js";
import type { Surface } from "./types.js";
import { dataDir } from "./store.js";

const fallbackRoutes: Record<Surface, string> = {
  feed: "/news_feed/", search: "/search/", inbox: "/inbox/",
  marketplace: "/for_sale_and_free/", groups: "/groups/", events: "/local_events/",
  alerts: "/alerts/", notifications: "/notifications/", settings: "/settings",
  business: "/page-admin/dashboard/", ads: "/page-admin/ads-management/", profile: "/profile/"
};
const readCache = new Map<string, { at: number; value: Awaited<ReturnType<typeof readSurface>> }>();

export async function ensureLogin(page: Page): Promise<void> {
  if (!(await loggedIn(page))) throw new Error("Nextdoor login is required. Run `npm run login`, sign in, and retry.");
}

export async function discover() {
  const page = await openNextdoor("/news_feed/");
  await ensureLogin(page);
  const links = await discoverNavigation(page);
  const routeMap = { ...fallbackRoutes };
  const matchers: Partial<Record<Surface, RegExp>> = {
    feed: /home/i, inbox: /chat|message/i, marketplace: /for sale|free/i, groups: /group/i,
    events: /event/i, alerts: /alert/i, notifications: /notification/i, settings: /setting/i,
    business: /business|page/i, ads: /promote|ad manager|advertis/i
  };
  for (const [surface, matcher] of Object.entries(matchers)) {
    const hit = links.find(x => matcher!.test(`${x.label} ${x.href}`));
    if (hit) routeMap[surface as Surface] = new URL(hit.href).pathname + new URL(hit.href).search;
  }
  mutate(state => { state.monitors.navigation = { at: new Date().toISOString(), routeMap, links }; });
  return { routeMap, links };
}

async function readSurface(surface: Surface, options: { query?: string; limit?: number } = {}) {
  const cached = load().monitors.navigation as { routeMap?: Record<Surface, string> } | undefined;
  const route = cached?.routeMap?.[surface] || fallbackRoutes[surface];
  const url = surface === "search" && options.query ? `${route}?query=${encodeURIComponent(options.query)}` : route;
  const page = await openNextdoor(url);
  await ensureLogin(page);
  await page.waitForTimeout(300);
  const health = await diagnose(page);
  const expectedPath = new URL(url, "https://nextdoor.com").pathname.replace(/\/$/, "");
  const actualPath = new URL(page.url()).pathname.replace(/\/$/, "");
  if (actualPath !== expectedPath) throw new Error(`Nextdoor routed ${surface} to an unexpected surface (${actualPath || "/"} instead of ${expectedPath || "/"}). Run capability_inventory or switch account identity.`);
  if (health.notFound) throw new Error(`Nextdoor no longer exposes the ${surface} surface at ${url}. Run capability_inventory to rediscover navigation.`);
  const entities = await extractEntities(page, options.limit || 50);
  audit({ event: "surface_read", surface, url: page.url(), count: entities.length });
  return { surface, url: page.url(), health, entities, fallbackText: entities.length ? undefined : await textSnapshot(page) };
}

export async function browse(surface: Surface, options: { query?: string; limit?: number; fresh?: boolean } = {}) {
  const key = JSON.stringify([surface, options.query || "", options.limit || 50]);
  const ttl = Math.max(0, Number(process.env.NEXTDOOR_READ_CACHE_MS || 5000));
  const hit = readCache.get(key);
  if (!options.fresh && hit && Date.now() - hit.at < ttl) return { ...hit.value, cache: { hit: true, ageMs: Date.now() - hit.at } };
  const value = await readSurface(surface, options);
  readCache.set(key, { at: Date.now(), value });
  return { ...value, cache: { hit: false, ttlMs: ttl } };
}

export async function inventory() {
  const navigation = await discover();
  const results: Record<string, unknown> = {};
  for (const surface of Object.keys(fallbackRoutes) as Surface[]) {
    try {
      const page = await openNextdoor(navigation.routeMap[surface]);
      const health = await diagnose(page);
      results[surface] = { available: !health.notFound && !health.permissionDenied, route: page.url(), health };
    } catch (error) { results[surface] = { available: false, error: error instanceof Error ? error.message : String(error) }; }
  }
  return { discoveredAt: new Date().toISOString(), capabilities: results, navigation: navigation.links };
}

export async function inspectUrl(rawUrl: string, includeScreenshot = false) {
  const url = new URL(rawUrl, "https://nextdoor.com");
  if (!/(^|\.)nextdoor\.com$/.test(url.hostname)) throw new Error("Inspection is restricted to nextdoor.com.");
  const page = await openNextdoor(url.pathname + url.search);
  await ensureLogin(page);
  await page.waitForTimeout(1000);
  const health = await diagnose(page);
  const entities = await extractEntities(page, 50);
  let screenshotPath: string | undefined;
  if (includeScreenshot) {
    const dir = path.join(dataDir, "diagnostics");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    screenshotPath = path.join(dir, `nextdoor-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });
  }
  audit({ event: "url_inspected", url: page.url(), entityCount: entities.length, screenshot: Boolean(screenshotPath) });
  return { url: page.url(), health, entities, screenshotPath };
}

export function validateFiles(paths: string[]): string[] {
  const allowed = (process.env.NEXTDOOR_ALLOWED_FILES || `${process.env.HOME || ""}/Pictures,${process.env.HOME || ""}/Downloads`).split(",").map(x => fs.realpathSync(path.resolve(x)));
  const permitted = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".pdf", ".txt"]);
  return paths.map(file => {
    const resolved = fs.realpathSync(path.resolve(file));
    if (!allowed.some(dir => resolved.startsWith(dir + path.sep) || resolved === dir)) throw new Error(`File is outside NEXTDOOR_ALLOWED_FILES: ${resolved}`);
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size > 25 * 1024 * 1024) throw new Error(`Invalid or oversized attachment: ${resolved}`);
    if (!permitted.has(path.extname(resolved).toLowerCase())) throw new Error(`Unsupported attachment type: ${resolved}`);
    return resolved;
  });
}
