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

test("autonomous actions start immediately without approval tokens or confirmation phrases", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nextdoor-autonomous-"));
  const output = run(`
    const {startAutonomous}=await import('./dist/approvals.js');
    const {load}=await import('./dist/store.js');
    const a=startAutonomous('delete_account','typed','Delete the account',{url:'https://nextdoor.com/settings',controlLabel:'Delete'});
    const saved=load().actions[a.id];
    console.log(JSON.stringify({state:saved.executionState,hasToken:Boolean(saved.approvalToken),audit:load().audit.at(-1)}));
  `, { NEXTDOOR_DATA_DIR: dir });
  const result = JSON.parse(output);
  assert.equal(result.state, "executing");
  assert.equal(result.hasToken, false);
  assert.equal(result.audit.mode, "autonomous");
  assert.equal("summary" in result.audit, false);
});

test("spend limits are revalidated when an approved action executes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nextdoor-spend-"));
  const output = run(`
    const {previewAction,executeAction}=await import('./dist/executor.js');
    const a=previewAction('change_budget','Change budget',{url:'https://nextdoor.com/page-admin/ads-management/',controlLabel:'Save',amount:50});
    process.env.NEXTDOOR_MAX_DAILY_SPEND='0';
    process.env.NEXTDOOR_MAX_CAMPAIGN_SPEND='0';
    try{await executeAction(a.id,a.approvalToken,'APPROVE CHANGE_BUDGET '+a.id);console.log('unsafe')}
    catch(e){console.log(/Ad spending is locked/.test(e.message)?'safe':'wrong')}
  `, {
    NEXTDOOR_DATA_DIR: dir, NEXTDOOR_ALLOW_WRITE: "true",
    NEXTDOOR_MAX_DAILY_SPEND: "100", NEXTDOOR_MAX_CAMPAIGN_SPEND: "100"
  });
  assert.equal(output, "safe");
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

test("state mutations release their cross-process lock", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nextdoor-lock-"));
  run(`
    const {mutate}=await import('./dist/store.js');
    mutate(state=>{state.idempotency.first=true});
    mutate(state=>{state.idempotency.second=true});
  `, { NEXTDOOR_DATA_DIR: dir });
  assert.equal(fs.existsSync(path.join(dir, "state.lock")), false);
});

test("targeted reversible and deletion actions require exact target text", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nextdoor-targeting-"));
  const output = run(`
    const {previewAction}=await import('./dist/executor.js');
    const results={};
    for(const kind of ['react','rsvp','join_group','fave_business','delete_content']){
      try{previewAction(kind,'test',{url:'https://nextdoor.com/p/test',controlLabel:'Test'});results[kind]='unsafe'}
      catch(e){results[kind]=/text is required/.test(e.message)?'safe':'wrong'}
    }
    console.log(JSON.stringify(results));
  `, { NEXTDOOR_DATA_DIR: dir });
  assert.deepEqual(JSON.parse(output), {
    react: "safe", rsvp: "safe", join_group: "safe", fave_business: "safe", delete_content: "safe"
  });
});
