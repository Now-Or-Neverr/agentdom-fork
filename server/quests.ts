// Quest engine: chains of decrees across guilds.
// Only the current step exists as a decree; the existing worker carries it out.
// When a step is delivered it is approved automatically (reward released to its agent)
// and the next step is queued with the previous step's full result in its brief.
import { db, now, tx, uid, type Row } from './db';
import { bus, decreeChanged, logActivity } from './events';
import { HttpError, agentById, allAgents, count, crownsEnabled, ledger, lite } from './core';
import { PROVINCE } from '../shared/realm';
import type { GuildId, Quest, QuestStep, QuestStepStatus, QuestTemplate } from '../shared/quests';

db.exec(`
CREATE TABLE IF NOT EXISTS quests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  template_id TEXT,
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  reward INTEGER NOT NULL,
  status TEXT NOT NULL,
  rating INTEGER,
  review TEXT,
  ip TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS quests_user ON quests(user_id, created_at);
CREATE INDEX IF NOT EXISTS quests_status ON quests(status);
CREATE TABLE IF NOT EXISTS quest_steps (
  quest_id TEXT NOT NULL REFERENCES quests(id),
  idx INTEGER NOT NULL,
  province TEXT NOT NULL,
  title TEXT NOT NULL,
  instruction TEXT NOT NULL,
  share INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending', -- pending | started | refunded
  decree_id TEXT,
  PRIMARY KEY (quest_id, idx)
);
CREATE INDEX IF NOT EXISTS quest_steps_decree ON quest_steps(decree_id);
`);

// ---------------- templates ----------------
export const TEMPLATES: QuestTemplate[] = [
  {
    id: 'launch',
    title: 'Launch a product',
    tagline: 'Research the market, write the copy, plan the posts, design the poster.',
    subjectLabel: 'What are you launching?',
    subjectPlaceholder: 'A reusable bamboo water bottle for commuters, $24, launching online next month.',
    suggestedReward: 200,
    steps: [
      {
        province: 'archive',
        title: 'Market research',
        instruction:
          'Analyse the market for this product: target audiences, their pains, likely competitor types and positioning angles. Base it only on what the requester gave you and general knowledge; mark anything that needs real data.',
        weight: 3,
      },
      {
        province: 'scriptorium',
        title: 'Launch copy',
        instruction: 'Using the research, write the launch copy: a headline, a subheadline, a short product description and three benefit bullets.',
        weight: 3,
      },
      {
        province: 'heralds',
        title: 'Launch posts',
        instruction: 'Using the copy, plan the launch on social media: five ready-to-post texts for different platforms and a simple posting schedule for launch week.',
        weight: 2,
      },
      {
        province: 'atelier',
        title: 'Launch poster',
        instruction: 'Using the copy and the posts, design the launch poster: layout, headline placement, colour palette with hex codes, typography and a detailed visual description.',
        weight: 2,
      },
    ],
  },
  {
    id: 'article',
    title: 'Publish an article',
    tagline: 'Research and outline, write the article, then promote it.',
    subjectLabel: 'What should the article be about?',
    subjectPlaceholder: 'How small cafés can cut food waste without losing customers. Audience: café owners.',
    suggestedReward: 120,
    steps: [
      {
        province: 'archive',
        title: 'Research & outline',
        instruction: 'Research the topic from general knowledge and build a detailed outline with key points per section. Mark any statistics that must be checked.',
        weight: 1,
      },
      { province: 'scriptorium', title: 'Write the article', instruction: 'Write the full article from the outline, clear and engaging, around 800–1,200 words.', weight: 2 },
      {
        province: 'heralds',
        title: 'Promotion',
        instruction: 'Promote the article: an SEO title and meta description, three social posts and a short newsletter blurb.',
        weight: 1,
      },
    ],
  },
  {
    id: 'landing',
    title: 'Build a landing page',
    tagline: 'Copy first, then a design direction, then working HTML & CSS.',
    subjectLabel: 'What is the page for?',
    subjectPlaceholder: 'A landing page for a weekend pottery workshop in Bandung, sign-ups via a form.',
    suggestedReward: 220,
    steps: [
      { province: 'scriptorium', title: 'Page copy', instruction: 'Write the landing page copy section by section: hero, benefits, how it works, FAQ and a call to action.', weight: 2 },
      {
        province: 'atelier',
        title: 'Design direction',
        instruction: 'Define the visual design for this copy: layout per section, colour palette with hex codes, fonts, spacing and component styles.',
        weight: 2,
      },
      {
        province: 'forge',
        title: 'HTML & CSS',
        instruction: 'Build the page as a single self-contained HTML file with inline CSS, following the copy and design direction exactly. Make it responsive.',
        weight: 3,
      },
    ],
  },
  {
    id: 'outreach',
    title: 'Sales outreach kit',
    tagline: 'Define the ideal customer, then write the outreach sequence.',
    subjectLabel: 'What do you sell, and to whom?',
    subjectPlaceholder: 'Bookkeeping for freelance designers, $49/month.',
    suggestedReward: 100,
    steps: [
      {
        province: 'archive',
        title: 'Ideal customer profile',
        instruction: 'Build an ideal customer profile: segments, pains, buying triggers, objections and where to find them.',
        weight: 1,
      },
      {
        province: 'bazaar',
        title: 'Outreach sequence',
        instruction: 'Using the profile, write a cold outreach sequence: three emails and two follow-ups, plus answers to the top objections.',
        weight: 1,
      },
    ],
  },
  {
    id: 'video',
    title: 'Explainer video',
    tagline: 'Script it, storyboard it, then plan how to share it.',
    subjectLabel: 'What should the video explain?',
    subjectPlaceholder: 'How our app splits group bills in three taps. 60 seconds, for Instagram Reels.',
    suggestedReward: 160,
    steps: [
      { province: 'scriptorium', title: 'Script', instruction: 'Write the video script with narration and on-screen text, timed to the requested length.', weight: 2 },
      { province: 'theatre', title: 'Storyboard', instruction: 'Turn the script into a shot-by-shot storyboard: shots, visuals, motion, music and timing.', weight: 2 },
      { province: 'heralds', title: 'Distribution', instruction: 'Plan how to publish the video: captions, hashtags, thumbnail text and a posting plan per platform.', weight: 1 },
    ],
  },
  {
    id: 'business',
    title: 'Start a small business',
    tagline: 'A lean plan with pricing, the basic terms, then a launch campaign.',
    subjectLabel: 'Describe the business',
    subjectPlaceholder: 'A home bakery selling sourdough by pre-order, delivery within the city.',
    suggestedReward: 180,
    steps: [
      { province: 'treasury', title: 'Business plan', instruction: 'Write a lean business plan: offer, costs to fill in, pricing logic, operations workflow and first-month goals.', weight: 2 },
      {
        province: 'court',
        title: 'Terms & policies',
        instruction: 'Draft simple customer terms and a privacy notice that fit this plan. Note clearly that a lawyer should review them.',
        weight: 1,
      },
      { province: 'heralds', title: 'Launch campaign', instruction: 'Plan a launch campaign for the first month based on the plan: channels, messages and five ready-to-post texts.', weight: 2 },
    ],
  },
];
export const templateById = (id: unknown) => TEMPLATES.find((t) => t.id === id);

// ---------------- mapping ----------------
export const questChanged = (id: string) => bus.emit('quest:' + id);

const stepRows = (questId: string) =>
  db
    .prepare(
      `SELECT s.*, d.status AS d_status, d.agent_id, d.result, d.error, d.started_at, d.delivered_at, d.finished_at AS d_finished
       FROM quest_steps s LEFT JOIN decrees d ON d.id = s.decree_id WHERE s.quest_id = ? ORDER BY s.idx`,
    )
    .all(questId) as Row[];

export function toQuest(q: Row, full: boolean): Quest {
  const steps: QuestStep[] = stepRows(q.id).map((s) => {
    const status: QuestStepStatus = s.decree_id ? s.d_status : s.state === 'refunded' ? 'refunded' : 'waiting';
    const a = s.agent_id ? agentById(s.agent_id) : null;
    return {
      index: s.idx,
      province: s.province,
      title: s.title,
      instruction: s.instruction,
      share: s.share,
      status,
      decreeId: s.decree_id,
      agent: a ? lite(a) : null,
      result: full ? (s.result ?? '') : '',
      error: full ? (s.error ?? null) : null,
      startedAt: s.started_at ?? null,
      finishedAt: s.delivered_at ?? s.d_finished ?? null,
    };
  });
  return {
    id: q.id,
    templateId: q.template_id,
    title: q.title,
    subject: full ? q.subject : '',
    reward: q.reward,
    status: q.status,
    rating: q.rating,
    review: q.review,
    createdAt: q.created_at,
    finishedAt: q.finished_at,
    done: steps.filter((s) => s.status === 'delivered' || s.status === 'approved').length,
    steps,
  };
}

// ---------------- engine ----------------
// Best record in the guild: highest rating, then most approved; ties broken at random.
function pickAgent(province: GuildId) {
  const pool = [...allAgents().values()].filter((a) => a.province === province && a.active);
  if (!pool.length) return null;
  const score = (a: (typeof pool)[number]) => [a.rating ?? 0, a.approved] as const;
  pool.sort((a, b) => score(b)[0] - score(a)[0] || score(b)[1] - score(a)[1]);
  const top = pool.filter((a) => score(a)[0] === score(pool[0])[0] && score(a)[1] === score(pool[0])[1]);
  return top[Math.floor(Math.random() * top.length)];
}

function briefFor(q: Row, step: Row, total: number, prev: { title: string; province: string; agent: string; result: string } | null) {
  const p = PROVINCE[step.province as GuildId];
  const parts = [
    `This decree is step ${step.idx + 1} of ${total} of the quest “${q.title}”. You work for the ${p.name} (${p.craft}).`,
    '',
    'Subject from the requester:',
    q.subject,
    '',
    'Your task in this step:',
    step.instruction,
  ];
  if (prev)
    parts.push(
      '',
      `Output of the previous step (step ${step.idx} “${prev.title}”, by ${prev.agent} of the ${prev.province}):`,
      '<<<PREVIOUS_STEP',
      prev.result,
      'PREVIOUS_STEP>>>',
      '',
      'Build on that output. Deliver only your part of the quest.',
    );
  return parts.join('\n');
}

// Insert the decree for a step (crowns were already locked when the quest was created).
function startStep(q: Row, step: Row, total: number, prev: Parameters<typeof briefFor>[3]) {
  const agent = pickAgent(step.province);
  if (!agent) throw new Error(`No active agent in ${step.province}`);
  const id = uid('dec');
  const title = `${q.title} · ${step.title}`.slice(0, 140);
  // Claim the step first so it can never get two decrees.
  const claim = db.prepare("UPDATE quest_steps SET state = 'started', decree_id = ? WHERE quest_id = ? AND idx = ? AND state = 'pending'").run(id, q.id, step.idx);
  if (Number(claim.changes) !== 1) throw new Error(`Quest ${q.id} step ${step.idx} was already started`);
  db.prepare(
    `INSERT INTO decrees (id, user_id, agent_id, commission_id, province, title, brief, price, status, is_public, routed_by, ip, route_reason, eta_minutes, created_at)
     VALUES (?,?,?,NULL,?,?,?,?, 'queued', 0, 'requester', ?, ?, 10, ?)`,
  ).run(
    id,
    q.user_id,
    agent.id,
    step.province,
    title,
    briefFor(q, step, total, prev),
    step.share,
    q.ip ?? '',
    `Quest step ${step.idx + 1} of ${total}: the ${PROVINCE[step.province as GuildId].name} agent with the best record.`,
    now(),
  );
  return { id, agent };
}

export function createQuestRows(
  user: Row,
  ip: string,
  templateId: string | null,
  title: string,
  subject: string,
  reward: number,
  steps: { province: GuildId; title: string; instruction: string; share: number }[],
) {
  const id = uid('qst');
  if (!crownsEnabled()) {
    // Crowns are off: the quest and every step decree are free.
    reward = 0;
    steps = steps.map((s) => ({ ...s, share: 0 }));
  }
  const first = tx(() => {
    if (reward > 0) {
      const u = db.prepare('SELECT crowns FROM users WHERE id = ?').get(user.id) as Row;
      if (u.crowns < reward) throw new HttpError(400, `Not enough crowns. You have ${u.crowns}, this quest needs ${reward}.`);
      db.prepare('UPDATE users SET crowns = crowns - ? WHERE id = ?').run(reward, user.id);
      ledger(user.id, -reward, 'vault_lock', id);
    }
    db.prepare("INSERT INTO quests (id, user_id, template_id, title, subject, reward, status, ip, created_at) VALUES (?,?,?,?,?,?, 'active', ?, ?)").run(
      id,
      user.id,
      templateId,
      title,
      subject,
      reward,
      ip,
      now(),
    );
    const ins = db.prepare('INSERT INTO quest_steps (quest_id, idx, province, title, instruction, share) VALUES (?,?,?,?,?,?)');
    steps.forEach((s, i) => ins.run(id, i, s.province, s.title, s.instruction, s.share));
    const q = db.prepare('SELECT * FROM quests WHERE id = ?').get(id) as Row;
    const s0 = db.prepare('SELECT * FROM quest_steps WHERE quest_id = ? AND idx = 0').get(id) as Row;
    return startStep(q, s0, steps.length, null);
  });
  watch(first.id, id);
  logActivity('quest_started', steps[0].province, `A quest began: “${title}” · ${steps.length} guilds, starting with ${first.agent.name}`, first.agent.id);
  return id;
}

// Move a quest forward based on the real state of its current step. Idempotent.
export function advance(questId: string) {
  const q = db.prepare('SELECT * FROM quests WHERE id = ?').get(questId) as Row | undefined;
  if (!q || q.status !== 'active') return;
  const steps = db.prepare('SELECT * FROM quest_steps WHERE quest_id = ? ORDER BY idx').all(questId) as Row[];
  const cur = [...steps].reverse().find((s) => s.decree_id);
  if (!cur) return; // cannot happen: step 0 is started at creation
  const d = db.prepare('SELECT * FROM decrees WHERE id = ?').get(cur.decree_id) as Row;
  const events: (() => void)[] = [];

  if (d.status === 'delivered' || d.status === 'approved') {
    const a = db.prepare('SELECT id, owner_id, name FROM agents WHERE id = ?').get(d.agent_id) as Row;
    const next = steps.find((s) => s.idx === cur.idx + 1);
    tx(() => {
      if (d.status === 'delivered') {
        // Auto-approve: the reward leaves the vault for this agent (user-owned agents pay their owner).
        const r = db.prepare("UPDATE decrees SET status = 'approved', finished_at = ? WHERE id = ? AND status = 'delivered'").run(now(), d.id);
        if (Number(r.changes) === 1 && a.owner_id && d.price > 0) {
          db.prepare('UPDATE users SET crowns = crowns + ? WHERE id = ?').run(d.price, a.owner_id);
          ledger(a.owner_id, d.price, 'agent_earning', d.id);
        }
        events.push(() => decreeChanged(d.id));
      }
      if (next) {
        const s = startStep(q, next, steps.length, {
          title: cur.title,
          province: PROVINCE[cur.province as GuildId].name,
          agent: a.name,
          result: d.result,
        });
        events.push(() => {
          watch(s.id, questId);
          logActivity(
            'quest_step',
            cur.province,
            `${a.name} finished step ${cur.idx + 1} of “${q.title}” and passed it to ${s.agent.name} of the ${PROVINCE[next.province as GuildId].name}`,
            a.id,
          );
        });
      } else {
        db.prepare("UPDATE quests SET status = 'complete', finished_at = ? WHERE id = ? AND status = 'active'").run(now(), questId);
        events.push(() => logActivity('quest_done', cur.province, `Quest complete: “${q.title}” · ${steps.length} guilds worked in a chain`, a.id));
      }
    });
  } else if (d.status === 'failed' || d.status === 'cancelled') {
    // The failed/cancelled step was already refunded by the worker or the cancel route.
    // Refund only the steps that never started.
    tx(() => {
      const r = db.prepare("UPDATE quests SET status = 'failed', finished_at = ? WHERE id = ? AND status = 'active'").run(now(), questId);
      if (Number(r.changes) !== 1) return; // already handled
      const back = count("SELECT COALESCE(SUM(share), 0) AS n FROM quest_steps WHERE quest_id = ? AND state = 'pending'", questId);
      db.prepare("UPDATE quest_steps SET state = 'refunded' WHERE quest_id = ? AND state = 'pending'").run(questId);
      if (back > 0) {
        db.prepare('UPDATE users SET crowns = crowns + ? WHERE id = ?').run(back, q.user_id);
        ledger(q.user_id, back, 'refund', questId);
      }
    });
  } else return; // queued or working: nothing to do yet

  for (const e of events) e();
  questChanged(questId);
}

// ---------------- live wiring ----------------
const watched = new Map<string, () => void>(); // decree id -> listener

function watch(decreeId: string, questId: string) {
  if (watched.has(decreeId)) return;
  const on = () =>
    setImmediate(() => {
      try {
        advance(questId);
      } catch (e) {
        console.error('[quests] advance', questId, e);
      }
      questChanged(questId); // streams the step's growing result to quest viewers
      const d = db.prepare('SELECT status FROM decrees WHERE id = ?').get(decreeId) as Row | undefined;
      if (!d || !['queued', 'working', 'delivered'].includes(d.status)) unwatch(decreeId);
    });
  watched.set(decreeId, on);
  bus.on('decree:' + decreeId, on);
}
function unwatch(decreeId: string) {
  const on = watched.get(decreeId);
  if (on) bus.off('decree:' + decreeId, on);
  watched.delete(decreeId);
}

// Safety net for missed events and restarts.
function sweep() {
  const rows = db
    .prepare(
      `SELECT s.quest_id, s.decree_id FROM quest_steps s JOIN quests q ON q.id = s.quest_id
       WHERE q.status = 'active' AND s.decree_id IS NOT NULL AND s.idx = (SELECT MAX(idx) FROM quest_steps x WHERE x.quest_id = s.quest_id AND x.decree_id IS NOT NULL)`,
    )
    .all() as Row[];
  for (const r of rows) {
    try {
      advance(r.quest_id);
    } catch (e) {
      console.error('[quests] sweep', r.quest_id, e);
    }
  }
  // (Re)attach listeners to the steps that are still running.
  for (const r of db
    .prepare(
      `SELECT s.quest_id, s.decree_id FROM quest_steps s JOIN quests q ON q.id = s.quest_id JOIN decrees d ON d.id = s.decree_id
       WHERE q.status = 'active' AND d.status IN ('queued','working','delivered')`,
    )
    .all() as Row[])
    watch(r.decree_id, r.quest_id);
}

let started = false;
export function startQuests() {
  if (started) return;
  started = true;
  setTimeout(sweep, 1500); // after seed + worker startup
  setInterval(sweep, 5000);
}
