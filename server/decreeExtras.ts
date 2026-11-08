// Decree extras: the public share link (read-only result view for non-owners) and the follow-up
// chat (short questions to the same agent after delivery). Mounted under /api by server/index.ts.
//
// Privacy: the public view never carries the brief, revision notes, work log, error, route
// reason, token counts, Bluesky drafts or the follow-up chat. Only the title, agent, status,
// rating/review, the latest delivered result and its files.
//
// Follow-ups run WITHOUT tools: text answers only. That keeps the cost per turn predictable and
// avoids side effects (published pages, social drafts, renders) landing in an already delivered
// or approved decree's artifacts. They never change status, revision, rating or ranks.
import { Router, type Request } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { db, now, uid, type Row } from './db';
import { HttpError, count, currentUser, h, startOfDay, text, toDecree } from './core';
import { listArtifacts } from './artifacts';
import { MODEL, aiEnabled, getClient } from './worker';
import { PROVINCE, type ProvinceId } from '../shared/realm';
import type { Decree } from '../shared/types';
import type { FollowUp, FollowUpThread, ShareState } from '../shared/decreeExtras';

export const router = Router();

const PER_DECREE = Number(process.env.FOLLOWUPS_PER_DECREE) || 10;
const PER_USER = Number(process.env.FOLLOWUPS_PER_USER) || 20;
const GLOBAL = Number(process.env.FOLLOWUPS_GLOBAL) || 300;
const MAX_CHARS = 2000;
const MAX_RUNNING = 4; // simultaneous follow-up answers across the realm

db.exec(`
CREATE TABLE IF NOT EXISTS decree_messages (
  id TEXT PRIMARY KEY,
  decree_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,              -- 'user' | 'assistant'
  content TEXT NOT NULL DEFAULT '',
  reply_to TEXT,                   -- assistant rows: the user message they answer
  status TEXT NOT NULL DEFAULT 'done', -- 'pending' | 'done' | 'failed' (assistant rows)
  error TEXT,
  model TEXT,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS decree_messages_decree ON decree_messages(decree_id, created_at);
CREATE INDEX IF NOT EXISTS decree_messages_user ON decree_messages(user_id, role, created_at);
`);
{
  const cols = db.prepare('PRAGMA table_info(decrees)').all() as Row[];
  if (!cols.some((c) => c.name === 'share_on')) db.exec('ALTER TABLE decrees ADD COLUMN share_on INTEGER NOT NULL DEFAULT 0');
}
// Answers interrupted by a restart cannot resume: mark them failed (they do not count against limits).
db.prepare("UPDATE decree_messages SET status = 'failed', error = 'Interrupted by a server restart. Please ask again.' WHERE status = 'pending'").run();

const running = new Set<string>();

function ownDecree(req: Request): { u: Row; r: Row } {
  const u = currentUser(req);
  const r = db.prepare('SELECT * FROM decrees WHERE id = ?').get(req.params.id) as Row | undefined;
  if (!r || r.user_id !== u.id) throw new HttpError(404, 'Decree not found.');
  return { u, r };
}

type Turn = { ask: string; result: string };
const history = (r: Row): Turn[] => {
  try {
    const v = JSON.parse(r.history || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

/** The latest delivered result: the live one when delivered/approved, else the last delivered version. */
function deliveredResult(r: Row): string {
  if ((r.status === 'delivered' || r.status === 'approved') && String(r.result ?? '').trim()) return r.result;
  const h = history(r);
  return h.length ? String(h[h.length - 1].result ?? '') : '';
}

// ---------------- share ----------------
function shareState(r: Row): ShareState {
  const portfolio = r.status === 'approved' && !!r.is_public;
  const canShare = deliveredResult(r).trim().length > 0;
  return { shared: !!r.share_on, portfolio, open: canShare && (!!r.share_on || portfolio), canShare };
}

router.get(
  '/decrees/:id/share',
  h((req, res) => {
    res.json(shareState(ownDecree(req).r));
  }),
);

router.post(
  '/decrees/:id/share',
  h((req, res) => {
    const { r } = ownDecree(req);
    const on = req.body?.on === true;
    if (on && !shareState(r).canShare) throw new HttpError(400, 'You can share a decree once its result has been delivered.');
    db.prepare('UPDATE decrees SET share_on = ? WHERE id = ?').run(on ? 1 : 0, r.id);
    res.json(shareState({ ...r, share_on: on ? 1 : 0 }));
  }),
);

/** Read-only view for anyone holding the link. Decree-shaped, with every private field emptied. */
function publicView(r: Row): Decree {
    const live = r.status === 'delivered' || r.status === 'approved';
    // While a revision is being written, show the last delivered version and its files.
    const shownRev = live ? r.revision : Math.max(0, r.revision - 1);
    const all = listArtifacts(r.id).filter((a) => a.kind !== 'draft');
    const latest = all.filter((a) => a.revision === shownRev);
    const base = toDecree(r, false);
    return {
      ...base,
      status: live ? r.status : 'delivered',
      result: deliveredResult(r),
      revision: shownRev,
      artifacts: latest.length ? latest : all.filter((a) => a.revision <= shownRev),
      price: 0,
    };
}

const PRIVATE = 'This decree is private or does not exist.';

router.get(
  '/decrees/:id/public',
  h((req, res) => {
    const r = db.prepare('SELECT * FROM decrees WHERE id = ?').get(req.params.id) as Row | undefined;
    if (!r || !shareState(r).open) throw new HttpError(404, PRIVATE);
    res.setHeader('Cache-Control', 'no-store');
    res.json(publicView(r));
  }),
);

/** One call for the decree page: the full decree for its owner, the public view for anyone else. */
router.get(
  '/decrees/:id/view',
  h((req, res) => {
    const r = db.prepare('SELECT * FROM decrees WHERE id = ?').get(req.params.id) as Row | undefined;
    const uidHeader = req.header('x-user');
    res.setHeader('Cache-Control', 'no-store');
    if (r && uidHeader && r.user_id === uidHeader) return void res.json({ mode: 'owner', decree: toDecree(r, true) });
    if (!r || !shareState(r).open) throw new HttpError(404, PRIVATE);
    res.json({ mode: 'public', decree: publicView(r) });
  }),
);

// ---------------- follow-ups ----------------
const toFollowUp = (m: Row): FollowUp => ({
  id: m.id,
  role: m.role,
  content: m.content,
  status: m.status,
  error: m.error ?? null,
  tokensIn: m.tokens_in,
  tokensOut: m.tokens_out,
  createdAt: m.created_at,
});

// A user message counts unless its answer failed.
const COUNTED = `SELECT COUNT(*) AS n FROM decree_messages u WHERE u.role = 'user'
  AND NOT EXISTS (SELECT 1 FROM decree_messages a WHERE a.reply_to = u.id AND a.status = 'failed')`;

function thread(r: Row, userId: string): FollowUpThread {
  const rows = db.prepare('SELECT * FROM decree_messages WHERE decree_id = ? ORDER BY created_at, rowid').all(r.id) as Row[];
  const usedDecree = count(COUNTED + ' AND u.decree_id = ?', r.id);
  const usedToday = count(COUNTED + ' AND u.user_id = ? AND u.created_at >= ?', userId, startOfDay());
  const pending = rows.some((m) => m.status === 'pending');
  let reason: string | null = null;
  if (r.status !== 'delivered' && r.status !== 'approved') reason = 'Follow-ups open once the result is delivered.';
  else if (!aiEnabled()) reason = 'The realm’s AI is not connected right now.';
  else if (pending) reason = 'The agent is answering.';
  else if (usedDecree >= PER_DECREE) reason = `This decree has used its ${PER_DECREE} follow-ups.`;
  else if (usedToday >= PER_USER) reason = `You have used your ${PER_USER} follow-ups for today. Come back tomorrow.`;
  return { messages: rows.map(toFollowUp), open: !reason, reason, usedDecree, perDecree: PER_DECREE, usedToday, perUser: PER_USER, maxChars: MAX_CHARS };
}

router.get(
  '/decrees/:id/followups',
  h((req, res) => {
    const { u, r } = ownDecree(req);
    res.setHeader('Cache-Control', 'no-store');
    res.json(thread(r, u.id));
  }),
);

router.post(
  '/decrees/:id/followups',
  h((req, res) => {
    const { u, r } = ownDecree(req);
    const content = text(req.body?.content, MAX_CHARS, 'Your question');
    const t = thread(r, u.id);
    if (!t.open) throw new HttpError(t.reason === 'The agent is answering.' ? 409 : 429, t.reason ?? 'Follow-ups are closed.');
    if (count(COUNTED + ' AND u.created_at >= ?', startOfDay()) >= GLOBAL) throw new HttpError(429, 'The realm has reached today’s follow-up limit. Try again tomorrow.');
    if (running.size >= MAX_RUNNING) throw new HttpError(429, 'The agents are busy answering other follow-ups. Try again in a minute.');
    const at = now();
    const userId = uid('msg');
    const replyId = uid('msg');
    const a = db.prepare('SELECT model FROM agents WHERE id = ?').get(r.agent_id) as Row | undefined;
    db.prepare("INSERT INTO decree_messages (id, decree_id, user_id, role, content, status, created_at) VALUES (?,?,?,'user',?,'done',?)").run(userId, r.id, u.id, content, at);
    db.prepare("INSERT INTO decree_messages (id, decree_id, user_id, role, content, reply_to, status, model, created_at) VALUES (?,?,?,'assistant','',?,'pending',?,?)").run(
      replyId,
      r.id,
      u.id,
      userId,
      a?.model || MODEL,
      at,
    );
    running.add(replyId);
    void answer(r.id, replyId)
      .catch((e) => console.error('[followup]', r.id, e))
      .finally(() => running.delete(replyId));
    res.json(thread(db.prepare('SELECT * FROM decrees WHERE id = ?').get(r.id) as Row, u.id));
  }),
);

function followUpSystem(a: Row) {
  const p = PROVINCE[a.province as ProvinceId];
  return [
    `You are ${a.name}, an agent of the ${p?.name ?? 'realm'}${p ? ` (${p.craft})` : ''} in Agentdom, a kingdom of AI agents.`,
    `Your role: ${a.title}.`,
    a.instructions,
    '',
    'This is a follow-up chat about a decree you already delivered. The decree, your latest delivered result and the earlier follow-ups come first; answer the newest follow-up.',
    'Rules for follow-ups:',
    '- Answer directly in clean Markdown, in the language of the follow-up. No preamble and no restating the question.',
    '- Keep it as short as the request allows. When asked to rewrite, shorten or continue a part, give that part in full.',
    '- You have no tools in this chat. Do not claim to look anything up, browse, run code, or make files, images, videos or pages. If the request needs that, say so in one line and suggest issuing a new decree.',
    '- Never invent urls, numbers, quotes or sources. Only reuse links that already appear in the result.',
    '- Do not add an "Agent\'s notes" section.',
  ].join('\n');
}

async function answer(decreeId: string, replyId: string) {
  const r = db.prepare('SELECT * FROM decrees WHERE id = ?').get(decreeId) as Row;
  const a = db.prepare('SELECT * FROM agents WHERE id = ?').get(r.agent_id) as Row;
  const rows = db.prepare('SELECT * FROM decree_messages WHERE decree_id = ? ORDER BY created_at, rowid').all(decreeId) as Row[];
  const reply = rows.find((m) => m.id === replyId)!;
  const ask = rows.find((m) => m.id === reply.reply_to)!;

  // Earlier finished pairs (latest 8), oldest first.
  const pairs: { q: string; a: string }[] = [];
  for (const m of rows) {
    if (m.role !== 'assistant' || m.status !== 'done' || !m.content.trim() || m.id === replyId) continue;
    const q = rows.find((x) => x.id === m.reply_to);
    if (q) pairs.push({ q: q.content, a: m.content });
  }
  const result = deliveredResult(r);
  const msgs: Anthropic.Beta.BetaMessageParam[] = [
    { role: 'user', content: `Decree: ${r.title}\n\n${r.brief}` },
    { role: 'assistant', content: (result.length > 60_000 ? result.slice(0, 60_000) + '\n\n[…result truncated…]' : result) || '(empty result)' },
  ];
  for (const p of pairs.slice(-8)) msgs.push({ role: 'user', content: `Follow-up: ${p.q}` }, { role: 'assistant', content: p.a });
  msgs.push({ role: 'user', content: `Follow-up: ${ask.content}` });

  let buf = '';
  let last = 0;
  const save = (force = false) => {
    if (!force && Date.now() - last < 350) return;
    last = Date.now();
    db.prepare('UPDATE decree_messages SET content = ? WHERE id = ?').run(buf, replyId);
  };
  const finish = (status: 'done' | 'failed', error: string | null, tin = 0, tout = 0) =>
    db.prepare('UPDATE decree_messages SET content = ?, status = ?, error = ?, tokens_in = ?, tokens_out = ? WHERE id = ?').run(buf, status, error, tin, tout, replyId);

  try {
    const stream = getClient().beta.messages.stream({
      model: a.model || MODEL,
      max_tokens: 6000,
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: followUpSystem(a),
      messages: msgs,
    });
    stream.on('text', (t) => {
      buf += t;
      save();
    });
    const final = await stream.finalMessage();
    const tin = final.usage.input_tokens;
    const tout = final.usage.output_tokens;
    if (final.stop_reason === 'refusal') return finish('failed', 'The agent declined this follow-up because it conflicts with the model’s safety rules.', tin, tout);
    if (!buf.trim()) return finish('failed', 'The agent returned an empty answer.', tin, tout);
    if (final.stop_reason === 'max_tokens') buf += '\n\n> System note: the answer was cut off at the maximum length.';
    finish('done', null, tin, tout);
  } catch (e) {
    let msg = 'Something went wrong while contacting Claude.';
    if (e instanceof Anthropic.RateLimitError) msg = 'API rate limit reached. Try again later.';
    else if (e instanceof Anthropic.APIError) msg = `API error ${e.status ?? ''}`.trim() + '.';
    console.error('[followup]', decreeId, e);
    finish('failed', msg);
  }
}
