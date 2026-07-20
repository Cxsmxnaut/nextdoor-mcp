import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export const dataDir = process.env.NEXTDOOR_DATA_DIR || path.join(os.homedir(), ".nextdoor-mcp");
const home = dataDir;
const keyFile = path.join(home, "data.key");
const dataFile = path.join(home, "state.enc");

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

export function save(state: State): void {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(state)), cipher.final()]);
  const temporary = `${dataFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, Buffer.concat([iv, cipher.getAuthTag(), encrypted]), { mode: 0o600 });
  fs.renameSync(temporary, dataFile);
}

export function mutate<T>(fn: (state: State) => T): T {
  const state = load();
  const result = fn(state);
  save(state);
  return result;
}

export function audit(event: Record<string, unknown>): void {
  mutate(state => {
    state.audit.push({ at: new Date().toISOString(), ...event });
    state.audit = state.audit.slice(-1000);
  });
}
