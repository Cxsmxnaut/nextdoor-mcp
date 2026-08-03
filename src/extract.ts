import crypto from "node:crypto";
import type { Page } from "playwright";
import type { Entity } from "./types.js";

export async function extractEntities(page: Page, limit = 50): Promise<Entity[]> {
  const rows = await page.locator('article, [role="article"], [data-testid="feed-item-card"], [role="listitem"], main li').evaluateAll((nodes, max) =>
    nodes.slice(0, max as number).map(node => {
      const el = node as HTMLElement;
      const link = (el.querySelector('a[href*="/p/"]') || el.querySelector('a[href]')) as HTMLAnchorElement | null;
      const time = el.querySelector('time');
      const heading = el.querySelector('h1,h2,h3,h4,[role="heading"]');
      const img = el.querySelector('img') as HTMLImageElement | null;
      return {
        title: heading?.textContent?.trim(), text: el.innerText?.trim(),
        url: link?.href, timestamp: time?.getAttribute('datetime') || time?.textContent?.trim(),
        image: img?.src, aria: el.getAttribute('aria-label')
      };
    }).filter(x => x.text)
  , limit);
  const entities = rows.map((row, i) => ({
    id: crypto.createHash("sha256").update(`${page.url()}|${row.url}|${row.text}`).digest("hex").slice(0, 16),
    type: "page_item", title: row.title || undefined, text: row.text?.slice(0, 5000),
    url: row.url || undefined, timestamp: row.timestamp || undefined,
    metadata: { index: i, image: row.image || undefined, ariaLabel: row.aria || undefined }
  }));
  if (entities.length) return entities;

  // Nextdoor sometimes renders feed cards as unannotated nested divs. Avoid
  // returning the entire UI: split meaningful visible lines into bounded,
  // stable chunks and discard navigation chrome and placeholders.
  const main = page.locator("main").first();
  let text = await main.count() ? await main.innerText() : "";
  if (text.trim().length < 200) text = await page.locator("body").innerText();
  const ignored = /^(skip to .+|home|settings|help center|invite neighbors|post|for you|recent|nearby|trending|shortcuts|chats|search for|groups|events|alerts|ask|local news|for sale & free)$/i;
  const lines = text.split("\n").map(x => x.trim()).filter(x => x && x !== " " && !ignored.test(x));
  const chunks: string[] = [];
  for (let i = 0; i < lines.length && chunks.length < limit; i += 10) {
    const chunk = lines.slice(i, i + 10).join("\n");
    if (chunk.length >= 30) chunks.push(chunk);
  }
  return chunks.map((text, i) => ({
    id: crypto.createHash("sha256").update(`${page.url()}|${text}`).digest("hex").slice(0, 16),
    type: "visible_content", title: text.split("\n")[0], text: text.slice(0, 5000),
    url: page.url(), metadata: { index: i, extraction: "lean_text_chunk" }
  }));
}

export async function discoverNavigation(page: Page) {
  return page.locator('a[href]').evaluateAll(links => links.map(link => ({
    label: ((link as HTMLElement).innerText || link.getAttribute('aria-label') || '').trim(),
    href: (link as HTMLAnchorElement).href
  })).filter(x => x.label && x.href.includes('nextdoor.com')));
}
