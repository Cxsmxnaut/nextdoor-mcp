import { chromium, type BrowserContext, type Page } from "playwright";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { audit } from "./store.js";

let context: BrowserContext | undefined;
let routingInstalled = false;
let personalProfileHref: string | undefined;
let businessProfileHref: string | undefined;
const resourceStats = { allowed: 0, blocked: 0, byType: {} as Record<string, { allowed: number; blocked: number }> };
export const profileDir = process.env.NEXTDOOR_PROFILE_DIR || path.join(os.homedir(), ".nextdoor-mcp", "profile");

function browserOptions() {
  const configured = process.env.NEXTDOOR_BROWSER_CHANNEL;
  // Use the user's installed, normal Google Chrome by default. An empty or
  // explicit "chromium" value opts back into Playwright's bundled browser.
  return configured === "chromium" ? {} : { channel: configured || "chrome" };
}

async function launchContext(): Promise<BrowserContext> {
  const options = {
    ...browserOptions(),
    headless: process.env.NEXTDOOR_HEADLESS !== "false",
    viewport: { width: 1024, height: 768 },
    locale: "en-US",
    args: [
      "--disable-background-networking", "--disable-component-update",
      "--disable-default-apps", "--disable-extensions", "--disable-sync",
      "--metrics-recording-only", "--mute-audio", "--no-first-run"
    ]
  };
  try {
    return await chromium.launchPersistentContext(profileDir, options);
  } catch (error) {
    if (process.env.NEXTDOOR_BROWSER_CHANNEL === "chromium") throw error;
    console.error("Google Chrome was unavailable; falling back to bundled Chromium.");
    const { channel: _channel, ...fallback } = options;
    return chromium.launchPersistentContext(profileDir, fallback);
  }
}

export async function page(): Promise<Page> {
  if (!context) {
    fs.mkdirSync(profileDir, { recursive: true });
    context = await launchContext();
  }
  if (!routingInstalled && process.env.NEXTDOOR_RESOURCE_MODE !== "full") {
    await context.route("**/*", route => {
      const type = route.request().resourceType();
      const mode = process.env.NEXTDOOR_RESOURCE_MODE || "html";
      const hostname = (() => { try { return new URL(route.request().url()).hostname; } catch { return ""; } })();
      const presentation = ["image", "media", "font"].includes(type) || (mode === "html" && type === "stylesheet");
      const telemetry = /google-analytics|doubleclick|googletagmanager|segment|amplitude|sentry|branch\.io/i.test(hostname);
      resourceStats.byType[type] ||= { allowed: 0, blocked: 0 };
      if (presentation || telemetry) {
        resourceStats.blocked++;
        resourceStats.byType[type].blocked++;
        return route.abort();
      }
      resourceStats.allowed++;
      resourceStats.byType[type].allowed++;
      return route.continue();
    });
    routingInstalled = true;
  }
  const pages = context.pages();
  for (const extra of pages.slice(1)) await extra.close().catch(() => undefined);
  return pages[0] || context.newPage();
}

async function switchIdentity(p: Page, identity: "personal" | "business") {
  let href = identity === "personal" ? personalProfileHref : businessProfileHref;
  if (!href) {
    await p.locator("body").waitFor({ state: "attached", timeout: 5000 });
    await p.waitForFunction(() => (document.body?.innerText || "").length > 20, undefined, { timeout: 5000 }).catch(() => undefined);
    await p.locator('[role="button"][aria-expanded]').first().click({ timeout: 5000 });
    const selector = identity === "personal" ? 'a[href^="/news_feed/?profile_id="]' : 'a[href^="/page-admin/home/?profile_id="]';
    href = await p.locator(selector).first().getAttribute("href").then(value => value || undefined);
    if (identity === "personal") personalProfileHref = href; else businessProfileHref = href;
  }
  if (!href) throw new Error(`Nextdoor ${identity}-profile switch link was not available.`);
  await p.goto(new URL(href, "https://nextdoor.com").href, { waitUntil: "commit", timeout: 20_000 });
  const prefix = identity === "personal" ? "/news_feed" : "/page-admin/";
  await p.waitForURL(url => url.pathname.startsWith(prefix), { timeout: 8000 });
}

export async function openNextdoor(route = ""): Promise<Page> {
  const p = await page();
  const target = new URL(route, "https://nextdoor.com");
  let current = new URL(p.url(), "https://nextdoor.com");
  const personalPath = /^\/(news_feed|search|for_sale_and_free|groups|local_events|alerts|notifications|settings|profile)(\/|$)/.test(target.pathname);
  const businessPath = target.pathname.startsWith("/page-admin/");
  if (personalPath && current.pathname.startsWith("/page-admin/")) {
    await switchIdentity(p, "personal");
    current = new URL(p.url());
  } else if (businessPath && current.hostname === "nextdoor.com" && !current.pathname.startsWith("/page-admin/")) {
    await switchIdentity(p, "business");
    current = new URL(p.url());
  }
  const samePage = current.hostname === target.hostname && current.pathname === target.pathname && current.search === target.search;
  if (!samePage) {
    let navigated = false;
    if (current.hostname === "nextdoor.com") {
      const anchor = p.locator(`a[href^="${target.pathname}"]`).first();
      if (await anchor.count()) {
        const beforeText = await p.locator("body").innerText().catch(() => "");
        await anchor.click({ noWaitAfter: true, timeout: 3000 }).catch(() => undefined);
        navigated = await p.waitForURL(url => url.pathname === target.pathname && url.search === target.search, { timeout: 5000 }).then(() => true).catch(() => false);
        if (navigated) await p.waitForFunction(previous => (document.body?.innerText || "") !== previous, beforeText, { timeout: 5000 }).catch(() => undefined);
      }
    }
    if (!navigated) {
      try {
        await p.goto(target.href, { waitUntil: "commit", timeout: 20_000 });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/ERR_NETWORK_CHANGED|ERR_CONNECTION_RESET|ERR_TIMED_OUT|interrupted by another navigation to "chrome-error/i.test(message)) throw error;
        await p.waitForTimeout(400);
        await p.goto(target.href, { waitUntil: "commit", timeout: 20_000 });
      }
    }
  }
  await p.locator("body").waitFor({ state: "attached", timeout: 8_000 });
  await p.waitForFunction(() => (document.body?.innerText || "").trim().length > 20, undefined, { timeout: 8_000 }).catch(() => undefined);
  await p.waitForTimeout(150);
  const finalPath = new URL(p.url()).pathname;
  if (personalPath && finalPath.startsWith("/page-admin/")) {
    await switchIdentity(p, "personal");
    if (new URL(p.url()).pathname !== target.pathname) await p.goto(target.href, { waitUntil: "commit", timeout: 20_000 });
  } else if (businessPath && !finalPath.startsWith("/page-admin/")) {
    await switchIdentity(p, "business");
    if (new URL(p.url()).pathname !== target.pathname) await p.goto(target.href, { waitUntil: "commit", timeout: 20_000 });
  }
  const body = await p.locator("body").innerText().catch(() => "");
  if (/captcha|verify you are human|security check/i.test(body)) {
    audit({ event: "verification_required", url: p.url() });
    throw new Error("Nextdoor requires interactive verification. Complete it in the Chrome window; this MCP will not bypass it.");
  }
  return p;
}

export async function loggedIn(p: Page): Promise<boolean> {
  if (/login|signin|verify/i.test(p.url())) return false;
  if (await p.locator('input[type="password"]:visible').count()) return false;
  if (/\/news_feed\/?|\/search\/?|\/inbox\/?|\/business\/|\/page-admin\//i.test(new URL(p.url()).pathname)) {
    // Unauthenticated visits are redirected to an auth route. App routes can
    // render their navigation asynchronously, so the route itself is the most
    // reliable positive signal after excluding visible authentication fields.
    return true;
  }
  return (await p.locator('a[href*="/news_feed"], a[href*="/messages"], nav').count()) > 0;
}

export async function textSnapshot(p: Page, limit = 12000): Promise<string> {
  return (await p.locator("body").innerText()).replace(/\n{3,}/g, "\n\n").slice(0, limit);
}

export function writesAllowed(): boolean {
  return process.env.NEXTDOOR_ALLOW_WRITE === "true";
}

export function performanceStatus() {
  return {
    headless: process.env.NEXTDOOR_HEADLESS !== "false",
    resourceMode: process.env.NEXTDOOR_RESOURCE_MODE || "html",
    viewport: { width: 1024, height: 768 },
    contextReuse: true, pageReuse: true,
    requests: structuredClone(resourceStats)
  };
}

export async function diagnose(p: Page) {
  const body = await textSnapshot(p, 3000);
  return {
    url: p.url(), title: await p.title(),
    notFound: /can.t seem to find that page|page not found/i.test(body),
    verificationRequired: /captcha|verify you are human|security check/i.test(body),
    permissionDenied: /don.t have permission|access denied|not authorized/i.test(body)
  };
}

export async function closeBrowser(): Promise<void> {
  await context?.close();
  context = undefined;
  routingInstalled = false;
  personalProfileHref = undefined;
  businessProfileHref = undefined;
}
