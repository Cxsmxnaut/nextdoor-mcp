#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  env: {
    ...process.env,
    NEXTDOOR_ALLOW_WRITE: "true",
    NEXTDOOR_HEADLESS: "true",
    NEXTDOOR_RESOURCE_MODE: "lean"
  }
});
const client = new Client({ name: "nextdoor-comprehensive-live-test", version: "1.0.0" });
const results = [];

function compact(result) {
  const data = result.structuredContent || {};
  return {
    isError: Boolean(result.isError),
    url: data.url,
    surface: data.surface,
    loggedIn: data.loggedIn,
    writesEnabled: data.writesEnabled,
    entityCount: Array.isArray(data.entities) ? data.entities.length : undefined,
    capabilityCount: data.capabilities && typeof data.capabilities === "object" ? Object.keys(data.capabilities).length : undefined,
    monitorCount: Array.isArray(data.monitors) ? data.monitors.length : undefined,
    eventCount: Array.isArray(data.events) ? data.events.length : undefined,
    error: result.isError ? result.content?.map(item => item.text || "").join("\n").slice(0, 1000) : undefined
  };
}

async function check(name, arguments_ = {}) {
  const startedAt = Date.now();
  let entry;
  try {
    const result = await client.callTool({ name, arguments: arguments_ });
    entry = { name, arguments: arguments_, durationMs: Date.now() - startedAt, ...compact(result) };
    if (name === "inspect_nextdoor_url") {
      const entities = result.structuredContent?.entities || [];
      entry.testPostFound = entities.some(entity => `${entity.title || ""}\n${entity.text || ""}`.includes("Testing my Nextdoor MCP integration. Please ignore this post."));
    }
    entry.data = result.structuredContent;
  } catch (error) {
    entry = { name, arguments: arguments_, durationMs: Date.now() - startedAt, isError: true, error: error instanceof Error ? error.message : String(error) };
  }
  results.push(entry);
  console.log(`${entry.isError ? "FAIL" : "PASS"} ${name} ${entry.durationMs}ms${entry.error ? ` — ${entry.error.split("\n")[0]}` : ""}`);
  return entry;
}

await client.connect(transport);
try {
  const tools = await client.listTools();
  results.push({ name: "tools/list", isError: false, toolCount: tools.tools.length, toolNames: tools.tools.map(tool => tool.name) });
  console.log(`PASS tools/list — ${tools.tools.length} tools`);

  await check("account_status");
  await check("nextdoor_status");
  await check("implementation_status");
  await check("performance_status");
  await check("discover_navigation");
  await check("capability_inventory");

  for (const surface of ["feed", "search", "inbox", "marketplace", "groups", "events", "alerts", "notifications", "settings", "business", "ads", "profile"]) {
    await check("browse_surface", { surface, query: surface === "search" ? "MCP integration" : undefined, limit: 10, fresh: true });
  }

  for (const name of ["list_feed", "list_chats", "list_marketplace", "list_groups", "list_events", "list_alerts", "list_notifications", "get_settings", "get_business_dashboard", "get_ads_dashboard"]) {
    await check(name, { limit: 10 });
  }
  await check("search_nextdoor", { query: "MCP integration", limit: 10 });
  await check("inspect_nextdoor_url", { url: "https://nextdoor.com/profile/", includeScreenshot: true });
  await check("audit_log", { limit: 100 });

  const created = await check("create_monitor", { name: "Comprehensive MCP live test", surface: "search", query: "MCP integration" });
  const monitorId = created.data?.id;
  await check("list_monitors");
  if (monitorId) {
    await check("run_monitor", { monitorId });
    await check("run_monitor", { monitorId });
    await check("delete_monitor", { monitorId });
  }
  await check("list_monitors");
} finally {
  await client.close();
}

for (const result of results) delete result.data;
const summary = {
  generatedAt: new Date().toISOString(),
  passed: results.filter(result => !result.isError).length,
  failed: results.filter(result => result.isError).length,
  results
};
const reportDir = path.join(os.homedir(), ".nextdoor-mcp", "diagnostics");
fs.mkdirSync(reportDir, { recursive: true, mode: 0o700 });
const reportPath = path.join(reportDir, `live-test-${Date.now()}.json`);
fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2), { mode: 0o600 });
console.log(`REPORT ${reportPath}`);
console.log(`SUMMARY ${summary.passed} passed, ${summary.failed} failed`);
