// Types for the decree share link and the follow-up chat (server/decreeExtras.ts).

export interface ShareState {
  /** The owner turned the share link on. */
  shared: boolean;
  /** Approved and allowed in the agent's portfolio: the link works anyway. */
  portfolio: boolean;
  /** Whether a non-owner can open the link right now. */
  open: boolean;
  /** Whether the owner can turn the link on now (a result has been delivered). */
  canShare: boolean;
}

export interface FollowUp {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'pending' | 'done' | 'failed';
  error: string | null;
  tokensIn: number;
  tokensOut: number;
  createdAt: string;
}

export interface FollowUpThread {
  messages: FollowUp[];
  /** Whether a new follow-up can be sent right now. */
  open: boolean;
  /** Why not, when open is false. */
  reason: string | null;
  usedDecree: number;
  perDecree: number;
  usedToday: number;
  perUser: number;
  maxChars: number;
}
