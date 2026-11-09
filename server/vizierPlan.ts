// "Ask the Vizier to plan": one goal in, a 2–4 step quest plan out (one Claude call, structured JSON).
// Planning is free (no crowns) but rate-limited per user and realm-wide. Confirming a plan creates a
// real quest through the existing quest engine (server/quests.ts createQuestRows).
import Anthropic from '@anthropic-ai/sdk';
import { decreeLimit } from './holders';
import { db, now, uid, type Row } from './db';
import { HttpError, allAgents, count, crownsEnabled, startOfDay, text } from './core';
import { createQuestRows } from './quests';
import { GUILDS, PROVINCE } from '../shared/realm';
import { QUEST_MAX_REWARD, QUEST_MAX_SHARE, QUEST_MAX_STEPS, QUEST_MIN_SHARE, QUEST_MIN_STEPS, splitReward, type GuildId } from '../shared/quests';
import { VIZIER_PLANS_PER_USER, type PlanStep, type VizierPlan } from '../shared/schedules';

db.exec(`
CREATE TABLE IF NOT EXISTS vizier_plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  goal TEXT NOT NULL,
  plan TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  quest_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS vizier_plans_user ON vizier_plans(user_id, created_at);
`);

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const GLOBAL_CAP = () => Number(process.env.VIZIER_PLANS_PER_DAY) || 60;
// Same limits (and env vars) as POST /api/decrees and POST /api/quests.
const LIMIT_USER = Number(process.env.DAILY_DECREES_PER_USER) || 5;
const LIMIT_IP = Number(process.env.DAILY_DECREES_PER_IP) || 10;
const LIMIT_GLOBAL = Number(process.env.DAILY_DECREES_GLOBAL) || 200;

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic());

const plansToday = (userId: string) => count('SELECT COUNT(*) AS n FROM vizier_plans WHERE user_id = ? AND created_at >= ?', userId, startOfDay());

function toPlan(r: Row, userId: string): VizierPlan {
  const p = JSON.parse(r.plan) as { title: string; reward: number; steps: PlanStep[] };
  return { id: r.id, goal: r.goal, title: p.title, reward: p.reward, steps: p.steps, model: r.model, plansLeft: Math.max(0, VIZIER_PLANS_PER_USER - plansToday(userId)), createdAt: r.created_at };
}

export const plansLeft = (userId: string) => Math.max(0, VIZIER_PLANS_PER_USER - plansToday(userId));

export async function makePlan(user: Row, body: Row): Promise<VizierPlan> {
  if (!process.env.ANTHROPIC_API_KEY) throw new HttpError(503, 'The Grand Vizier’s AI is offline, so no plan can be made right now.');
  const goal = text(body.goal, 1500, 'Goal');
  if (goal.length < 12) throw new HttpError(400, 'Describe the goal in a sentence or two.');
  const budget = Math.round(Number(body.reward) || 120);
  if (!(budget >= QUEST_MIN_SHARE * QUEST_MIN_STEPS && budget <= QUEST_MAX_REWARD))
    throw new HttpError(400, `The total reward must be between ${QUEST_MIN_SHARE * QUEST_MIN_STEPS} and ${QUEST_MAX_REWARD} crowns.`);
  if (plansToday(user.id) >= VIZIER_PLANS_PER_USER) throw new HttpError(429, `The Vizier makes ${VIZIER_PLANS_PER_USER} plans per person per day. Come back tomorrow.`);
  if (count('SELECT COUNT(*) AS n FROM vizier_plans WHERE created_at >= ?', startOfDay()) >= GLOBAL_CAP())
    throw new HttpError(429, 'The Vizier has made all the plans he can today. Try again tomorrow.');

  const agents = [...allAgents().values()];
  const open = GUILDS.filter((g) => agents.some((a) => a.province === g.id && a.active));
  if (open.length < QUEST_MIN_STEPS) throw new HttpError(503, 'Not enough guilds have active agents right now.');
  const list = open.map((g) => `- ${g.id}: ${g.name} (${g.craft}) — ${g.tagline}`).join('\n');

  // Reserve the slot before the call so parallel requests cannot exceed the limit.
  const id = uid('vpl');
  db.prepare('INSERT INTO vizier_plans (id, user_id, goal, plan, model, created_at) VALUES (?,?,?,?,?,?)').run(id, user.id, goal, '{"title":"","reward":0,"steps":[]}', MODEL, now());
  let res: Anthropic.Message;
  try {
    res = await getClient().messages.create({
      model: MODEL,
      max_tokens: 3000,
      output_config: {
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Short quest title, max 60 characters.' },
              steps: {
                type: 'array',
                description: `${QUEST_MIN_STEPS} to ${QUEST_MAX_STEPS} steps in order, each by a different guild.`,
                items: {
                  type: 'object',
                  properties: {
                    guild: { type: 'string', enum: open.map((g) => g.id) },
                    title: { type: 'string', description: 'Step name, max 40 characters.' },
                    instruction: { type: 'string', description: 'What this guild must do, building on the previous step output. 1–3 sentences.' },
                    weight: { type: 'integer', description: 'Relative effort of this step, 1 to 5.' },
                    reason: { type: 'string', description: 'One short sentence: why this guild does this step.' },
                  },
                  required: ['guild', 'title', 'instruction', 'weight', 'reason'],
                  additionalProperties: false,
                },
              },
            },
            required: ['title', 'steps'],
            additionalProperties: false,
          },
        },
      },
      system:
        'You are the Grand Vizier of Agentdom, a kingdom of AI agents organised in guilds. Turn the requester’s goal into a quest: a chain of 2 to 4 steps, ' +
        'each carried out by a DIFFERENT guild, where each step receives the previous step’s written output. Agents produce text deliverables (research, copy, plans, code, design specs). ' +
        'Use as few steps as the goal needs. Write in English.',
      messages: [{ role: 'user', content: `Guilds:\n${list}\n\nGoal:\n${goal}` }],
    });
  } catch (e) {
    db.prepare('DELETE FROM vizier_plans WHERE id = ?').run(id); // a failed call does not use up a plan
    console.error('[vizier-plan]', e);
    throw new HttpError(502, 'The Grand Vizier could not be reached. Try again in a moment.');
  }
  const raw = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? '';
  let parsed: { title?: string; steps?: { guild: string; title: string; instruction: string; weight: number; reason: string }[] } = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* handled below */
  }
  const seen = new Set<string>();
  const steps = (parsed.steps ?? [])
    .filter((s) => open.some((g) => g.id === s.guild) && !seen.has(s.guild) && seen.add(s.guild))
    .slice(0, QUEST_MAX_STEPS);
  if (res.stop_reason === 'refusal' || steps.length < QUEST_MIN_STEPS) {
    db.prepare('UPDATE vizier_plans SET plan = ?, tokens_in = ?, tokens_out = ? WHERE id = ?').run(
      JSON.stringify({ title: '', reward: 0, steps: [], error: res.stop_reason }),
      res.usage.input_tokens,
      res.usage.output_tokens,
      id,
    );
    throw new HttpError(422, 'The Vizier could not turn this goal into a quest. Try describing it differently.');
  }
  const shares = splitReward(
    budget,
    steps.map((s) => Math.min(5, Math.max(1, Math.round(Number(s.weight) || 1)))),
  );
  const plan = {
    title: String(parsed.title ?? '').trim().slice(0, 100) || goal.slice(0, 60),
    reward: budget,
    steps: steps.map(
      (s, i): PlanStep => ({
        province: s.guild as GuildId,
        title: String(s.title).trim().slice(0, 60) || PROVINCE[s.guild as GuildId].craft,
        instruction: String(s.instruction).trim().slice(0, 1000),
        reason: String(s.reason).trim().slice(0, 300),
        share: shares[i],
      }),
    ),
  };
  db.prepare('UPDATE vizier_plans SET plan = ?, tokens_in = ?, tokens_out = ? WHERE id = ?').run(JSON.stringify(plan), res.usage.input_tokens, res.usage.output_tokens, id);
  return toPlan(db.prepare('SELECT * FROM vizier_plans WHERE id = ?').get(id) as Row, user.id);
}

// Steps of active quests that have no decree yet still count against today's limits (same as routes/quests.ts).
const reserved = (where: string, ...args: string[]) =>
  count(`SELECT COUNT(*) AS n FROM quest_steps s JOIN quests q ON q.id = s.quest_id WHERE q.status = 'active' AND s.state = 'pending'${where}`, ...args);

// Confirm an (edited) plan → a real quest. Same validation as POST /api/quests, with explicit shares.
export function confirmPlan(user: Row, ip: string, b: Row): string {
  const r = db.prepare('SELECT * FROM vizier_plans WHERE id = ?').get(String(b.planId ?? '')) as Row | undefined;
  if (!r || r.user_id !== user.id) throw new HttpError(404, 'Plan not found.');
  if (r.quest_id) throw new HttpError(400, 'This plan already became a quest.');
  const title = text(b.title, 100, 'Quest title');
  if (!Array.isArray(b.steps)) throw new HttpError(400, 'The plan has no steps.');
  const steps = (b.steps as Row[]).map((s, i) => {
    if (!GUILDS.some((g) => g.id === s?.province)) throw new HttpError(400, `Step ${i + 1}: choose a guild.`);
    const share = Math.round(Number(s.share));
    if (!(share >= QUEST_MIN_SHARE && share <= QUEST_MAX_SHARE)) throw new HttpError(400, `Step ${i + 1}: the share must be between ${QUEST_MIN_SHARE} and ${QUEST_MAX_SHARE} crowns.`);
    return {
      province: s.province as GuildId,
      title: text(s.title, 60, `Step ${i + 1} title`, false) || PROVINCE[s.province as GuildId].craft,
      instruction: text(s.instruction, 1000, `Step ${i + 1} instructions`),
      share,
    };
  });
  const n = steps.length;
  if (n < QUEST_MIN_STEPS || n > QUEST_MAX_STEPS) throw new HttpError(400, `A quest has ${QUEST_MIN_STEPS} to ${QUEST_MAX_STEPS} steps.`);
  if (new Set(steps.map((s) => s.province)).size !== n) throw new HttpError(400, 'Each step must be handled by a different guild.');
  const agents = [...allAgents().values()];
  for (const s of steps)
    if (!agents.some((a) => a.province === s.province && a.active)) throw new HttpError(400, `The ${PROVINCE[s.province].name} has no active agent right now.`);
  const reward = steps.reduce((t, s) => t + s.share, 0);
  if (reward > QUEST_MAX_REWARD) throw new HttpError(400, `A quest's total reward can be at most ${QUEST_MAX_REWARD} crowns.`);
  if (crownsEnabled() && user.crowns < reward) throw new HttpError(400, `Not enough crowns. You have ${user.crowns}, this quest needs ${reward}.`);

  const today = startOfDay();
  const userUsed = count('SELECT COUNT(*) AS n FROM decrees WHERE user_id = ? AND created_at >= ?', user.id, today) + reserved(' AND q.user_id = ?', user.id);
  const limitUser = decreeLimit(user.id as string);
  if (userUsed + n > limitUser)
    throw new HttpError(429, `This quest needs ${n} of your ${limitUser} daily decrees and you have ${Math.max(0, limitUser - userUsed)} left today.`);
  if (ip) {
    const ipUsed = count('SELECT COUNT(*) AS n FROM decrees WHERE ip = ? AND created_at >= ?', ip, today) + reserved(' AND q.ip = ?', ip);
    if (ipUsed + n > LIMIT_IP) throw new HttpError(429, 'Not enough decrees left today on this network for a quest this long.');
  }
  if (count('SELECT COUNT(*) AS n FROM decrees WHERE created_at >= ?', today) + reserved('') + n > LIMIT_GLOBAL)
    throw new HttpError(429, 'The realm is close to today’s decree limit. Try a shorter quest or come back tomorrow.');

  // Claim the plan first so a double click cannot create two quests.
  const claim = db.prepare("UPDATE vizier_plans SET quest_id = 'pending' WHERE id = ? AND quest_id IS NULL").run(r.id);
  if (Number(claim.changes) !== 1) throw new HttpError(400, 'This plan already became a quest.');
  try {
    const qid = createQuestRows(user, ip, null, title, r.goal, reward, steps);
    db.prepare('UPDATE vizier_plans SET quest_id = ? WHERE id = ?').run(qid, r.id);
    return qid;
  } catch (e) {
    db.prepare('UPDATE vizier_plans SET quest_id = NULL WHERE id = ?').run(r.id);
    throw e;
  }
}
