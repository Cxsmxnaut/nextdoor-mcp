import type { Locator, Page } from "playwright";
import { openNextdoor, writesAllowed, diagnose } from "./browser.js";
import { ensureLogin, validateFiles } from "./platform.js";
import { claimApproved, markExecuted, markFailed, preview, startAutonomous } from "./approvals.js";
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
  const risk = validateAction(kind, payload);
  return preview(kind, risk, summary, payload);
}

function validateAction(kind: string, payload: Record<string, unknown>): Risk {
  const risk = risks[kind];
  if (!risk) throw new Error(`Unsupported action kind. Allowed: ${actionKinds.join(", ")}`);
  if (["launch_ad", "change_budget", "billing_change"].includes(kind)) enforceSpend(payload);
  validatePayload(kind, payload);
  return risk;
}

function requireString(payload: Record<string, unknown>, key: string) {
  if (typeof payload[key] !== "string" || !String(payload[key]).trim()) throw new Error(`${key} is required for this action.`);
}

function validatePayload(kind: string, payload: Record<string, unknown>) {
  if (kind === "create_post") requireString(payload, "body");
  else if (kind === "send_message") { requireString(payload, "recipient"); requireString(payload, "message"); }
  else if (kind === "comment") { requireString(payload, "url"); requireString(payload, "text"); }
  else if (kind === "create_listing") { requireString(payload, "title"); requireString(payload, "description"); }
  else if (["react", "rsvp", "join_group", "fave_business", "delete_content"].includes(kind)) {
    requireString(payload, "url"); requireString(payload, "controlLabel"); requireString(payload, "text");
  }
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

type UiRoot = Page | Locator;

async function visible(root: UiRoot, selectors: string[]): Promise<Locator> {
  for (const selector of selectors) {
    const item = root.locator(selector).filter({ visible: true }).first();
    if (await item.count()) return item;
  }
  throw new Error(`Current Nextdoor UI did not expose an expected control: ${selectors.join(" | ")}`);
}

async function fillAny(root: UiRoot, labels: string[], value: string) {
  for (const label of labels) {
    const byLabel = root.getByLabel(new RegExp(regexEscape(label), "i")).filter({ visible: true }).first();
    if (await byLabel.count()) { await byLabel.fill(value); return; }
    const input = root.getByPlaceholder(new RegExp(regexEscape(label), "i")).filter({ visible: true }).first();
    if (await input.count()) { await input.fill(value); return; }
  }
  throw new Error(`Could not find field: ${labels.join("/")}`);
}

async function clickNamed(root: UiRoot, labels: string[]) {
  for (const label of labels) {
    const button = root.getByRole("button", { name: new RegExp(`^${regexEscape(label)}$`, "i") }).filter({ visible: true }).first();
    if (await button.count()) { await button.click(); return; }
  }
  throw new Error(`Could not find action: ${labels.join("/")}`);
}

async function submitAndVerify(page: Page, labels: string[], root: UiRoot = page) {
  const before = await page.locator("body").innerText().catch(() => "");
  await clickNamed(root, labels);
  await page.waitForTimeout(900);
  const after = await page.locator("body").innerText().catch(() => "");
  if (before === after) throw new Error("Nextdoor did not show an observable state change after submission; action was not marked successful.");
}

async function executeKnown(action: PendingAction) {
  const p = action.payload;
  let page: Page;
  const evidence: Record<string, unknown> = {};
  switch (action.kind) {
    case "create_post": {
      page = await openNextdoor("/news_feed/"); await ensureLogin(page);
      await (await visible(page, ['button:has-text("Post")', '[role="button"]:has-text("Create a post")'])).click();
      const composer = await visible(page, ['[role="dialog"]']);
      const editor = await visible(composer, ['textarea', '[contenteditable="true"]']);
      const submittedText = String(p.body || "");
      await editor.click();
      await editor.fill("");
      await editor.type(submittedText, { delay: 1 });
      await editor.press("Tab");
      await page.waitForTimeout(500);
      const enteredText = await editor.evaluate(element => (element as HTMLTextAreaElement).value || element.textContent || "");
      if (enteredText.trim() !== submittedText.trim()) throw new Error("Nextdoor's composer did not retain the submitted text.");
      const files = Array.isArray(p.imagePaths) ? validateFiles(p.imagePaths.map(String)) : [];
      if (files.length) await composer.locator('input[type="file"]').first().setInputFiles(files);
      await submitAndVerify(page, ["Post", "Publish"], composer);
      const rejection = await page.getByText("Add something to your post before submitting", { exact: true }).count();
      if (rejection) throw new Error("Nextdoor rejected the composer as empty after text entry.");
      const shareDialog = page.getByRole("dialog").filter({ visible: true }).first();
      await shareDialog.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
      const facebookShare = shareDialog.locator('a[href*="facebook.com/dialog/share"]').first();
      const shareHref = await facebookShare.count() ? await facebookShare.getAttribute("href") : null;
      const createdPostUrl = (() => {
        try { return shareHref ? new URL(shareHref).searchParams.get("href") : null; }
        catch { return null; }
      })();
      if (createdPostUrl) {
        const created = new URL(createdPostUrl);
        if (!/(^|\.)nextdoor\.com$/.test(created.hostname)) throw new Error("Nextdoor returned an invalid created-post URL.");
        page = await openNextdoor(created.pathname + created.search);
        evidence.createdPostUrl = page.url();
        evidence.verificationMethod = "created_post_url";
      } else {
        page = await openNextdoor("/profile/");
        evidence.profileUrl = page.url();
        evidence.verificationMethod = "profile_readback";
      }
      const publishedText = page.getByText(submittedText, { exact: true }).filter({ visible: true }).first();
      await publishedText.waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
      if (!(await publishedText.count())) throw new Error("Nextdoor did not show the submitted text during post-action read-back; the action was not verified.");
      evidence.verifiedText = true;
      break;
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
      const prompt = page.getByTestId("comment-reply-prompt").filter({ visible: true }).first();
      if (await prompt.count()) {
        await prompt.click();
        await page.waitForTimeout(300);
      }
      const editor = await visible(page, [
        '[data-testid="comment-add-reply-input"]',
        'textarea[placeholder*="comment" i]',
        'textarea[placeholder*="reply" i]'
      ]);
      const submittedText = String(p.text || "");
      await editor.click();
      await editor.fill("");
      await editor.type(submittedText, { delay: 1 });
      await editor.press("Tab");
      await page.waitForTimeout(300);
      const enteredText = await editor.evaluate(element => (element as HTMLTextAreaElement).value || element.textContent || "");
      if (enteredText.trim() !== submittedText.trim()) throw new Error("Nextdoor's comment composer did not retain the submitted text.");
      const submit = page.getByTestId("inline-composer-reply-button").filter({ visible: true }).first();
      if (!(await submit.count())) throw new Error("Nextdoor did not expose the comment submit button.");
      if (await submit.getAttribute("aria-disabled") === "true") throw new Error("Nextdoor left the comment submit button disabled after text entry.");
      await submit.click();
      const publishedText = page.getByText(submittedText, { exact: true }).filter({ visible: true }).first();
      await publishedText.waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
      if (!(await publishedText.count())) throw new Error("Nextdoor did not show the submitted comment during read-back; the action was not verified.");
      evidence.verifiedText = true;
      evidence.verificationMethod = "comment_readback";
      break;
    }
    case "react": {
      page = await openNextdoor(new URL(String(p.url)).pathname + new URL(String(p.url)).search); await ensureLogin(page);
      const expectedText = typeof p.text === "string" ? p.text.trim() : "";
      let card = page.getByTestId("feed-item-card").filter({ visible: true }).first();
      if (expectedText) card = page.getByTestId("feed-item-card").filter({ hasText: expectedText, visible: true }).first();
      if (!(await card.count())) throw new Error("Nextdoor did not expose the target content card for reaction.");
      const reaction = card.getByTestId("reaction-button").filter({ visible: true }).first();
      if (!(await reaction.count())) throw new Error("Nextdoor did not expose the target reaction control.");
      const before = await reaction.getAttribute("aria-pressed");
      await reaction.click();
      await page.waitForTimeout(700);
      const after = await reaction.getAttribute("aria-pressed");
      if (before === after) throw new Error("Nextdoor did not show the reaction state changing after the click.");
      evidence.reactionActive = after === "true";
      evidence.verificationMethod = "reaction_state_readback";
      break;
    }
    case "rsvp": {
      page = await openNextdoor(new URL(String(p.url)).pathname + new URL(String(p.url)).search); await ensureLogin(page);
      const eventTitle = typeof p.text === "string" ? p.text.trim() : "";
      if (!eventTitle) throw new Error("rsvp requires text with the exact event title so the target is unambiguous.");
      const eventCard = page.getByTestId("event-attachment-container").filter({ hasText: eventTitle, visible: true }).first();
      await eventCard.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
      if (!(await eventCard.count())) throw new Error("Nextdoor did not expose the requested event card.");
      const rsvp = eventCard.getByTestId("event-primary-cta").filter({ visible: true }).first();
      if (!(await rsvp.count())) throw new Error("Nextdoor did not expose the requested event RSVP control.");
      const beforeText = (await rsvp.innerText()).trim();
      const beforePressed = await rsvp.getAttribute("aria-pressed");
      const beforeActive = beforePressed === "true" || !/Interested\?/i.test(beforeText);
      await rsvp.click();
      if (beforeActive) {
        const rsvpMenu = page.getByRole("menu").filter({ hasText: "Not interested", visible: true }).first();
        await rsvpMenu.waitFor({ state: "visible", timeout: 3_000 }).catch(() => undefined);
        const notInterested = rsvpMenu.getByText("Not interested", { exact: true }).filter({ visible: true }).first();
        if (!(await notInterested.count())) throw new Error("Nextdoor did not expose the Not interested cleanup option.");
        await notInterested.click();
      }
      await page.waitForTimeout(700);
      const afterText = (await rsvp.innerText()).trim();
      const afterPressed = await rsvp.getAttribute("aria-pressed");
      if (beforeText === afterText && beforePressed === afterPressed) throw new Error("Nextdoor did not show the RSVP state changing.");
      evidence.rsvpLabel = afterText;
      evidence.rsvpActive = afterPressed === "true" || !/Interested\?/i.test(afterText);
      evidence.verificationMethod = "rsvp_state_readback";
      break;
    }
    case "join_group": {
      page = await openNextdoor(new URL(String(p.url)).pathname + new URL(String(p.url)).search); await ensureLogin(page);
      const groupName = typeof p.text === "string" ? p.text.trim() : "";
      if (!groupName) throw new Error("join_group requires text with the exact group name so the target is unambiguous.");
      const name = page.getByText(groupName, { exact: true }).filter({ visible: true }).first();
      await name.waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
      if (!(await name.count())) throw new Error("Nextdoor did not show the requested group name at the target URL.");
      const join = page.getByTestId("groups-join-button").filter({ visible: true }).first();
      if (await join.count()) {
        await join.click();
        await page.waitForTimeout(900);
        const remainingJoin = page.getByTestId("groups-join-button").filter({ visible: true });
        if (await remainingJoin.count() && (await remainingJoin.first().innerText()).trim() === "Join") {
          throw new Error("Nextdoor did not show group membership changing after Join.");
        }
        evidence.groupJoined = true;
      } else {
        const tools = page.getByTestId("group-header-admin-tools-caret").filter({ visible: true }).first();
        if (!(await tools.count())) throw new Error("Nextdoor did not expose member tools needed to leave the group.");
        await tools.click();
        const leave = page.getByRole("menuitem", { name: /Leave group/i }).filter({ visible: true }).first();
        await leave.waitFor({ state: "visible", timeout: 3_000 }).catch(() => undefined);
        if (!(await leave.count())) throw new Error("Nextdoor did not expose Leave group for the current membership.");
        await leave.click();
        const confirm = page.getByRole("dialog").filter({ hasText: "Leave group", visible: true }).first();
        await confirm.waitFor({ state: "visible", timeout: 2_000 }).catch(() => undefined);
        if (await confirm.count()) await clickNamed(confirm, ["Leave group", "Leave"]);
        await page.waitForTimeout(900);
        const restoredJoin = page.getByTestId("groups-join-button").filter({ visible: true }).first();
        await restoredJoin.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
        if (!(await restoredJoin.count())) throw new Error("Nextdoor did not restore the Join control after leaving the group.");
        evidence.groupJoined = false;
      }
      evidence.verificationMethod = "group_membership_state_readback";
      break;
    }
    case "fave_business": {
      page = await openNextdoor(new URL(String(p.url)).pathname + new URL(String(p.url)).search); await ensureLogin(page);
      if (await page.locator('[data-part="overlay"]').filter({ visible: true }).count()) {
        await page.reload({ waitUntil: "commit", timeout: 20_000 });
        await page.locator("body").waitFor({ state: "attached", timeout: 8_000 });
      }
      const businessName = typeof p.text === "string" ? p.text.trim() : "";
      if (!businessName) throw new Error("fave_business requires text with the exact business name so the target is unambiguous.");
      let name = page.getByText(businessName, { exact: true }).filter({ visible: true }).first();
      await name.waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
      if (!(await name.count())) {
        const myFaves = page.getByRole("button", { name: "My Faves", exact: true }).filter({ visible: true }).first();
        if (await myFaves.count()) {
          await myFaves.click();
          name = page.getByText(businessName, { exact: true }).filter({ visible: true }).first();
          await name.waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
        }
      }
      if (!(await name.count())) throw new Error("Nextdoor did not expose the requested business on Local Faves.");
      const initialDirectBusinessPage = new URL(page.url()).pathname.startsWith("/page/");
      let businessRoot: UiRoot = page;
      if (!initialDirectBusinessPage) {
        const card = name.locator('xpath=ancestor::*[@role="link"]').first();
        if (await card.count()) businessRoot = card;
        else {
        const businessLink = name.locator('xpath=ancestor::a[starts-with(@href, "/page/")]').first();
        const href = await businessLink.getAttribute("href");
        if (!href) throw new Error("Nextdoor did not expose the requested business card or page URL.");
        page = await openNextdoor(href);
        name = page.getByText(businessName, { exact: true }).filter({ visible: true }).first();
        await name.waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
        businessRoot = page;
        }
      }
      const directBusinessPage = new URL(page.url()).pathname.startsWith("/page/");
      const fave = businessRoot.getByRole("button", { name: /^Fave(?:d)?$/i }).filter({ visible: true }).first();
      if (!(await fave.count())) throw new Error("Nextdoor did not expose the Fave control for the requested business.");
      const beforeText = (await fave.innerText()).trim();
      await fave.click();
      if (/^Faved$/i.test(beforeText)) {
        const menu = page.getByRole("menu").filter({ hasText: "Remove Fave", visible: true }).first();
        await menu.waitFor({ state: "visible", timeout: 3_000 }).catch(() => undefined);
        const remove = menu.getByText("Remove Fave", { exact: true }).filter({ visible: true }).first();
        if (!(await remove.count())) throw new Error("Nextdoor did not expose the Remove Fave cleanup option.");
        await remove.click();
      }
      const expectedLabel = /^Faved$/i.test(beforeText) ? "Fave" : "Faved";
      const updatedName = page.getByText(businessName, { exact: true }).filter({ visible: true }).first();
      const updatedRoot: UiRoot = directBusinessPage ? page : updatedName.locator('xpath=ancestor::*[@role="link"]').first();
      const updated = updatedRoot.getByRole("button", { name: new RegExp(`^${expectedLabel}$`, "i") }).filter({ visible: true }).first();
      await updated.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
      const afterText = await updated.count() ? (await updated.innerText()).trim() : "";
      if (beforeText === afterText) throw new Error("Nextdoor did not show the business Fave state changing.");
      evidence.businessFaved = /^Faved$/i.test(afterText);
      evidence.faveLabel = afterText;
      evidence.verificationMethod = "business_fave_state_readback";
      await page.keyboard.press("Escape").catch(() => undefined);
      break;
    }
    case "change_settings": {
      page = await openNextdoor(new URL(String(p.url)).pathname + new URL(String(p.url)).search); await ensureLogin(page);
      const label = String(p.controlLabel || "");
      const target = page.getByRole("button", { name: new RegExp(`^${regexEscape(label)}$`, "i") }).filter({ visible: true }).first();
      if (!(await target.count())) throw new Error(`Nextdoor did not expose the requested setting control: ${label}`);
      const beforeSelected = Boolean(await target.locator('[data-icon="checkmark"]').count());
      const beforePressed = await target.getAttribute("aria-pressed");
      const beforeChecked = await target.getAttribute("aria-checked");
      await target.click();
      await page.waitForTimeout(700);
      const afterSelected = Boolean(await target.locator('[data-icon="checkmark"]').count());
      const afterPressed = await target.getAttribute("aria-pressed");
      const afterChecked = await target.getAttribute("aria-checked");
      const changed = beforeSelected !== afterSelected || beforePressed !== afterPressed || beforeChecked !== afterChecked;
      if (!changed && !afterSelected) throw new Error("Nextdoor did not show the requested setting becoming selected.");
      evidence.settingSelected = afterSelected || afterPressed === "true" || afterChecked === "true";
      evidence.verificationMethod = "setting_state_readback";
      break;
    }
    case "delete_content": {
      page = await openNextdoor(new URL(String(p.url)).pathname + new URL(String(p.url)).search); await ensureLogin(page);
      const expectedText = typeof p.text === "string" ? p.text.trim() : "";
      const deletionPath = new URL(String(p.url)).pathname;
      const isListing = deletionPath.startsWith("/for_sale_and_free/");
      const isGroup = deletionPath.startsWith("/g/");
      if (isGroup) {
        if (expectedText) {
          const groupName = page.getByText(expectedText, { exact: true }).filter({ visible: true }).first();
          await groupName.waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
          if (!(await groupName.count())) throw new Error("Nextdoor did not show the expected group name at the deletion URL.");
        }
        await page.keyboard.press("Escape").catch(() => undefined);
        const tools = page.getByTestId("group-header-admin-tools-caret").filter({ visible: true }).first();
        if (!(await tools.count())) throw new Error("Nextdoor did not expose owner tools for this group.");
        await tools.click();
        const deleteGroup = page.getByRole("menuitem", { name: /Delete group/i }).filter({ visible: true }).first();
        await deleteGroup.waitFor({ state: "visible", timeout: 3_000 }).catch(() => undefined);
        if (!(await deleteGroup.count())) throw new Error("Nextdoor did not offer group deletion for the signed-in owner.");
        await deleteGroup.click();
        const dialog = page.getByRole("dialog").filter({ hasText: "Are you sure you want to delete this group?", visible: true }).first();
        await dialog.waitFor({ state: "visible", timeout: 3_000 }).catch(() => undefined);
        if (!(await dialog.count())) throw new Error("Nextdoor did not show the group deletion confirmation dialog.");
        const checkbox = dialog.getByRole("checkbox").filter({ visible: true }).first();
        if (!(await checkbox.count())) throw new Error("Nextdoor did not expose the required group deletion checkbox.");
        await checkbox.click();
        await clickNamed(dialog, ["Delete group"]);
        await page.waitForTimeout(1_200);
        page = await openNextdoor(deletionPath);
        if (expectedText) {
          const remaining = page.getByText(expectedText, { exact: true }).filter({ visible: true }).first();
          await remaining.waitFor({ state: "hidden", timeout: 8_000 }).catch(() => undefined);
          if (await remaining.isVisible().catch(() => false)) throw new Error("The deleted group name is still visible at its direct URL during read-back.");
        }
        evidence.deleted = true;
        evidence.verificationMethod = "group_url_absence_readback";
        break;
      }
      let menu: Locator;
      if (isListing) {
        if (expectedText) {
          const title = page.getByText(expectedText, { exact: true }).filter({ visible: true }).first();
          await title.waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
          if (!(await title.count())) throw new Error("Nextdoor did not show the expected listing title at the deletion URL.");
        }
        menu = page.getByTestId("feed_item_menu_button").filter({ visible: true }).first();
      } else {
        let card = page.getByTestId("feed-item-card").filter({ visible: true }).first();
        if (expectedText) card = page.getByTestId("feed-item-card").filter({ hasText: expectedText, visible: true }).first();
        if (!(await card.count())) throw new Error("Nextdoor did not expose the target content card for deletion.");
        menu = card.getByTestId("feed_item_menu_button").filter({ visible: true }).first();
      }
      if (!(await menu.count())) throw new Error("Nextdoor did not expose the target content menu.");
      const options = page.getByRole("menu", { name: /Options/i }).filter({ visible: true }).first();
      if (!(await options.count())) await menu.click();
      await options.waitFor({ state: "visible", timeout: 3_000 }).catch(() => undefined);
      if (!(await options.count())) throw new Error("Nextdoor did not open the target content menu.");
      const deleteItem = options.getByRole("menuitem", { name: /Delete/i }).first();
      await deleteItem.waitFor({ state: "visible", timeout: 3_000 }).catch(() => undefined);
      if (!(await deleteItem.count())) throw new Error("Nextdoor did not offer deletion for this content. Confirm it belongs to the signed-in account.");
      await deleteItem.click();
      const dialog = isListing
        ? page.getByRole("alertdialog").filter({ hasText: "Delete listing", visible: true }).first()
        : page.getByRole("dialog", { name: /Delete post/i }).filter({ visible: true }).first();
      await dialog.waitFor({ state: "visible", timeout: 3_000 }).catch(() => undefined);
      if (!(await dialog.count())) throw new Error("Nextdoor did not show the delete confirmation dialog.");
      await clickNamed(dialog, isListing ? ["Delete listing"] : ["Delete"]);
      await page.waitForTimeout(1_200);
      if (expectedText) {
        page = await openNextdoor(isListing ? "/for_sale_and_free/your_items/" : "/profile/");
        await page.waitForTimeout(isListing ? 2_000 : 300);
        const remaining = page.getByText(expectedText, { exact: true }).filter({ visible: true }).first();
        await remaining.waitFor({ state: "visible", timeout: 3_000 }).catch(() => undefined);
        if (await remaining.count()) throw new Error(`The deleted content is still visible in ${isListing ? "My listings" : "the signed-in profile"} during read-back.`);
      }
      evidence.deleted = true;
      evidence.verificationMethod = expectedText ? (isListing ? "my_listings_absence_readback" : "profile_absence_readback") : "delete_dialog_completion";
      break;
    }
    case "create_listing": {
      page = await openNextdoor("/for_sale_and_free/"); await ensureLogin(page);
      const directCreate = page.getByRole("button", { name: /^(Sell|Post a listing|Create listing)$/i }).first();
      if (await directCreate.count()) await directCreate.click(); else await clickNamed(page, ["Post"]);
      await page.waitForTimeout(300);
      const files = Array.isArray(p.imagePaths) ? validateFiles(p.imagePaths.map(String)) : [];
      if (!files.length) throw new Error("A local imagePath is required for verified listing creation on the current Nextdoor composer.");
      const uploader = page.getByTestId("uploader-fileinput").filter({ visible: true }).first();
      if (!(await uploader.count())) throw new Error("Nextdoor did not expose the listing photo uploader.");
      await uploader.setInputFiles(files);
      await page.waitForTimeout(800);
      const stageButton = page.getByTestId("composer-submit-button").filter({ visible: true }).first();
      if (!(await stageButton.count())) throw new Error("Nextdoor did not expose the listing composer progress control.");
      await stageButton.click();
      const title = page.getByTestId("composer-finds-title").filter({ visible: true }).first();
      await title.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
      if (!(await title.count())) throw new Error("Nextdoor did not advance to listing details after photo upload.");
      const description = await visible(page, ['textarea[placeholder="Describe your item"]']);
      for (const [field, value] of [[title, String(p.title || "")], [description, String(p.description || "")]] as const) {
        await field.click(); await field.fill(""); await field.type(value, { delay: 1 }); await field.press("Tab");
      }
      if (p.price !== undefined) {
        const price = page.getByTestId("fsf-price-field").filter({ visible: true }).first();
        if (!(await price.count())) throw new Error("Nextdoor did not expose the listing price field.");
        await price.click(); await price.fill(""); await price.type(String(p.price), { delay: 1 }); await price.press("Tab");
      }
      const category = page.getByLabel("Category", { exact: true }).filter({ visible: true }).first();
      if (!(await category.count())) throw new Error("Nextdoor did not expose the listing category field.");
      const requestedCategory = String(p.category || "Other");
      await category.click();
      const categoryItem = page.getByRole("menuitem", { name: new RegExp(`^${regexEscape(requestedCategory)}$`, "i") }).filter({ visible: true }).first();
      await categoryItem.waitFor({ state: "visible", timeout: 3_000 }).catch(() => undefined);
      if (!(await categoryItem.count())) throw new Error(`Nextdoor did not offer listing category: ${requestedCategory}`);
      await categoryItem.click();
      await page.waitForTimeout(300);
      await stageButton.click();
      const finalDialog = page.getByRole("dialog").filter({ hasText: String(p.title || ""), visible: true }).first();
      await finalDialog.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
      if (!(await finalDialog.count())) throw new Error("Nextdoor did not advance to the final listing preview.");
      await clickNamed(finalDialog, ["Post", "Publish", "List"]);
      await page.waitForTimeout(1_000);
      page = await openNextdoor("/for_sale_and_free/your_items/");
      const publishedTitle = page.getByText(String(p.title || ""), { exact: true }).filter({ visible: true }).first();
      await publishedTitle.waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
      if (!(await publishedTitle.count())) throw new Error("Nextdoor did not show the listing title in My listings during read-back.");
      const listingLink = publishedTitle.locator('xpath=ancestor::a[starts-with(@href, "/for_sale_and_free/")]').first();
      const listingHref = await listingLink.getAttribute("href");
      if (!listingHref) throw new Error("Nextdoor did not expose a direct URL for the verified listing.");
      page = await openNextdoor(listingHref);
      const directTitle = page.getByText(String(p.title || ""), { exact: true }).filter({ visible: true }).first();
      await directTitle.waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
      if (!(await directTitle.count())) throw new Error("The direct listing URL did not contain the submitted title.");
      evidence.createdListingUrl = page.url();
      evidence.verifiedTitle = true;
      evidence.verificationMethod = "my_listings_and_direct_url_readback";
      break;
    }
    case "create_event": {
      page = await openNextdoor("/local_events/"); await ensureLogin(page);
      const fields = (p.fields || {}) as Record<string, unknown>;
      const eventTitle = String(p.title || fields["Event name"] || fields.Title || "").trim();
      const eventLocation = String(p.location || fields.Location || "").trim();
      const eventDescription = String(p.description || fields.Description || "").trim();
      if (!eventTitle || !eventLocation) throw new Error("create_event requires title and location (directly or in fields).");
      const create = page.getByTestId("create-event-button").filter({ visible: true }).first();
      if (!(await create.count())) throw new Error("Nextdoor did not expose Create event for this account.");
      await create.click();
      const title = page.getByTestId("composer-event-title").filter({ visible: true }).first();
      await title.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
      if (!(await title.count())) throw new Error("Nextdoor did not open the event composer.");
      await title.click(); await title.fill(""); await title.type(eventTitle, { delay: 1 }); await title.press("Tab");
      if (p.startDate) {
        const startDate = page.getByTestId("event-form-start-time").filter({ visible: true }).first();
        await startDate.fill(String(p.startDate)); await startDate.press("Tab");
      }
      if (p.startTime) {
        const startTime = page.getByLabel("Time", { exact: true }).filter({ visible: true }).first();
        await startTime.fill(String(p.startTime)); await startTime.press("Tab");
      }
      const location = page.getByTestId("composer-event-location").filter({ visible: true }).first();
      await location.click(); await location.fill(""); await location.type(eventLocation, { delay: 1 });
      const locationDialog = page.getByRole("dialog").filter({ hasText: "Use this location", visible: true }).first();
      await locationDialog.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
      if (!(await locationDialog.count())) throw new Error("Nextdoor did not resolve the requested event location.");
      const useLocation = locationDialog.getByRole("button", { name: /^Use this location/i }).first();
      if (!(await useLocation.count())) throw new Error("Nextdoor did not expose confirmation for the event location.");
      await useLocation.click();
      await page.waitForTimeout(500);
      if (eventDescription) {
        const description = page.getByTestId("composer-text-field").filter({ visible: true }).first();
        await description.click(); await description.fill(""); await description.type(eventDescription, { delay: 1 }); await description.press("Tab");
      }
      const stageButton = page.getByTestId("composer-submit-button").filter({ visible: true }).first();
      await stageButton.click();
      const finalDialog = page.getByRole("dialog").filter({ hasText: eventTitle, visible: true }).first();
      await finalDialog.waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
      if (!(await finalDialog.count())) throw new Error("Nextdoor did not advance to the final event preview.");
      await clickNamed(finalDialog, ["Post", "Publish"]);
      await page.waitForURL(url => url.pathname.startsWith("/p/"), { timeout: 8_000 }).catch(() => undefined);
      const createdEventUrl = new URL(page.url()).pathname.startsWith("/p/") ? page.url() : undefined;
      if (createdEventUrl) {
        const createdTitle = page.getByText(eventTitle, { exact: true }).filter({ visible: true }).first();
        await createdTitle.waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
        if (!(await createdTitle.count())) throw new Error("The created event URL did not show the submitted title.");
      }
      page = await openNextdoor("/local_events/");
      const myEvents = page.getByTestId("my-events-chip").filter({ visible: true }).first();
      if (!(await myEvents.count())) throw new Error("Nextdoor did not expose My events for verification.");
      await myEvents.click();
      const publishedTitle = page.getByText(eventTitle, { exact: true }).filter({ visible: true }).first();
      await publishedTitle.waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
      if (!(await publishedTitle.count())) throw new Error("Nextdoor did not show the event in My events during read-back.");
      evidence.createdEventUrl = createdEventUrl || page.url();
      evidence.verifiedTitle = true;
      evidence.verificationMethod = createdEventUrl ? "created_event_url_and_my_events_readback" : "my_events_readback";
      break;
    }
    case "create_group": {
      page = await openNextdoor("/groups/"); await ensureLogin(page);
      const fields = (p.fields || {}) as Record<string, unknown>;
      const groupName = String(p.name || p.title || fields["Group name"] || fields.Name || "").trim();
      const groupDescription = String(p.description || fields.Description || "").trim();
      if (!groupName || !groupDescription) throw new Error("create_group requires name and description (directly or in fields).");
      const create = page.getByRole("button", { name: "Create", exact: true }).filter({ visible: true }).first();
      if (!(await create.count())) throw new Error("Nextdoor did not expose group creation for this account.");
      await create.click();
      const dialog = page.getByRole("dialog").filter({ hasText: "New group", visible: true }).first();
      await dialog.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
      if (!(await dialog.count())) throw new Error("Nextdoor did not open the group composer.");
      const name = dialog.getByPlaceholder(/Bay area book club/i).filter({ visible: true }).first();
      const description = dialog.getByLabel("DESCRIPTION", { exact: true }).filter({ visible: true }).first();
      for (const [field, value] of [[name, groupName], [description, groupDescription]] as const) {
        await field.click(); await field.fill(""); await field.type(value, { delay: 1 }); await field.press("Tab");
      }
      const privacy = String(p.privacy || "PRIVATE").toUpperCase();
      const privacyInput = dialog.locator(`input[type="radio"][name="privacy"][value="${privacy}"]`).first();
      if (!(await privacyInput.count())) throw new Error(`Nextdoor did not offer group privacy setting: ${privacy}`);
      const privacyLabel = dialog.getByText(privacy === "PRIVATE" ? "Private" : "Public", { exact: true }).filter({ visible: true }).first();
      await privacyLabel.click();
      if (!(await privacyInput.isChecked())) throw new Error(`Nextdoor did not retain group privacy setting: ${privacy}`);
      const scope = String(p.locationScope || "HOOD").toUpperCase();
      const locationOption = dialog.locator(`[role="radio"][value="groupCreateLocationOption_${scope}"]`).filter({ visible: true }).first();
      if (!(await locationOption.count())) throw new Error(`Nextdoor did not offer group location scope: ${scope}`);
      await locationOption.click();
      await clickNamed(dialog, ["Create group"]);
      await page.waitForURL(url => url.pathname.startsWith("/g/"), { timeout: 10_000 }).catch(() => undefined);
      if (!new URL(page.url()).pathname.startsWith("/g/")) throw new Error("Nextdoor did not navigate to the created group.");
      const publishedName = page.getByText(groupName, { exact: true }).filter({ visible: true }).first();
      await publishedName.waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
      if (!(await publishedName.count())) throw new Error("The created group page did not show the submitted group name.");
      evidence.createdGroupUrl = page.url();
      evidence.verifiedName = true;
      evidence.verificationMethod = "created_group_url_readback";
      break;
    }
    default: {
      const fallback: Record<string, string> = {};
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
  return { executed: true, actionId: action.id, kind: action.kind, url: page.url(), health, ...evidence };
}

export async function executeAction(actionId: string, approvalToken: string, typedConfirmation?: string) {
  if (!writesAllowed()) throw new Error("Writes are disabled. Set NEXTDOOR_ALLOW_WRITE=true and restart Claude Desktop.");
  const action = claimApproved(actionId, approvalToken, typedConfirmation);
  try {
    validateAction(action.kind, action.payload);
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

export async function performAction(kind: string, summary: string, payload: Record<string, unknown>) {
  if (!writesAllowed()) throw new Error("Writes are disabled. Set NEXTDOOR_ALLOW_WRITE=true and restart Claude Desktop.");
  const risk = validateAction(kind, payload);
  const action = startAutonomous(kind, risk, summary, payload);
  try {
    await paceWrite();
    const result = await executeKnown(action);
    markExecuted(action, result);
    return { ...result, mode: "autonomous" };
  } catch (error) {
    markFailed(action);
    audit({ event: "action_failed", actionId: action.id, kind, mode: "autonomous", error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
