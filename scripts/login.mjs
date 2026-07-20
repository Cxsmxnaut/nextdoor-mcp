#!/usr/bin/env node
import { chromium } from "playwright";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import readline from "node:readline/promises";

const dir = process.env.NEXTDOOR_PROFILE_DIR || path.join(os.homedir(), ".nextdoor-mcp", "profile");
fs.mkdirSync(dir, { recursive: true });
const configured = process.env.NEXTDOOR_BROWSER_CHANNEL;
const options = {
  ...(configured === "chromium" ? {} : { channel: configured || "chrome" }),
  headless: false,
  viewport: { width: 1365, height: 900 }
};
let browser;
try {
  browser = await chromium.launchPersistentContext(dir, options);
} catch (error) {
  if (configured === "chromium") throw error;
  console.warn("Google Chrome was unavailable; falling back to bundled Chromium.");
  const { channel: _channel, ...fallback } = options;
  browser = await chromium.launchPersistentContext(dir, fallback);
}
const page = browser.pages()[0] || await browser.newPage();
await page.goto("https://nextdoor.com/login/", { waitUntil: "domcontentloaded" });
console.log("Sign in to Nextdoor in the browser. Complete any verification normally.");
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await rl.question("When your Nextdoor feed is visible, press Enter here to save and close… ");
rl.close();
await browser.close();
console.log("Login profile saved.");
