import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("compiled MCP entrypoint exists and has shebang", () => {
  const text = fs.readFileSync(new URL("../dist/index.js", import.meta.url), "utf8");
  assert.match(text, /^#!\/usr\/bin\/env node/);
  assert.match(text, /nextdoor_status/);
  assert.match(text, /capability_inventory/);
  assert.match(text, /preview_action/);
  assert.match(text, /execute_action/);
});

test("core safety and structured modules compile", () => {
  for (const file of ["approvals.js", "executor.js", "extract.js", "monitor.js", "platform.js", "rate.js", "status.js", "store.js"]) {
    assert.ok(fs.existsSync(new URL(`../dist/${file}`, import.meta.url)), file);
  }
});
