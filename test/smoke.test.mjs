import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

test("compiled MCP entrypoint exists and has shebang", () => {
  const text = fs.readFileSync(new URL("../dist/index.js", import.meta.url), "utf8");
  assert.match(text, /^#!\/usr\/bin\/env node/);
  assert.match(text, /nextdoor_status/);
  assert.match(text, /capability_inventory/);
  assert.match(text, /preview_action/);
  assert.match(text, /execute_action/);
  assert.match(text, /perform_action/);
  assert.match(text, /find_own_post/);
});

test("core safety and structured modules compile", () => {
  for (const file of ["approvals.js", "executor.js", "extract.js", "monitor.js", "platform.js", "rate.js", "status.js", "store.js"]) {
    assert.ok(fs.existsSync(new URL(`../dist/${file}`, import.meta.url)), file);
  }
});

test("MCP protocol advertises autonomous execution", () => {
  const input = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }
  ].map(message => JSON.stringify(message)).join("\n") + "\n";
  const result = spawnSync(process.execPath, ["dist/index.js"], {
    cwd: new URL("..", import.meta.url), input, encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  const responses = result.stdout.trim().split("\n").map(line => JSON.parse(line));
  const names = responses.find(response => response.id === 2).result.tools.map(tool => tool.name);
  assert.ok(names.includes("perform_action"));
});
