// Standing decrees (recurring decrees) and Vizier quest plans.
import type { GuildId } from './quests';
import type { AgentLite, DecreeStatus } from './types';

export type Cadence = 'daily' | 'weekly';
export const SCHEDULE_MAX_ACTIVE = 3; // per user
export const SCHEDULE_PAUSE_AFTER = 2; // consecutive skipped/failed runs
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// issued  = a real decree was created (its outcome follows the decree)
// skipped = no decree was created (not enough crowns, daily limit, agent away...)
export type ScheduleRunStatus = 'issued' | 'skipped';

export interface ScheduleRun {
  id: string;
  runNo: number;
  at: string;
  status: ScheduleRunStatus;
  reason: string | null;
  decreeId: string | null;
  decreeStatus: DecreeStatus | null;
}

export interface Schedule {
  id: string;
  agentId: string;
  agent: AgentLite | null;
  title: string;
  brief: string;
  price: number;
  cadence: Cadence;
  weekday: number | null; // 0 = Sunday (weekly only)
  hour: number; // UTC
  nextRunAt: string;
  active: boolean;
  pausedReason: string | null;
  runs: number;
  failStreak: number;
  lastDecreeId: string | null;
  createdAt: string;
  history: ScheduleRun[];
}

export interface CreateScheduleBody {
  decreeId: string;
  cadence: Cadence;
  weekday?: number;
  hour: number;
}

// Next time a schedule fires, strictly after `from`.
export function nextRun(cadence: Cadence, hour: number, weekday: number | null, from = new Date()): Date {
  const d = new Date(from);
  d.setUTCMinutes(0, 0, 0);
  d.setUTCHours(hour);
  if (cadence === 'daily') {
    if (d <= from) d.setUTCDate(d.getUTCDate() + 1);
    return d;
  }
  const wd = weekday ?? 1;
  let add = (wd - d.getUTCDay() + 7) % 7;
  if (add === 0 && d <= from) add = 7;
  d.setUTCDate(d.getUTCDate() + add);
  return d;
}

export const cadenceLabel = (c: Cadence, hour: number, weekday: number | null) =>
  `${c === 'daily' ? 'Every day' : `Every ${WEEKDAYS[weekday ?? 1]}`} at ${String(hour).padStart(2, '0')}:00 UTC`;

// ---------------- Vizier plans ----------------
export const VIZIER_PLANS_PER_USER = 5; // per UTC day

export interface PlanStep {
  province: GuildId;
  title: string;
  instruction: string;
  reason: string;
  share: number;
}

export interface VizierPlan {
  id: string;
  goal: string;
  title: string;
  reward: number;
  steps: PlanStep[];
  model: string;
  plansLeft: number;
  createdAt: string;
}

export interface ConfirmPlanBody {
  planId: string;
  title: string;
  steps: { province: GuildId; title: string; instruction: string; share: number }[];
}
