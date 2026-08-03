import type { Page } from "playwright";
import { openNextdoor, loggedIn, textSnapshot, writesAllowed } from "./browser.js";
import { validateFiles } from "./platform.js";

async function ensureLogin(p: Page) {
  if (!(await loggedIn(p))) throw new Error("Nextdoor login is required. Run `npm run login`, sign in in the opened browser, then retry.");
}

async function firstVisible(p: Page, selectors: string[]) {
  for (const selector of selectors) {
    const loc = p.locator(selector).filter({ visible: true }).first();
    if (await loc.count()) return loc;
  }
  throw new Error(`Nextdoor UI changed; none of the expected controls were found: ${selectors.join(", ")}`);
}

export async function status() {
  const p = await openNextdoor("/news_feed/");
  return {
    loggedIn: await loggedIn(p), url: p.url(), writesEnabled: writesAllowed(),
    browserChannel: process.env.NEXTDOOR_BROWSER_CHANNEL || "chrome",
    resourceMode: process.env.NEXTDOOR_RESOURCE_MODE || "html",
    dailySpendLimit: Number(process.env.NEXTDOOR_MAX_DAILY_SPEND || 0),
    campaignSpendLimit: Number(process.env.NEXTDOOR_MAX_CAMPAIGN_SPEND || 0)
  };
}

export async function search(query: string) {
  const p = await openNextdoor(`/search/?query=${encodeURIComponent(query)}`);
  await ensureLogin(p);
  await p.waitForTimeout(1500);
  return { query, url: p.url(), results: await textSnapshot(p) };
}

export async function draftPost(body: string, imagePaths: string[] = []) {
  if (!writesAllowed()) throw new Error("Drafting is disabled. Set NEXTDOOR_ALLOW_WRITE=true and restart Claude Desktop.");
  const p = await openNextdoor("/news_feed/");
  await ensureLogin(p);
  const composer = await firstVisible(p, [
    'button:has-text("Create a post")', 'button:has-text("Post")',
    '[role="button"]:has-text("Create a post")', 'textarea[placeholder*="neighbor" i]'
  ]);
  await composer.click();
  const editor = await firstVisible(p, ['textarea', '[contenteditable="true"]']);
  await editor.fill(body);
  const files = imagePaths.length ? validateFiles(imagePaths) : [];
  if (files.length) {
    const input = p.locator('input[type="file"]').first();
    if (!(await input.count())) throw new Error("The post composer did not expose an image picker.");
    await input.setInputFiles(files);
    await p.waitForTimeout(1000);
  }
  return { drafted: true, imageCount: files.length, preview: body, note: "Draft is open in the browser. Use perform_action(create_post) for autonomous publishing." };
}

export async function publishPost() {
  if (!writesAllowed()) throw new Error("Publishing is disabled. Set NEXTDOOR_ALLOW_WRITE=true in Claude Desktop configuration, then restart Claude.");
  const p = await openNextdoor("/news_feed/");
  await ensureLogin(p);
  const button = await firstVisible(p, ['button:has-text("Post")', 'button:has-text("Publish")']);
  if (await button.isDisabled()) throw new Error("Post button is disabled; open a draft first and verify required fields.");
  await button.click();
  await p.waitForTimeout(1500);
  return { published: true, url: p.url() };
}

export async function insights() {
  const p = await openNextdoor("/business/posts/");
  await ensureLogin(p);
  await p.waitForTimeout(1500);
  return { url: p.url(), insights: await textSnapshot(p) };
}

export async function listChats() {
  const p = await openNextdoor("/inbox/");
  await ensureLogin(p);
  await p.waitForTimeout(1200);
  return { url: p.url(), chats: await textSnapshot(p) };
}

export async function draftChat(recipient: string, message: string) {
  if (!writesAllowed()) throw new Error("Drafting is disabled. Set NEXTDOOR_ALLOW_WRITE=true and restart Claude Desktop.");
  const p = await openNextdoor("/inbox/");
  await ensureLogin(p);
  const newMessage = await firstVisible(p, ['button:has-text("New message")', '[role="button"]:has-text("New message")']);
  await newMessage.click();
  const to = await firstVisible(p, ['input[placeholder*="name" i]', 'input[aria-label*="recipient" i]']);
  await to.fill(recipient);
  await p.waitForTimeout(800);
  const match = p.locator('[role="option"], [role="listbox"] button').first();
  if (await match.count()) await match.click();
  const editor = await firstVisible(p, ['textarea', '[contenteditable="true"]']);
  await editor.fill(message);
  return { drafted: true, recipient, message, note: "Message is composed but not sent. Call send_chat to submit it." };
}

export async function sendChat() {
  if (!writesAllowed()) throw new Error("Sending is disabled. Set NEXTDOOR_ALLOW_WRITE=true in Claude Desktop configuration, then restart Claude.");
  const p = await openNextdoor("/inbox/");
  await ensureLogin(p);
  const send = await firstVisible(p, ['button:has-text("Send")', 'button[aria-label*="send" i]']);
  await send.click();
  return { sent: true };
}
