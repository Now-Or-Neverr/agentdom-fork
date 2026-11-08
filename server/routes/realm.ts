// Live realm routes: what every agent is doing, duties, the Royal Gazette, the weekly
// guild rivalry and the festival bonus. Mounted under /api by server/index.ts.
import { Router, type Request } from 'express';
import { db, now, tx, type Row } from '../db';
import { HttpError, crownsEnabled, currentUser, h, ledger } from '../core';
import { runningDecrees } from '../worker';
import { logActivity } from '../events';
import { dutyInProgress, recentDutyByAgent, toDuty } from '../duties';
import { edition, editionDates, isDate, startGazetteArchiver, todayUtc } from '../gazette';
import { currentChampion, rivalry } from '../rivalry';
import * as I from '../integrations';
import { isProvince } from '../../shared/realm';
import type { LiveAgent, RealmLive } from '../../shared/live';
import type { FestivalClaimStatus } from '../../shared/gazette';

export const router = Router();

startGazetteArchiver();

const FESTIVAL_BONUS = 50;

db.exec(`
CREATE TABLE IF NOT EXISTS festival_claims (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  country TEXT NOT NULL,
  holiday TEXT NOT NULL,
  amount INTEGER NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (user_id, date)
);
`);

// decrees.now_doing (live line such as "Searching OpenAlex for …") may not exist yet.
let nowDoingCheck = { at: 0, has: false };
function hasNowDoing(): boolean {
  if (Date.now() - nowDoingCheck.at > 30_000) {
    const cols = db.prepare('PRAGMA table_info(decrees)').all() as Row[];
    nowDoingCheck = { at: Date.now(), has: cols.some((c) => c.name === 'now_doing') };
  }
  return nowDoingCheck.has;
}

// The map is public but now_doing may quote the private brief, e.g.
// 'Searching OpenAlex for “solar batteries”' → 'Searching OpenAlex'.
export function publicNowDoing(s: unknown): string {
  if (typeof s !== 'string') return '';
  let t = s.replace(/\s*(?:\b(?:for|on|about)\s+)?(?:“[^”]*(?:”|$)|"[^"]*(?:"|$)|‘[^’]*(?:’|$)|«[^»]*(?:»|$))/gi, '');
  t = t.replace(/\s+/g, ' ').trim();
  // drop dangling connectors and punctuation left behind ("Reading Wikipedia and" → "Reading Wikipedia")
  for (let prev = ''; prev !== t; ) {
    prev = t;
    t = t.replace(/(?:\.\.\.|…|[\s:,;–—-])+$/, '').replace(/\s+(?:for|on|about|and|or|with|in|to|of)$/i, '').trim();
  }
  return t;
}

export function liveAgents(): LiveAgent[] {
  const agents = db.prepare('SELECT * FROM agents WHERE active = 1 ORDER BY created_at').all() as Row[];
  const ids = [...runningDecrees()];
  const working = new Map<string, Row>();
  if (ids.length) {
    const cols = hasNowDoing() ? ', now_doing' : '';
    const rows = db.prepare(`SELECT id, agent_id, title, started_at${cols} FROM decrees WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as Row[];
    for (const r of rows) working.set(r.agent_id, r);
  }
  const duties = recentDutyByAgent();
  const doing = dutyInProgress();
  return agents.map((a) => {
    const w = working.get(a.id);
    const d = duties.get(a.id);
    const base = { id: a.id, name: a.name, province: a.province, role: a.role, look: a.look, color: a.color };
    if (w) {
      const task = publicNowDoing(w.now_doing) || `Working on “${w.title}”`;
      return { ...base, state: 'working', task, since: w.started_at, decreeId: w.id, dutyId: null };
    }
    if (doing && doing.agentId === a.id) return { ...base, state: 'duty', task: doing.task, since: doing.since, decreeId: null, dutyId: null };
    if (d) return { ...base, state: 'duty', task: d.summary, since: d.at, decreeId: null, dutyId: d.id };
    return { ...base, state: 'idle', task: null, since: null, decreeId: null, dutyId: null };
  });
}

router.get(
  '/realm/live',
  h((_req, res) => {
    const out: RealmLive = { agents: liveAgents(), champion: currentChampion(), at: new Date().toISOString() };
    res.json(out);
  }),
);

// ---------------- duties ----------------
const q = (req: Request, k: string) => (typeof req.query[k] === 'string' ? (req.query[k] as string).trim() : '');

router.get(
  '/duties',
  h((req, res) => {
    const where: string[] = [];
    const args: string[] = [];
    const province = q(req, 'province');
    const agent = q(req, 'agent');
    const kind = q(req, 'kind');
    if (province) {
      if (!isProvince(province)) throw new HttpError(400, 'Unknown province.');
      where.push('province = ?');
      args.push(province);
    }
    if (agent) {
      where.push('agent_id = ?');
      args.push(agent);
    }
    if (kind) {
      where.push('kind = ?');
      args.push(kind);
    }
    const limit = Math.min(100, Math.max(1, Number(q(req, 'limit')) || 20));
    const rows = db.prepare(`SELECT * FROM duties ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY at DESC LIMIT ${limit}`).all(...args) as Row[];
    res.json({ duties: rows.map(toDuty), at: now() });
  }),
);

router.get(
  '/duties/:id',
  h((req, res) => {
    const r = db.prepare('SELECT * FROM duties WHERE id = ?').get(String(req.params.id)) as Row | undefined;
    if (!r) throw new HttpError(404, 'No such duty.');
    res.json(toDuty(r));
  }),
);

// ---------------- gazette ----------------
router.get(
  '/gazette/dates',
  h((_req, res) => {
    res.json({ dates: editionDates(120), today: todayUtc() });
  }),
);

router.get(
  '/gazette',
  h(async (req, res) => {
    const date = q(req, 'date') || todayUtc();
    if (!isDate(date)) throw new HttpError(400, 'date must be YYYY-MM-DD.');
    if (date > todayUtc()) throw new HttpError(404, 'That edition has not been printed yet.');
    res.json(await edition(date));
  }),
);

// ---------------- rivalry ----------------
router.get(
  '/rivalry',
  h((req, res) => {
    try {
      res.json(rivalry(q(req, 'week') || undefined));
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
  }),
);

// ---------------- festival bonus ----------------
function countryParam(req: Request): string {
  const c = (q(req, 'country') || 'US').toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) throw new HttpError(400, 'country must be a two-letter code such as ID or US.');
  return c;
}
async function festivalFor(country: string) {
  try {
    return await I.festival(country, { context: 'realm', ref: 'festival' });
  } catch (e) {
    if (e instanceof I.UpstreamError && (e.status === 404 || e.status === 400)) throw new HttpError(400, `Nager.Date has no holiday calendar for ${country}.`);
    if (e instanceof I.UpstreamError) throw new HttpError(502, `Nager.Date did not answer: ${e.message}`);
    throw new HttpError(400, (e as Error).message);
  }
}

router.get(
  '/festival/claim-status',
  h(async (req, res) => {
    const user = currentUser(req);
    const country = countryParam(req);
    const f = await festivalFor(country);
    const claimed = !!(f.today && db.prepare('SELECT 1 FROM festival_claims WHERE user_id = ? AND date = ?').get(user.id, f.today.date));
    const out: FestivalClaimStatus = { country, today: f.today, next: f.next, claimed, bonus: FESTIVAL_BONUS };
    res.json(out);
  }),
);

router.post(
  '/festival/claim',
  h(async (req, res) => {
    const user = currentUser(req);
    if (!crownsEnabled()) throw new HttpError(403, 'Festival bonuses return when crowns open.');
    const country = countryParam(req);
    const f = await festivalFor(country);
    const fest = f.today;
    if (!fest) throw new HttpError(400, 'No festival today.');
    const ok = tx(() => {
      const r = db
        .prepare('INSERT OR IGNORE INTO festival_claims (user_id, date, country, holiday, amount, at) VALUES (?,?,?,?,?,?)')
        .run(user.id, fest.date, country, fest.name, FESTIVAL_BONUS, now());
      if (!r.changes) return false;
      db.prepare('UPDATE users SET crowns = crowns + ? WHERE id = ?').run(FESTIVAL_BONUS, user.id);
      ledger(user.id, FESTIVAL_BONUS, 'festival_bonus', `${country}:${fest.date}`);
      return true;
    });
    if (!ok) throw new HttpError(400, `You already claimed the festival bonus for ${fest.date}.`);
    logActivity('festival', 'throne', `A citizen celebrated ${fest.name} (${country}) and received ${FESTIVAL_BONUS} crowns from the Crown`, null);
    const u = db.prepare('SELECT crowns FROM users WHERE id = ?').get(user.id) as Row;
    res.json({ ok: true, festival: fest, bonus: FESTIVAL_BONUS, crowns: u.crowns });
  }),
);
