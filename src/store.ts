import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export const dataDir = process.env.NEXTDOOR_DATA_DIR || path.join(os.homedir(), ".nextdoor-mcp");
const home = dataDir;
const keyFile = path.join(home, "data.key");
const dataFile = path.join(home, "state.enc");
const lockFile = path.join(home, "state.lock");

type State = { actions: Record<string, unknown>; audit: unknown[]; monitors: Record<string, unknown>; idempotency: Record<string, unknown> };
const empty = (): State => ({ actions: {}, audit: [], monitors: {}, idempotency: {} });

function key(): Buffer {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32), { mode: 0o600 });
  return fs.readFileSync(keyFile);
}

export function load(): State {
  if (!fs.existsSync(dataFile)) return empty();
  try {
    const raw = fs.readFileSync(dataFile);
    const iv = raw.subarray(0, 12), tag = raw.subarray(12, 28), encrypted = raw.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8"));
  } catch (error) {
    throw new Error(`Encrypted Nextdoor MCP state could not be read; refusing to reset approval/idempotency state: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function save(state: State): void {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(state)), cipher.final()]);
  const temporary = `${dataFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, Buffer.concat([iv, cipher.getAuthTag(), encrypted]), { mode: 0o600 });
  fs.renameSync(temporary, dataFile);
}

function wait(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function withLock<T>(fn: () => T): T {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const startedAt = Date.now();
  let descriptor: number | undefined;
  while (descriptor === undefined) {
    try {
      descriptor = fs.openSync(lockFile, "wx", 0o600);
      fs.writeFileSync(descriptor, String(process.pid));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const stale = (() => {
        try { return Date.now() - fs.statSync(lockFile).mtimeMs > 30_000; }
        catch { return false; }
      })();
      if (stale) { try { fs.unlinkSync(lockFile); } catch {} continue; }
      if (Date.now() - startedAt > 5_000) throw new Error("Timed out waiting for the encrypted state lock.");
      wait(10);
    }
  }
  try {
    return fn();
  } finally {
    fs.closeSync(descriptor);
    try { fs.unlinkSync(lockFile); } catch {}
  }
}

export function mutate<T>(fn: (state: State) => T): T {
  return withLock(() => {
    const state = load();
    const result = fn(state);
    save(state);
    return result;
  });
}

export function audit(event: Record<string, unknown>): void {
  mutate(state => {
    state.audit.push({ at: new Date().toISOString(), ...event });
    state.audit = state.audit.slice(-1000);
  });
}
