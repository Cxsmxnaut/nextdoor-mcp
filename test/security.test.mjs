import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function run(code, extraEnv = {}) {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    cwd: new URL("..", import.meta.url), encoding: "utf8", env: { ...process.env, ...extraEnv }
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test("approval tokens are one-shot, length-safe, and explicit actions require a bound phrase", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nextdoor-approval-"));
  const output = run(`
    const {preview}=await import('./dist/approvals.js');
    const {claimApproved}=await import('./dist/approvals.js');
    const a=preview('block_user','explicit','Block test',{url:'https://nextdoor.com/profile/x',controlLabel:'Block'});
    let malformed=false, missing=false, duplicate=false;
    try{claimApproved(a.id,'x')}catch(e){malformed=/Invalid approval token/.test(e.message)}
    try{claimApproved(a.id,a.approvalToken)}catch(e){missing=/Explicit confirmation required/.test(e.message)}
    claimApproved(a.id,a.approvalToken,'APPROVE BLOCK_USER '+a.id);
    try{claimApproved(a.id,a.approvalToken,'APPROVE BLOCK_USER '+a.id)}catch(e){duplicate=/already executing/.test(e.message)}
    console.log(JSON.stringify({malformed,missing,duplicate}));
  `, { NEXTDOOR_DATA_DIR: dir });
  assert.deepEqual(JSON.parse(output), { malformed: true, missing: true, duplicate: true });
});

test("encrypted state does not contain preview payload plaintext", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nextdoor-encryption-"));
  run(`const {preview}=await import('./dist/approvals.js'); preview('send_message','preview','test',{message:'PRIVATE_MARKER_74291'});`, { NEXTDOOR_DATA_DIR: dir });
  assert.equal(fs.readFileSync(path.join(dir, "state.enc")).includes(Buffer.from("PRIVATE_MARKER_74291")), false);
});

test("attachment allowlist resolves symlinks before authorization", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nextdoor-files-"));
  const allowed = path.join(root, "allowed"), outside = path.join(root, "outside");
  fs.mkdirSync(allowed); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
  fs.symlinkSync(path.join(outside, "secret.txt"), path.join(allowed, "escape.txt"));
  const output = run(`
    const {validateFiles}=await import('./dist/platform.js');
    try{validateFiles([process.env.TEST_FILE]);console.log('unsafe')}catch(e){console.log(/outside NEXTDOOR_ALLOWED_FILES/.test(e.message)?'safe':'wrong')}
  `, { NEXTDOOR_DATA_DIR: path.join(root, "state"), NEXTDOOR_ALLOWED_FILES: allowed, TEST_FILE: path.join(allowed, "escape.txt") });
  assert.equal(output, "safe");
});

test("corrupt encrypted state fails closed instead of resetting idempotency", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nextdoor-corrupt-"));
  fs.writeFileSync(path.join(dir, "state.enc"), "corrupt");
  const output = run(`
    const {load}=await import('./dist/store.js');
    try{load();console.log('unsafe')}catch(e){console.log(/refusing to reset/.test(e.message)?'safe':'wrong')}
  `, { NEXTDOOR_DATA_DIR: dir });
  assert.equal(output, "safe");
});
