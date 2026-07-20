export type Risk = "read" | "preview" | "explicit" | "typed";

export type Surface =
  | "feed" | "search" | "inbox" | "marketplace" | "groups" | "events"
  | "alerts" | "notifications" | "settings" | "business" | "ads" | "profile";

export interface Entity {
  id: string;
  type: string;
  title?: string;
  author?: string;
  text?: string;
  url?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

export interface PendingAction {
  id: string;
  kind: string;
  risk: Risk;
  summary: string;
  payload: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
  approvalToken?: string;
  executionState?: "pending" | "executing" | "executed" | "failed";
  executedAt?: string;
}
