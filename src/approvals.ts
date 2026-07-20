import crypto from "node:crypto";
import type { PendingAction, Risk } from "./types.js";
import { load, mutate, audit } from "./store.js";

const ttlMs = 10 * 60_000;

export function preview(kind: string, risk: Risk, summary: string, payload: Record<string, unknown>): PendingAction {
  const now = Date.now();
  const action: PendingAction = {
    id: crypto.randomUUID(), kind, risk, summary, payload,
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + ttlMs).toISOString(),
    approvalToken: crypto.randomBytes(18).toString("base64url"), executionState: "pending"
  };
  mutate(state => { state.actions[action.id] = action; });
  audit({ event: "action_previewed", actionId: action.id, kind, risk, summary });
  return action;
}

export function claimApproved(actionId: string, token: string, confirmation?: string): PendingAction {
  return mutate(state => {
    const action = state.actions[actionId] as PendingAction | undefined;
    if (!action) throw new Error("Unknown action preview. Create a new preview.");
    if (action.executionState !== "pending") throw new Error(`This action is already ${action.executionState || "executed"}.`);
    if (Date.now() > Date.parse(action.expiresAt)) throw new Error("Approval expired. Create a new preview.");
    const supplied = Buffer.from(token), expected = Buffer.from(action.approvalToken || "");
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) throw new Error("Invalid approval token.");
    const required = action.risk === "typed" ? `CONFIRM ${action.kind.toUpperCase()} ${action.id}`
      : action.risk === "explicit" ? `APPROVE ${action.kind.toUpperCase()} ${action.id}` : undefined;
    if (required && confirmation !== required) throw new Error(`Explicit confirmation required: ${required}`);
    action.executionState = "executing";
    return structuredClone(action);
  });
}

export function markExecuted(action: PendingAction, result: unknown): void {
  mutate(state => {
    const saved = state.actions[action.id] as PendingAction;
    saved.executedAt = new Date().toISOString();
    saved.executionState = "executed";
    state.idempotency[action.id] = { result, at: saved.executedAt };
  });
  audit({ event: "action_executed", actionId: action.id, kind: action.kind });
}

export function markFailed(action: PendingAction): void {
  mutate(state => {
    const saved = state.actions[action.id] as PendingAction | undefined;
    if (saved) saved.executionState = "failed";
  });
}
