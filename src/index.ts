#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as legacy from "./actions.js";
import { browse, discover, inspectUrl, inventory } from "./platform.js";
import { actionKinds, executeAction, previewAction } from "./executor.js";
import { createMonitor, deleteMonitor, listMonitors, runMonitor, startMonitorScheduler } from "./monitor.js";
import { load } from "./store.js";
import { implementationStatus } from "./status.js";
import { performanceStatus } from "./browser.js";

const server = new McpServer({ name: "nextdoor-mcp", version: "1.1.0" });
const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], structuredContent: (data && typeof data === "object" ? data : { value: data }) as Record<string, unknown> });
const surfaces = ["feed", "search", "inbox", "marketplace", "groups", "events", "alerts", "notifications", "settings", "business", "ads", "profile"] as const;

server.registerTool("account_status", { description: "Check authenticated Nextdoor status and safety configuration." }, async () => ok(await legacy.status()));
server.registerTool("capability_inventory", { description: "Discover current Nextdoor navigation and report which personal/business surfaces this account can access." }, async () => ok(await inventory()));
server.registerTool("discover_navigation", { description: "Refresh Nextdoor's live navigation registry instead of relying on hard-coded routes." }, async () => ok(await discover()));
server.registerTool("implementation_status", { description: "Report which planned capabilities are verified, implemented but account-gated, delegated to Claude, or unavailable." }, async () => ok(implementationStatus()));
server.registerTool("performance_status", { description: "Report headless/HTML-first settings and allowed/blocked browser resource counts." }, async () => ok(performanceStatus()));
server.registerTool("inspect_nextdoor_url", {
  description: "Read and diagnose a specific authenticated Nextdoor URL, with an optional local screenshot for evidence.",
  inputSchema: { url: z.string().min(1), includeScreenshot: z.boolean().default(false) }
}, async ({ url, includeScreenshot }) => ok(await inspectUrl(url, includeScreenshot)));
server.registerTool("browse_surface", {
  description: "Read a Nextdoor surface as compact structured entities. Images/media/fonts are not downloaded in lean mode.",
  inputSchema: { surface: z.enum(surfaces), query: z.string().optional(), limit: z.number().int().min(1).max(100).default(30), fresh: z.boolean().default(false) }
}, async ({ surface, query, limit, fresh }) => ok(await browse(surface, { query, limit, fresh })));

for (const [name, surface, description] of [
  ["list_feed", "feed", "List structured neighborhood feed items."],
  ["list_chats", "inbox", "List structured chats and conversation previews."],
  ["list_marketplace", "marketplace", "List For Sale & Free marketplace items."],
  ["list_groups", "groups", "List groups visible to this account."],
  ["list_events", "events", "List local and group events."],
  ["list_alerts", "alerts", "List local and official alerts."],
  ["list_notifications", "notifications", "List account notifications."],
  ["get_business_dashboard", "business", "Read the available business page/dashboard."],
  ["get_ads_dashboard", "ads", "Read Ads Manager accounts, campaigns and metrics available to this account."],
  ["get_settings", "settings", "Read account, privacy and notification settings."],
] as const) server.registerTool(name, { description, inputSchema: { limit: z.number().int().min(1).max(100).default(30) } }, async ({ limit }) => ok(await browse(surface, { limit })));

server.registerTool("search_nextdoor", {
  description: "Search Nextdoor and return compact structured results.",
  inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(100).default(30) }
}, async ({ query, limit }) => ok(await browse("search", { query, limit })));

server.registerTool("preview_action", {
  description: `Create a 10-minute approval preview for a legitimate Nextdoor write. Allowed kinds: ${actionKinds.join(", ")}. No write occurs.`,
  inputSchema: { kind: z.enum(actionKinds as [string, ...string[]]), summary: z.string().min(1), payload: z.record(z.string(), z.unknown()) }
}, async ({ kind, summary, payload }) => ok(previewAction(kind, summary, payload)));
server.registerTool("execute_action", {
  description: "Execute exactly one previously previewed action using its short-lived approval token. High-impact account deletion requires typed confirmation.",
  inputSchema: { actionId: z.string().uuid(), approvalToken: z.string().min(1), typedConfirmation: z.string().optional() }
}, async ({ actionId, approvalToken, typedConfirmation }) => ok(await executeAction(actionId, approvalToken, typedConfirmation)));

server.registerTool("create_monitor", {
  description: "Save a read-only Nextdoor monitor with deduplication.",
  inputSchema: { name: z.string().min(1), surface: z.enum(surfaces), query: z.string().optional(), intervalMinutes: z.number().int().min(5).max(10080).optional() }
}, async ({ name, surface, query, intervalMinutes }) => ok(createMonitor(name, surface, query, intervalMinutes)));
server.registerTool("list_monitors", { description: "List saved Nextdoor monitors." }, async () => ok({ monitors: listMonitors() }));
server.registerTool("run_monitor", { description: "Run a saved monitor and return only newly observed entities.", inputSchema: { monitorId: z.string().uuid() } }, async ({ monitorId }) => ok(await runMonitor(monitorId)));
server.registerTool("delete_monitor", { description: "Delete a saved monitor.", inputSchema: { monitorId: z.string().uuid() } }, async ({ monitorId }) => ok(deleteMonitor(monitorId)));
server.registerTool("audit_log", {
  description: "Read redacted local MCP audit events. Message and post bodies are never written to the audit log.",
  inputSchema: { limit: z.number().int().min(1).max(500).default(100) }
}, async ({ limit }) => ok({ events: load().audit.slice(-limit) }));

// Compatibility aliases retained for existing Claude conversations.
server.registerTool("nextdoor_status", { description: "Compatibility alias for account_status." }, async () => ok(await legacy.status()));
server.registerTool("draft_post", { description: "Legacy visual post draft; prefer preview_action(create_post).", inputSchema: { body: z.string().min(1), imagePaths: z.array(z.string()).default([]) } }, async ({ body, imagePaths }) => ok(await legacy.draftPost(body, imagePaths)));
server.registerTool("draft_chat", { description: "Legacy visual message draft; prefer preview_action(send_message).", inputSchema: { recipient: z.string().min(1), message: z.string().min(1) } }, async ({ recipient, message }) => ok(await legacy.draftChat(recipient, message)));

startMonitorScheduler();
await server.connect(new StdioServerTransport());
