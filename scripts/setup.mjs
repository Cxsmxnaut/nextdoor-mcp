#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = process.platform === "win32"
  ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json")
  : path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");

console.log("Installing dependencies and Chromium…");
execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["install"], { cwd: root, stdio: "inherit" });
execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["playwright", "install", "chromium"], { cwd: root, stdio: "inherit" });
execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], { cwd: root, stdio: "inherit" });

fs.mkdirSync(path.dirname(config), { recursive: true });
let data = {};
if (fs.existsSync(config)) {
  try { data = JSON.parse(fs.readFileSync(config, "utf8")); }
  catch { throw new Error(`Claude config is not valid JSON: ${config}`); }
}
data.mcpServers ||= {};
const existingEnv = data.mcpServers.nextdoor?.env || {};
const migrateToHtmlFirst = existingEnv.NEXTDOOR_CONFIG_VERSION !== "2";
data.mcpServers.nextdoor = {
  command: process.execPath,
  args: [path.join(root, "dist", "index.js")],
  env: {
    NEXTDOOR_PROFILE_DIR: path.join(os.homedir(), ".nextdoor-mcp", "profile"),
    NEXTDOOR_BROWSER_CHANNEL: "chrome",
    NEXTDOOR_HEADLESS: "true",
    NEXTDOOR_RESOURCE_MODE: "html",
    NEXTDOOR_ALLOW_WRITE: "false",
    NEXTDOOR_ALLOWED_FILES: [path.join(os.homedir(), "Pictures"), path.join(os.homedir(), "Downloads")].join(","),
    NEXTDOOR_MAX_DAILY_SPEND: "0",
    NEXTDOOR_MAX_CAMPAIGN_SPEND: "0",
    NEXTDOOR_MIN_WRITE_INTERVAL_MS: "3000",
    NEXTDOOR_MONITOR_POLL_MS: "60000",
    NEXTDOOR_READ_CACHE_MS: "5000",
    NEXTDOOR_CONFIG_VERSION: "2",
    ...existingEnv
  }
};
if (migrateToHtmlFirst) {
  data.mcpServers.nextdoor.env.NEXTDOOR_HEADLESS = "true";
  data.mcpServers.nextdoor.env.NEXTDOOR_RESOURCE_MODE = "html";
  data.mcpServers.nextdoor.env.NEXTDOOR_CONFIG_VERSION = "2";
}
fs.writeFileSync(config, JSON.stringify(data, null, 2) + "\n");
console.log(`\nInstalled Nextdoor MCP in ${config}`);
console.log("Run `npm run login`, then fully quit and restart Claude Desktop.");
console.log("To enable publish/send tools, change NEXTDOOR_ALLOW_WRITE to true in that config.");
