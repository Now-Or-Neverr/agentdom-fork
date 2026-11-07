// Quests: a chain of 2–4 decrees, each carried out by a different guild.
// Every step's real result is passed into the next step's brief.
import type { ProvinceId } from './realm';
import type { AgentLite, DecreeStatus } from './types';

export type GuildId = Exclude<ProvinceId, 'throne'>;

export const QUEST_MIN_STEPS = 2;
export const QUEST_MAX_STEPS = 4;
export const QUEST_MIN_SHARE = 5; // same floor as a single decree
export const QUEST_MAX_SHARE = 1000; // same ceiling as a single decree
export const QUEST_MAX_REWARD = 2000;

export interface QuestTemplateStep {
  province: GuildId;
  title: string; // short name of the step, e.g. "Market research"
  instruction: string; // what this guild must do with the subject and the previous output
  weight: number; // relative share of the reward
}

export interface QuestTemplate {
  id: string;
  title: string;
  tagline: string;
  subjectLabel: string;
  subjectPlaceholder: string;
  suggestedReward: number;
  steps: QuestTemplateStep[];
}

// 'waiting' = not started yet (its decree is created when the previous step is delivered)
// 'refunded' = never started because an earlier step failed; its share went back to the requester
export type QuestStepStatus = 'waiting' | 'refunded' | DecreeStatus;
export type QuestStatus = 'active' | 'complete' | 'failed';

export interface QuestStep {
  index: number;
  province: GuildId;
  title: string;
  instruction: string;
  share: number;
  status: QuestStepStatus;
  decreeId: string | null;
  agent: AgentLite | null;
  result: string; // markdown; owner only
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface Quest {
  id: string;
  templateId: string | null;
  title: string;
  subject: string;
  reward: number;
  status: QuestStatus;
  rating: number | null;
  review: string | null;
  createdAt: string;
  finishedAt: string | null;
  done: number; // steps delivered
  steps: QuestStep[];
}

export interface CreateQuestBody {
  templateId?: string; // a preset chain, or omit and send steps for a custom quest
  steps?: { province: GuildId; title?: string; instruction: string }[];
  title: string;
  subject: string;
  reward: number;
}

// Split a total into integer shares by weight. Every share gets at least QUEST_MIN_SHARE
// and the shares always sum to the total. Used by the server and the create preview.
export function splitReward(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (!n) return [];
  let ws = weights.map((w) => Math.max(0, w));
  if (!ws.some((w) => w > 0)) ws = ws.map(() => 1);
  const sum = ws.reduce((s, w) => s + w, 0);
  const raw = ws.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let rest = total - out.reduce((s, x) => s + x, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rest > 0; k = (k + 1) % n, rest--) out[order[k][1]]++;
  // Raise tiny shares to the floor, taking from the largest share.
  for (let i = 0; i < n; i++) {
    while (out[i] < QUEST_MIN_SHARE) {
      const big = out.indexOf(Math.max(...out));
      if (big === i || out[big] <= QUEST_MIN_SHARE) break;
      out[big]--;
      out[i]++;
    }
  }
  return out;
}
