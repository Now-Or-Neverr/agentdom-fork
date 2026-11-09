// The Royal Gazette: a daily edition (UTC) assembled from real rows only:
// that day's duties (each with its source link), public approved decrees (title, agent,
// rating — never briefs or results), completed quest counts and the week's guild standings.
// Today's edition is computed live. Past editions are frozen into `gazette_editions`
// the first time they are asked for (or by the hourly archiver) and never change after.
import { db, now, type Row } from './db';
import { toDuty } from './duties';
import { standings, weekStart } from './rivalry';
import * as I from './integrations';
import type { ProvinceId } from '../shared/realm';
import type { Duty } from '../shared/live';
import type { GazetteEdition, GazetteOnThisDay, GazetteSection } from '../shared/gazette';

db.exec(`
CREATE TABLE IF NOT EXISTS gazette_editions (
  date TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  archived_at TEXT NOT NULL
);
`);

const DAY = 86400_000;
export const todayUtc = () => new Date().toISOString().slice(0, 10);
export const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;

// Section order and names on the front page.
const SECTIONS: { id: string; name: string; province: ProvinceId }[] = [
  { id: 'heralds', name: 'Heralds', province: 'heralds' },
  { id: 'treasury', name: 'Treasury', province: 'treasury' },
  { id: 'bazaar', name: 'Bazaar', province: 'bazaar' },
  { id: 'court', name: 'Court', province: 'court' },
  { id: 'archive', name: 'Archive', province: 'archive' },
  { id: 'forge', name: 'Forge', province: 'forge' },
  { id: 'weather', name: 'Weather & Calendar', province: 'throne' },
  { id: 'scriptorium', name: 'Word of the Day', province: 'scriptorium' },
  { id: 'theatre', name: 'Theatre', province: 'theatre' },
  { id: 'atelier', name: 'Atelier', province: 'atelier' },
  { id: 'observatory', name: 'Observatory', province: 'observatory' },
  { id: 'apothecary', name: 'Apothecary', province: 'apothecary' },
  { id: 'arena', name: 'Arena', province: 'arena' },
];
const PER_SECTION = 4;

// Live "On this day" for today's edition when no archive duty has run yet (cached per date).
const otdCache = new Map<string, { at: number; v: GazetteOnThisDay | null; err: string | null }>();
async function liveOnThisDay(date: string): Promise<{ v: GazetteOnThisDay | null; err: string | null }> {
  const hit = otdCache.get(date);
  if (hit && (hit.v || Date.now() - hit.at < 5 * 60_000)) return hit;
  const [, m, d] = date.split('-').map(Number);
  let out: { at: number; v: GazetteOnThisDay | null; err: string | null };
  try {
    const r = await I.wikiOnThisDay({ context: 'realm', ref: 'gazette' }, m, d, 5);
    out = { at: Date.now(), v: { month: r.month, day: r.day, events: r.events, sourceUrl: r.sourceUrl, fetchedAt: r.fetchedAt }, err: null };
  } catch (e) {
    out = { at: Date.now(), v: null, err: `Wikipedia did not answer: ${(e as Error).message}` };
  }
  otdCache.clear();
  otdCache.set(date, out);
  return out;
}

function onThisDayFromDuties(duties: Duty[], date: string): GazetteOnThisDay | null {
  const rows = duties.filter((d) => d.kind === 'on_this_day').sort((a, b) => a.at.localeCompare(b.at));
  if (!rows.length) return null;
  const [, m, d] = date.split('-').map(Number);
  const events = rows.map((r) => {
    const x = (r.data ?? {}) as Record<string, any>;
    return { year: Number(x.year), text: String(x.text ?? r.summary), pageTitle: x.page ?? null, url: x.pageUrl ?? r.sourceUrl };
  });
  return { month: m, day: d, events: events.sort((a, b) => a.year - b.year), sourceUrl: `https://en.wikipedia.org/wiki/${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]}_${d}`, fetchedAt: rows[0].at };
}

export function editionDates(limit = 120): string[] {
  const rows = db
    .prepare(
      `SELECT d FROM (
         SELECT DISTINCT substr(at, 1, 10) AS d FROM duties
         UNION SELECT DISTINCT substr(COALESCE(finished_at, delivered_at), 1, 10) FROM decrees WHERE status = 'approved' AND COALESCE(finished_at, delivered_at) IS NOT NULL
         UNION SELECT date FROM gazette_editions
       ) WHERE d IS NOT NULL ORDER BY d DESC LIMIT ?`,
    )
    .all(limit) as Row[];
  const out = rows.map((r) => r.d as string).filter((d) => d <= todayUtc());
  if (!out.includes(todayUtc())) out.unshift(todayUtc());
  return out;
}

async function compute(date: string, live: boolean): Promise<GazetteEdition> {
  const from = date + 'T00:00:00.000Z';
  const to = new Date(Date.parse(from) + DAY).toISOString();
  const duties = (db.prepare('SELECT * FROM duties WHERE at >= ? AND at < ? ORDER BY at DESC').all(from, to) as Row[]).map(toDuty);

  // Lead story: the newest Hacker News front-page report, else the newest duty of the day.
  const lead = duties.find((d) => d.kind === 'hn_top') ?? duties.find((d) => d.kind !== 'on_this_day') ?? null;

  const sections: GazetteSection[] = [];
  for (const s of SECTIONS) {
    const seen = new Set<string>();
    const items: Duty[] = [];
    for (const d of duties) {
      if (d.province !== s.province || d.kind === 'on_this_day' || d.id === lead?.id) continue;
      const key = d.kind + ':' + String((d.data as Record<string, unknown> | null)?.key ?? d.id);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(d);
      if (items.length >= PER_SECTION) break;
    }
    if (items.length) sections.push({ ...s, items });
  }

  let onThisDay = onThisDayFromDuties(duties, date);
  let onThisDayError: string | null = null;
  if (!onThisDay && live) {
    const r = await liveOnThisDay(date);
    onThisDay = r.v;
    onThisDayError = r.err;
  }

  const decrees = (
    db
      .prepare(
        `SELECT d.id, d.title, d.province, d.agent_id, d.rating, COALESCE(d.finished_at, d.delivered_at) AS at, a.name AS agent_name
         FROM decrees d JOIN agents a ON a.id = d.agent_id
         WHERE d.status = 'approved' AND d.is_public = 1 AND COALESCE(d.finished_at, d.delivered_at) >= ? AND COALESCE(d.finished_at, d.delivered_at) < ?
         ORDER BY at DESC LIMIT 12`,
      )
      .all(from, to) as Row[]
  ).map((r) => ({ id: r.id, title: r.title, province: r.province, agentId: r.agent_id, agentName: r.agent_name, rating: r.rating ?? null, at: r.at }));

  const n = (sql: string) => Number((db.prepare(sql).get(from, to) as Row).n);
  const decreesApproved = n("SELECT COUNT(*) AS n FROM decrees WHERE status = 'approved' AND COALESCE(finished_at, delivered_at) >= ? AND COALESCE(finished_at, delivered_at) < ?");
  const questsCompleted = n("SELECT COUNT(*) AS n FROM quests WHERE status = 'complete' AND finished_at >= ? AND finished_at < ?");

  // Standings: the ISO week up to the end of this day (same rules as the rivalry).
  const wk = weekStart(new Date(from)).toISOString();
  const dutyCount = new Map((db.prepare('SELECT province, COUNT(*) AS n FROM duties WHERE at >= ? AND at < ? GROUP BY province').all(from, to) as Row[]).map((r) => [r.province, Number(r.n)]));
  const list = standings(wk, to).map((s) => ({ ...s, duties: dutyCount.get(s.province) ?? 0 }));

  const dates = editionDates(400);
  const i = dates.indexOf(date);
  const prev = i >= 0 ? (dates[i + 1] ?? null) : (dates.find((d) => d < date) ?? null);
  const next = i > 0 ? dates[i - 1] : i === -1 ? ([...dates].reverse().find((d) => d > date) ?? null) : null;

  return {
    date,
    live,
    archivedAt: null,
    lead,
    sections,
    onThisDay,
    onThisDayError,
    decrees,
    stats: { duties: duties.length, decreesApproved, questsCompleted, publicDecrees: decrees.length },
    standings: list,
    prev,
    next,
    generatedAt: now(),
  };
}

function relink(e: GazetteEdition): GazetteEdition {
  // prev/next may gain new neighbours after archiving (e.g. a newer day), so refresh them.
  const dates = editionDates(400);
  const i = dates.indexOf(e.date);
  if (i === -1) return e;
  return { ...e, prev: dates[i + 1] ?? null, next: i > 0 ? dates[i - 1] : null };
}

export async function edition(date: string): Promise<GazetteEdition> {
  const t = todayUtc();
  if (date > t) throw new Error('That edition has not been printed yet.');
  if (date === t) return compute(date, true);
  const hit = db.prepare('SELECT data, archived_at FROM gazette_editions WHERE date = ?').get(date) as Row | undefined;
  if (hit) return relink({ ...(JSON.parse(hit.data) as GazetteEdition), archivedAt: hit.archived_at });
  const e = await compute(date, false);
  // Days with no content are not stored (any past date can be asked for).
  if (!e.stats.duties && !e.stats.decreesApproved && !e.stats.questsCompleted) return e;
  const at = now();
  db.prepare('INSERT OR IGNORE INTO gazette_editions (date, data, archived_at) VALUES (?,?,?)').run(date, JSON.stringify(e), at);
  return { ...e, archivedAt: at };
}

/** Freeze every finished day that has content but no archived edition yet. */
export async function archivePastEditions() {
  const t = todayUtc();
  const missing = editionDates(60).filter((d) => d < t && !db.prepare('SELECT 1 FROM gazette_editions WHERE date = ?').get(d));
  for (const d of missing) {
    try {
      await edition(d);
    } catch (e) {
      console.warn('[gazette] archive failed for', d, (e as Error).message);
    }
  }
}

let archiver = false;
export function startGazetteArchiver() {
  if (archiver) return;
  archiver = true;
  const run = () => void archivePastEditions();
  setTimeout(run, 20_000).unref?.();
  setInterval(run, 30 * 60_000).unref?.();
}
