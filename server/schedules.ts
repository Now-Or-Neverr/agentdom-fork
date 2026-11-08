// Standing decrees: a user's decree repeated daily or weekly.
// Every run creates a real decree exactly like POST /api/decrees (crowns locked in the vault,
// ledger 'vault_lock', same daily limits). A run that cannot be issued is skipped and recorded.
import { db, now, tx, uid, type Row } from './db';
import { bus, logActivity } from './events';
import { HttpError, agentById, count, crownsEnabled, ledger, lite, startOfDay } from './core';
import type { ProvinceId } from '../shared/realm';
import { SCHEDULE_MAX_ACTIVE, SCHEDULE_PAUSE_AFTER, nextRun, type Cadence, type Schedule, type ScheduleRun } from '../shared/schedules';

db.exec(`
CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  title TEXT NOT NULL,
  brief TEXT NOT NULL,
  price INTEGER NOT NULL,
  cadence TEXT NOT NULL,
  weekday INTEGER,
  hour INTEGER NOT NULL,
  next_run_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  paused_reason TEXT,
  last_decree_id TEXT,
  runs INTEGER NOT NULL DEFAULT 0,
  fail_streak INTEGER NOT NULL DEFAULT 0,
  source_decree_id TEXT,
  ip TEXT,
  is_public INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS schedules_due ON schedules(active, next_run_at);
CREATE INDEX IF NOT EXISTS schedules_user ON schedules(user_id);
CREATE TABLE IF NOT EXISTS schedule_runs (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  run_no INTEGER NOT NULL,
  at TEXT NOT NULL,
  status TEXT NOT NULL, -- issued | skipped
  reason TEXT,
  decree_id TEXT,
  outcome TEXT -- set when the decree ends: ok | failed
);
CREATE INDEX IF NOT EXISTS schedule_runs_s ON schedule_runs(schedule_id, at);
CREATE INDEX IF NOT EXISTS schedule_runs_d ON schedule_runs(decree_id);
CREATE INDEX IF NOT EXISTS schedule_runs_at ON schedule_runs(at);
`);

// Same limits (and env vars) as POST /api/decrees in server/index.ts.
const LIMIT_USER = Number(process.env.DAILY_DECREES_PER_USER) || 5;
const LIMIT_IP = Number(process.env.DAILY_DECREES_PER_IP) || 10;
const LIMIT_GLOBAL = Number(process.env.DAILY_DECREES_GLOBAL) || 200;
// Extra cap only for standing decrees, realm-wide per UTC day.
const SCHEDULED_CAP = () => Number(process.env.SCHEDULED_DECREES_PER_DAY) || 30;

// ---------------- mapping ----------------
export function toSchedule(r: Row, historyLimit = 12): Schedule {
  const a = agentById(r.agent_id);
  const history = (
    db
      .prepare('SELECT r.*, d.status AS d_status FROM schedule_runs r LEFT JOIN decrees d ON d.id = r.decree_id WHERE r.schedule_id = ? ORDER BY r.at DESC LIMIT ?')
      .all(r.id, historyLimit) as Row[]
  ).map(
    (x): ScheduleRun => ({ id: x.id, runNo: x.run_no, at: x.at, status: x.status, reason: x.reason, decreeId: x.decree_id, decreeStatus: x.d_status ?? null }),
  );
  return {
    id: r.id,
    agentId: r.agent_id,
    agent: a ? lite(a) : null,
    title: r.title,
    brief: r.brief,
    price: r.price,
    cadence: r.cadence,
    weekday: r.weekday,
    hour: r.hour,
    nextRunAt: r.next_run_at,
    active: !!r.active,
    pausedReason: r.paused_reason,
    runs: r.runs,
    failStreak: r.fail_streak,
    lastDecreeId: r.last_decree_id,
    createdAt: r.created_at,
    history,
  };
}

const activeCount = (userId: string) => count('SELECT COUNT(*) AS n FROM schedules WHERE user_id = ? AND active = 1', userId);

export function parseCadence(b: Row) {
  const cadence = b.cadence as Cadence;
  if (cadence !== 'daily' && cadence !== 'weekly') throw new HttpError(400, 'A standing decree repeats daily or weekly (no more often than once a day).');
  const hour = Number(b.hour);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new HttpError(400, 'Choose an hour from 0 to 23 (UTC).');
  let weekday: number | null = null;
  if (cadence === 'weekly') {
    weekday = Number(b.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new HttpError(400, 'Choose a weekday.');
  }
  return { cadence, hour, weekday };
}

// Turn one of the user's own decrees into a standing decree (same agent, brief and reward).
export function createSchedule(user: Row, b: Row): Schedule {
  const d = db.prepare('SELECT * FROM decrees WHERE id = ?').get(String(b.decreeId ?? '')) as Row | undefined;
  if (!d || d.user_id !== user.id) throw new HttpError(404, 'Decree not found.');
  if (count('SELECT COUNT(*) AS n FROM quest_steps WHERE decree_id = ?', d.id)) throw new HttpError(400, 'A quest step cannot become a standing decree.');
  const run = db.prepare('SELECT schedule_id FROM schedule_runs WHERE decree_id = ?').get(d.id) as Row | undefined;
  if (run) throw new HttpError(400, 'This decree is already a run of a standing decree.');
  const { cadence, hour, weekday } = parseCadence(b);
  if (activeCount(user.id) >= SCHEDULE_MAX_ACTIVE) throw new HttpError(400, `You can keep up to ${SCHEDULE_MAX_ACTIVE} active standing decrees. Pause or delete one first.`);
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(d.agent_id) as Row;
  if (!agent.active) throw new HttpError(400, `${agent.name} is not taking decrees right now.`);
  const id = uid('sch');
  db.prepare(
    `INSERT INTO schedules (id, user_id, agent_id, title, brief, price, cadence, weekday, hour, next_run_at, active, source_decree_id, ip, is_public, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)`,
  ).run(id, user.id, d.agent_id, d.title, d.brief, d.price, cadence, weekday, hour, nextRun(cadence, hour, weekday).toISOString(), d.id, d.ip ?? '', d.is_public, now());
  return toSchedule(db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as Row);
}

export function ownSchedule(userId: string, id: string) {
  const r = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as Row | undefined;
  if (!r || r.user_id !== userId) throw new HttpError(404, 'Standing decree not found.');
  return r;
}

export function setActive(userId: string, id: string, active: boolean): Schedule {
  const r = ownSchedule(userId, id);
  if (active && !r.active) {
    if (activeCount(userId) >= SCHEDULE_MAX_ACTIVE) throw new HttpError(400, `You can keep up to ${SCHEDULE_MAX_ACTIVE} active standing decrees.`);
    // Resume from the next slot in the future; missed slots are not made up.
    db.prepare('UPDATE schedules SET active = 1, paused_reason = NULL, fail_streak = 0, next_run_at = ? WHERE id = ?').run(
      nextRun(r.cadence, r.hour, r.weekday).toISOString(),
      id,
    );
  } else if (!active && r.active) db.prepare("UPDATE schedules SET active = 0, paused_reason = 'Paused by you.' WHERE id = ?").run(id);
  return toSchedule(db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as Row);
}

export function deleteSchedule(userId: string, id: string) {
  ownSchedule(userId, id);
  tx(() => {
    db.prepare('DELETE FROM schedule_runs WHERE schedule_id = ?').run(id);
    db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
  });
}

// ---------------- running ----------------
function recordFailure(s: Row, why: string) {
  const streak = Number(s.fail_streak) + 1;
  if (streak >= SCHEDULE_PAUSE_AFTER)
    db.prepare('UPDATE schedules SET fail_streak = ?, active = 0, paused_reason = ? WHERE id = ?').run(
      streak,
      `Paused automatically after ${streak} runs in a row did not go through. Last: ${why}`.slice(0, 400),
      s.id,
    );
  else db.prepare('UPDATE schedules SET fail_streak = ? WHERE id = ?').run(streak, s.id);
}

// Why this run cannot be issued right now, or null if it can.
function blocker(s: Row, agent: Row | undefined): string | null {
  const today = startOfDay();
  if (!agent || !agent.active || agent.province === 'throne') return 'The agent is no longer taking decrees.';
  if (count("SELECT COUNT(*) AS n FROM schedule_runs WHERE status = 'issued' AND at >= ?", today) >= SCHEDULED_CAP())
    return 'The realm reached today’s limit for standing decrees.';
  if (count('SELECT COUNT(*) AS n FROM decrees WHERE user_id = ? AND created_at >= ?', s.user_id, today) >= LIMIT_USER)
    return `You already used your ${LIMIT_USER} decrees for today.`;
  if (s.ip && count('SELECT COUNT(*) AS n FROM decrees WHERE ip = ? AND created_at >= ?', s.ip, today) >= LIMIT_IP) return 'Daily decree limit reached for your network.';
  if (count('SELECT COUNT(*) AS n FROM decrees WHERE created_at >= ?', today) >= LIMIT_GLOBAL) return 'The realm reached today’s decree limit.';
  const u = db.prepare('SELECT crowns FROM users WHERE id = ?').get(s.user_id) as Row | undefined;
  if (!u) return 'Account not found.';
  if (crownsEnabled() && u.crowns < s.price) return `Not enough crowns: you had ${u.crowns}, this needs ${s.price}.`;
  return null;
}

// Run one due schedule. Returns the new run row id. Exported for tests.
export function runSchedule(scheduleId: string): { status: 'issued' | 'skipped'; reason: string | null; decreeId: string | null } | null {
  const s = db.prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId) as Row | undefined;
  if (!s || !s.active) return null;
  // Claim this slot: move next_run_at forward first so a run can never happen twice.
  const next = nextRun(s.cadence, s.hour, s.weekday).toISOString();
  const claim = db.prepare('UPDATE schedules SET next_run_at = ? WHERE id = ? AND next_run_at = ? AND active = 1').run(next, s.id, s.next_run_at);
  if (Number(claim.changes) !== 1) return null;

  const runNo = Number(s.runs) + 1;
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(s.agent_id) as Row | undefined;
  const at = now();
  const why = blocker(s, agent);
  if (why) {
    tx(() => {
      db.prepare("INSERT INTO schedule_runs (id, schedule_id, user_id, run_no, at, status, reason) VALUES (?,?,?,?,?, 'skipped', ?)").run(uid('srn'), s.id, s.user_id, runNo, at, why);
      db.prepare('UPDATE schedules SET runs = ? WHERE id = ?').run(runNo, s.id);
      recordFailure(s, why);
    });
    return { status: 'skipped', reason: why, decreeId: null };
  }

  const id = uid('dec');
  const price = crownsEnabled() ? Number(s.price) : 0; // crowns off: each run is free
  const date = at.slice(0, 10);
  const title = `${s.title} · #${runNo}`.slice(0, 140);
  const brief = `${s.brief}\n\n---\nStanding decree, run #${runNo}, ${date} (UTC). This decree repeats ${s.cadence === 'daily' ? 'every day' : 'every week'}; deliver a fresh result for this date.`;
  try {
    tx(() => {
      if (price > 0) {
        const u = db.prepare('SELECT crowns FROM users WHERE id = ?').get(s.user_id) as Row;
        if (u.crowns < price) throw new Error(`Not enough crowns: you had ${u.crowns}, this needs ${price}.`);
        db.prepare('UPDATE users SET crowns = crowns - ? WHERE id = ?').run(price, s.user_id);
        ledger(s.user_id, -price, 'vault_lock', id);
      }
      db.prepare(
        `INSERT INTO decrees (id, user_id, agent_id, commission_id, province, title, brief, price, status, is_public, routed_by, ip, route_reason, eta_minutes, created_at)
         VALUES (?,?,?,NULL,?,?,?,?, 'queued', ?, 'requester', ?, ?, 10, ?)`,
      ).run(id, s.user_id, agent!.id, agent!.province, title, brief, price, s.is_public, s.ip ?? '', `Standing decree run #${runNo} (${s.cadence}).`, at);
      db.prepare("INSERT INTO schedule_runs (id, schedule_id, user_id, run_no, at, status, decree_id) VALUES (?,?,?,?,?, 'issued', ?)").run(uid('srn'), s.id, s.user_id, runNo, at, id);
      db.prepare('UPDATE schedules SET runs = ?, last_decree_id = ? WHERE id = ?').run(runNo, id, s.id);
    });
  } catch (e) {
    const msg = (e as Error).message || 'Could not issue the decree.';
    tx(() => {
      db.prepare("INSERT INTO schedule_runs (id, schedule_id, user_id, run_no, at, status, reason) VALUES (?,?,?,?,?, 'skipped', ?)").run(uid('srn'), s.id, s.user_id, runNo, at, msg);
      db.prepare('UPDATE schedules SET runs = ? WHERE id = ?').run(runNo, s.id);
      recordFailure(s, msg);
    });
    return { status: 'skipped', reason: msg, decreeId: null };
  }
  logActivity('decree_issued', agent!.province as ProvinceId, `A standing decree reached ${agent!.name}: “${title}”`, agent!.id);
  return { status: 'issued', reason: null, decreeId: id };
}

function tick() {
  // Safety net for missed decree events (restarts): settle runs whose decree already ended.
  for (const r of db
    .prepare(
      "SELECT r.decree_id FROM schedule_runs r JOIN decrees d ON d.id = r.decree_id WHERE r.status = 'issued' AND r.outcome IS NULL AND d.status IN ('delivered','approved','failed','cancelled')",
    )
    .all() as Row[])
    onDecree(r.decree_id);
  const due = db.prepare('SELECT id FROM schedules WHERE active = 1 AND next_run_at <= ? ORDER BY next_run_at LIMIT 20').all(now()) as Row[];
  for (const r of due) {
    try {
      const out = runSchedule(r.id);
      if (out) console.log(`[schedules] ${r.id} ${out.status}${out.reason ? ': ' + out.reason : ''}${out.decreeId ? ' → ' + out.decreeId : ''}`);
    } catch (e) {
      console.error('[schedules] run', r.id, e);
    }
  }
}

// The outcome of an issued run follows its decree: failed/cancelled counts toward auto-pause,
// a delivered decree resets the streak.
function onDecree(decreeId: string) {
  const run = db.prepare("SELECT * FROM schedule_runs WHERE decree_id = ? AND status = 'issued' AND outcome IS NULL").get(decreeId) as Row | undefined;
  if (!run) return;
  const d = db.prepare('SELECT status, error FROM decrees WHERE id = ?').get(decreeId) as Row | undefined;
  if (!d) return;
  const s = db.prepare('SELECT * FROM schedules WHERE id = ?').get(run.schedule_id) as Row | undefined;
  if (d.status === 'delivered' || d.status === 'approved') {
    db.prepare("UPDATE schedule_runs SET outcome = 'ok' WHERE id = ?").run(run.id);
    if (s) db.prepare('UPDATE schedules SET fail_streak = 0 WHERE id = ?').run(s.id);
  } else if (d.status === 'failed' || d.status === 'cancelled') {
    db.prepare("UPDATE schedule_runs SET outcome = 'failed', reason = ? WHERE id = ?").run(
      d.status === 'failed' ? `The decree failed${d.error ? ': ' + String(d.error).slice(0, 200) : ''} (refunded).` : 'The decree was cancelled (refunded).',
      run.id,
    );
    if (s) recordFailure(s, d.status === 'failed' ? 'the decree failed.' : 'the decree was cancelled.');
  }
}

let started = false;
export function startSchedules() {
  if (started) return;
  started = true;
  bus.on('decree:any', (id: string) =>
    setImmediate(() => {
      try {
        onDecree(id);
      } catch (e) {
        console.error('[schedules] outcome', id, e);
      }
    }),
  );
  setTimeout(tick, 3000);
  setInterval(tick, 60_000);
}
