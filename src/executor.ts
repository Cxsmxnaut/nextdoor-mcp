import type { Locator, Page } from "playwright";
import { openNextdoor, writesAllowed, diagnose } from "./browser.js";
import { ensureLogin, validateFiles } from "./platform.js";
import { claimApproved, markExecuted, markFailed, preview } from "./approvals.js";
import type { PendingAction, Risk } from "./types.js";
import { audit } from "./store.js";
import { paceWrite } from "./rate.js";

const risks: Record<string, Risk> = {
  create_post: "preview", send_message: "preview", comment: "preview", create_listing: "preview",
  create_event: "preview", create_group: "preview", invite: "preview", recommendation: "preview",
  react: "preview", rsvp: "preview", join_group: "preview", fave_business: "preview",
  edit_profile: "explicit", change_settings: "explicit", block_user: "explicit", report_content: "explicit",
  moderate_content: "explicit", launch_ad: "explicit", change_budget: "explicit", billing_change: "explicit",
  delete_content: "explicit", delete_account: "typed", deactivate_account: "typed"
};

export const actionKinds = Object.keys(risks);

export function previewAction(kind: string, summary: string, payload: Record<string, unknown>): PendingAction {
  const risk = risks[kind];
  if (!risk) throw new Error(`Unsupported action kind. Allowed: ${actionKinds.join(", ")}`);
  if (["launch_ad", "change_budget", "billing_change"].includes(kind)) enforceSpend(payload);
  validatePayload(kind, payload);
  return preview(kind, risk, summary, payload);
}

function requireString(payload: Record<string, unknown>, key: string) {
  if (typeof payload[key] !== "string" || !String(payload[key]).trim()) throw new Error(`${key} is required for this action.`);
}

function validatePayload(kind: string, payload: Record<string, unknown>) {
  if (kind === "create_post") requireString(payload, "body");
  else if (kind === "send_message") { requireString(payload, "recipient"); requireString(payload, "message"); }
  else if (kind === "comment") { requireString(payload, "url"); requireString(payload, "text"); }
  else if (kind === "create_listing") { requireString(payload, "title"); requireString(payload, "description"); }
  else {
    if (!["create_event", "create_group"].includes(kind)) requireString(payload, "url");
    requireString(payload, "controlLabel");
    if (payload.fields !== undefined && (!payload.fields || typeof payload.fields !== "object" || Array.isArray(payload.fields))) throw new Error("fields must be an object of visible field labels to values.");
  }
  if (payload.url !== undefined) {
    const url = new URL(String(payload.url), "https://nextdoor.com");
    if (!/(^|\.)nextdoor\.com$/.test(url.hostname)) throw new Error("Action URLs are restricted to nextdoor.com.");
  }
}

const regexEscape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function enforceSpend(payload: Record<string, unknown>) {
  const amount = Number(payload.amount ?? payload.budget ?? 0);
  const daily = Number(process.env.NEXTDOOR_MAX_DAILY_SPEND || 0);
  const campaign = Number(process.env.NEXTDOOR_MAX_CAMPAIGN_SPEND || 0);
  if (!daily || !campaign) throw new Error("Ad spending is locked until NEXTDOOR_MAX_DAILY_SPEND and NEXTDOOR_MAX_CAMPAIGN_SPEND are configured.");
  if (!Number.isFinite(amount) || amount <= 0 || amount > daily || amount > campaign) throw new Error(`Requested spend ${amount} exceeds configured limits.`);
}

async function visible(page: Page, selectors: string[]): Promise<Locator> {
  for (const selector of selectors) {
    const item = page.locator(selector).filter({ visible: true }).first();
    if (await item.count()) return item;
  }
  throw new Error(`Current Nextdoor UI did not expose an expected control: ${selectors.join(" | ")}`);
}

async function fillAny(page: Page, labels: string[], value: string) {
  for (const label of labels) {
    const byLabel = page.getByLabel(new RegExp(regexEscape(label), "i")).first();
    if (await byLabel.count()) { await byLabel.fill(value); return; }
    const input = page.getByPlaceholder(new RegExp(regexEscape(label), "i")).first();
    if (await input.count()) { await input.fill(value); return; }
  }
  throw new Error(`Could not find field: ${labels.join("/")}`);
}

async function clickNamed(page: Page, labels: string[]) {
  for (const label of labels) {
    const button = page.getByRole("button", { name: new RegExp(`^${regexEscape(label)}$`, "i") }).first();
    if (await button.count()) { await button.click(); return; }
  }
  throw new Error(`Could not find action: ${labels.join("/")}`);
}

async function submitAndVerify(page: Page, labels: string[]) {
  const before = await page.locator("body").innerText().catch(() => "");
  await clickNamed(page, labels);
  await page.waitForTimeout(900);
  const after = await page.locator("body").innerText().catch(() => "");
  if (before === after) throw new Error("Nextdoor did not show an observable state change after submission; action was not marked successful.");
}

async function executeKnown(action: PendingAction) {
  const p = action.payload;
  let page: Page;
  switch (action.kind) {
    case "create_post": {
      page = await openNextdoor("/news_feed/"); await ensureLogin(page);
      await (await visible(page, ['button:has-text("Post")', '[role="button"]:has-text("Create a post")'])).click();
      const editor = await visible(page, ['textarea', '[contenteditable="true"]']);
      await editor.fill(String(p.body || ""));
      const files = Array.isArray(p.imagePaths) ? validateFiles(p.imagePaths.map(String)) : [];
      if (files.length) await page.locator('input[type="file"]').first().setInputFiles(files);
      await submitAndVerify(page, ["Post", "Publish"]); break;
    }
    case "send_message": {
      page = await openNextdoor("/inbox/"); await ensureLogin(page);
      await clickNamed(page, ["New message"]);
      await fillAny(page, ["recipient", "name"], String(p.recipient || ""));
      await page.waitForTimeout(500);
      const option = page.locator('[role="option"], [role="listbox"] button').first();
      if (await option.count()) await option.click();
      const editor = await visible(page, ['textarea', '[contenteditable="true"]']);
      await editor.fill(String(p.message || ""));
      await submitAndVerify(page, ["Send"]); break;
    }
    case "comment": {
      page = await openNextdoor(new URL(String(p.url)).pathname + new URL(String(p.url)).search); await ensureLogin(page);
      const editor = await visible(page, ['textarea[placeholder*="comment" i]', 'textarea[placeholder*="reply" i]', '[contenteditable="true"]']);
      await editor.fill(String(p.text || "")); await submitAndVerify(page, ["Comment", "Reply", "Post"]); break;
    }
    case "create_listing": {
      page = await openNextdoor("/for_sale_and_free/"); await ensureLogin(page);
      const directCreate = page.getByRole("button", { name: /^(Sell|Post a listing|Create listing)$/i }).first();
      if (await directCreate.count()) await directCreate.click(); else await clickNamed(page, ["Post"]);
      await page.waitForTimeout(300);
      const files = Array.isArray(p.imagePaths) ? validateFiles(p.imagePaths.map(String)) : [];
      if (/Add photos/i.test(await page.locator("body").innerText().catch(() => ""))) {
        if (files.length && await page.locator('input[type="file"]').count()) {
          await page.locator('input[type="file"]').first().setInputFiles(files);
          await clickNamed(page, ["Next", "Continue"]);
        } else await clickNamed(page, ["Skip"]);
        await page.waitForTimeout(300);
      }
      await fillAny(page, ["title"], String(p.title || ""));
      await fillAny(page, ["description"], String(p.description || ""));
      if (p.price !== undefined) await fillAny(page, ["price"], String(p.price));
      await submitAndVerify(page, ["Post", "Publish", "List"]); break;
    }
    default: {
      const fallback: Record<string, string> = { create_event: "/local_events/", create_group: "/groups/" };
      const rawUrl = String(p.url || fallback[action.kind] || "");
      if (!rawUrl) throw new Error(`${action.kind} requires a Nextdoor URL and semantic controlLabel in its payload.`);
      const url = new URL(rawUrl, "https://nextdoor.com");
      if (!/(^|\.)nextdoor\.com$/.test(url.hostname)) throw new Error("Actions are restricted to nextdoor.com.");
      page = await openNextdoor(url.pathname + url.search); await ensureLogin(page);
      const fields = (p.fields || {}) as Record<string, unknown>;
      for (const [label, value] of Object.entries(fields)) await fillAny(page, [label], String(value));
      const files = Array.isArray(p.imagePaths) ? validateFiles(p.imagePaths.map(String)) : [];
      if (files.length) await page.locator('input[type="file"]').first().setInputFiles(files);
      const label = String(p.controlLabel || "");
      if (!label) throw new Error(`${action.kind} requires controlLabel.`);
      await submitAndVerify(page, [label]);
    }
  }
  await page.waitForTimeout(900);
  const health = await diagnose(page);
  if (health.notFound || health.permissionDenied) throw new Error(`Nextdoor did not verify the action: ${JSON.stringify(health)}`);
  return { executed: true, actionId: action.id, kind: action.kind, url: page.url(), health };
}

export async function executeAction(actionId: string, approvalToken: string, typedConfirmation?: string) {
  if (!writesAllowed()) throw new Error("Writes are disabled. Set NEXTDOOR_ALLOW_WRITE=true and restart Claude Desktop.");
  const action = claimApproved(actionId, approvalToken, typedConfirmation);
  try {
    await paceWrite();
    const result = await executeKnown(action);
    markExecuted(action, result);
    return result;
  } catch (error) {
    markFailed(action);
    audit({ event: "action_failed", actionId, kind: action.kind, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
