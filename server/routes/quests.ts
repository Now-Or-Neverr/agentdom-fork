// Routes for the quests feature. Mounted under /api by server/index.ts.
// Privacy: a quest (like a decree) is visible only to its requester; other users get 404.
import { Router, type Request } from 'express';
import { db, type Row } from '../db';
import { bus } from '../events';
import { HttpError, allAgents, count, crownsEnabled, currentUser, h, optionalUser, startOfDay, text } from '../core';
import { TEMPLATES, createQuestRows, questChanged, startQuests, templateById, toQuest } from '../quests';
import { PROVINCE, isProvince } from '../../shared/realm';
import {
  QUEST_MAX_REWARD,
  QUEST_MAX_SHARE,
  QUEST_MAX_STEPS,
  QUEST_MIN_SHARE,
  QUEST_MIN_STEPS,
  splitReward,
  type GuildId,
} from '../../shared/quests';

export const router = Router();
startQuests();

// Same limits (and env vars) as POST /api/decrees in server/index.ts.
const LIMIT_USER = Number(process.env.DAILY_DECREES_PER_USER) || 5;
const LIMIT_IP = Number(process.env.DAILY_DECREES_PER_IP) || 10;
const LIMIT_GLOBAL = Number(process.env.DAILY_DECREES_GLOBAL) || 200;

// Steps of active quests that have no decree yet still count against today's limits.
const reserved = (where: string, ...args: string[]) =>
  count(
    `SELECT COUNT(*) AS n FROM quest_steps s JOIN quests q ON q.id = s.quest_id WHERE q.status = 'active' AND s.state = 'pending'${where}`,
    ...args,
  );

router.get('/quests/templates', (_req, res) => {
  res.json(TEMPLATES);
});

router.get(
  '/quests/mine',
  h((req, res) => {
    const u = currentUser(req);
    const rows = db.prepare('SELECT * FROM quests WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(u.id) as Row[];
    res.json(rows.map((r) => toQuest(r, true)));
  }),
);

function ownQuest(req: Request, userId?: string) {
  const u = userId !== undefined ? optionalUser(userId) : currentUser(req);
  if (!u) throw new HttpError(401, 'Session not found.');
  const q = db.prepare('SELECT * FROM quests WHERE id = ?').get(req.params.id) as Row | undefined;
  if (!q || q.user_id !== u.id) throw new HttpError(404, 'Quest not found.');
  return { u, q };
}

router.get(
  '/quests/:id',
  h((req, res) => {
    res.json(toQuest(ownQuest(req).q, true));
  }),
);

// Live stream (EventSource can't send headers, so the user id comes in the query).
router.get('/quests/:id/stream', (req, res) => {
  let q: Row;
  try {
    q = ownQuest(req, String(req.query.u ?? '')).q;
  } catch (e) {
    res.status(e instanceof HttpError ? e.status : 500).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  let last = '';
  const push = () => {
    const r = db.prepare('SELECT * FROM quests WHERE id = ?').get(q.id) as Row;
    const payload = JSON.stringify(toQuest(r, true));
    if (payload !== last) {
      last = payload;
      res.write(`data: ${payload}\n\n`);
    }
  };
  push();
  bus.on('quest:' + q.id, push);
  req.on('close', () => {
    clearInterval(ping);
    bus.off('quest:' + q.id, push);
  });
});

router.post(
  '/quests',
  h((req, res) => {
    const u = currentUser(req);
    const b = req.body ?? {};
    const title = text(b.title, 100, 'Quest title');
    const subject = text(b.subject, 3000, 'Subject');
    const tpl = b.templateId ? templateById(b.templateId) : undefined;
    if (b.templateId && !tpl) throw new HttpError(404, 'Quest template not found.');

    let chain: { province: GuildId; title: string; instruction: string; weight: number }[];
    if (tpl) chain = tpl.steps.map((s) => ({ ...s }));
    else {
      if (!Array.isArray(b.steps)) throw new HttpError(400, 'Choose a template or add steps.');
      chain = b.steps.map((s: Row, i: number) => {
        if (!isProvince(s?.province) || s.province === 'throne') throw new HttpError(400, `Step ${i + 1}: choose a guild.`);
        const p = PROVINCE[s.province as GuildId];
        return {
          province: s.province as GuildId,
          title: text(s.title, 60, `Step ${i + 1} title`, false) || p.craft,
          instruction: text(s.instruction, 1000, `Step ${i + 1} instructions`),
          weight: 1,
        };
      });
    }
    const n = chain.length;
    if (n < QUEST_MIN_STEPS || n > QUEST_MAX_STEPS) throw new HttpError(400, `A quest has ${QUEST_MIN_STEPS} to ${QUEST_MAX_STEPS} steps.`);
    if (new Set(chain.map((s) => s.province)).size !== n) throw new HttpError(400, 'Each step must be handled by a different guild.');
    const agents = [...allAgents().values()];
    for (const s of chain)
      if (!agents.some((a) => a.province === s.province && a.active)) throw new HttpError(400, `The ${PROVINCE[s.province].name} has no active agent right now.`);

    const reward = Math.round(Number(b.reward));
    if (!(reward >= QUEST_MIN_SHARE * n && reward <= QUEST_MAX_REWARD))
      throw new HttpError(400, `The reward must be between ${QUEST_MIN_SHARE * n} and ${QUEST_MAX_REWARD} crowns for ${n} steps.`);
    const shares = splitReward(reward, chain.map((s) => s.weight));
    if (shares.some((x) => x < QUEST_MIN_SHARE || x > QUEST_MAX_SHARE) || shares.reduce((s, x) => s + x, 0) !== reward)
      throw new HttpError(400, `Each step's share must be between ${QUEST_MIN_SHARE} and ${QUEST_MAX_SHARE} crowns.`);
    if (crownsEnabled() && u.crowns < reward) throw new HttpError(400, `Not enough crowns. You have ${u.crowns}, this quest needs ${reward}.`);

    // A quest counts as n decrees against the daily limits; check room for every step now.
    const ip = req.ip ?? '';
    const today = startOfDay();
    const userUsed = count('SELECT COUNT(*) AS n FROM decrees WHERE user_id = ? AND created_at >= ?', u.id, today) + reserved(' AND q.user_id = ?', u.id);
    if (userUsed + n > LIMIT_USER)
      throw new HttpError(429, `This quest needs ${n} of your ${LIMIT_USER} daily decrees and you have ${Math.max(0, LIMIT_USER - userUsed)} left today.`);
    if (ip) {
      const ipUsed = count('SELECT COUNT(*) AS n FROM decrees WHERE ip = ? AND created_at >= ?', ip, today) + reserved(' AND q.ip = ?', ip);
      if (ipUsed + n > LIMIT_IP) throw new HttpError(429, 'Not enough decrees left today on this network for a quest this long.');
    }
    if (count('SELECT COUNT(*) AS n FROM decrees WHERE created_at >= ?', today) + reserved('') + n > LIMIT_GLOBAL)
      throw new HttpError(429, 'The realm is close to today’s decree limit. Try a shorter quest or come back tomorrow.');

    const id = createQuestRows(
      u,
      ip,
      tpl?.id ?? null,
      title,
      subject,
      reward,
      chain.map((s, i) => ({ province: s.province, title: s.title, instruction: s.instruction, share: shares[i] })),
    );
    res.json(toQuest(db.prepare('SELECT * FROM quests WHERE id = ?').get(id) as Row, true));
  }),
);

router.post(
  '/quests/:id/rate',
  h((req, res) => {
    const { q } = ownQuest(req);
    if (q.status !== 'complete') throw new HttpError(400, 'You can rate a quest once every step is delivered.');
    const rating = Math.round(Number(req.body?.rating));
    if (!(rating >= 1 && rating <= 5)) throw new HttpError(400, 'Give a rating from 1 to 5.');
    const review = text(req.body?.review, 500, 'Review', false) || null;
    db.prepare('UPDATE quests SET rating = ?, review = ? WHERE id = ?').run(rating, review, q.id);
    questChanged(q.id);
    res.json(toQuest(db.prepare('SELECT * FROM quests WHERE id = ?').get(q.id) as Row, true));
  }),
);
