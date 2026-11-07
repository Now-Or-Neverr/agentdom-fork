// Weekly guild rivalry (ISO week, UTC). Only real user work counts: approved decrees,
// their average rating and the crowns they earned. Automatic duties are not counted.
import { db, type Row } from './db';
import { GUILDS, type ProvinceId } from '../shared/realm';
import type { GuildStanding, Rivalry } from '../shared/gazette';

const DAY = 86400_000;

/** Monday 00:00 UTC of the ISO week that contains `d`. */
export function weekStart(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(x.getTime() - dow * DAY);
}

/** ISO week label, e.g. "2026-W45". */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7)); // Thursday of this week
  const year = t.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round((t.getTime() - weekStart(jan4).getTime()) / (7 * DAY));
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Monday 00:00 UTC of an ISO week label, or null if invalid. */
export function parseWeek(s: string): Date | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) return null;
  const start = new Date(weekStart(new Date(Date.UTC(year, 0, 4))).getTime() + (week - 1) * 7 * DAY);
  return isoWeek(start) === s.trim() ? start : null;
}

/** Guild standings from decrees approved in [from, to). */
export function standings(from: string, to: string): GuildStanding[] {
  const rows = db
    .prepare(
      `SELECT province, COUNT(*) AS n, AVG(rating) AS r, COALESCE(SUM(price), 0) AS c, MAX(COALESCE(finished_at, delivered_at)) AS last
       FROM decrees
       WHERE status = 'approved' AND COALESCE(finished_at, delivered_at) >= ? AND COALESCE(finished_at, delivered_at) < ?
       GROUP BY province`,
    )
    .all(from, to) as Row[];
  const by = new Map(rows.map((r) => [r.province as string, r]));
  return GUILDS.map((g) => {
    const r = by.get(g.id);
    return {
      province: g.id,
      name: g.name,
      approved: Number(r?.n ?? 0),
      rating: r?.r == null ? null : Math.round(Number(r.r) * 10) / 10,
      crowns: Number(r?.c ?? 0),
      last: (r?.last as string | undefined) ?? '',
    };
  })
    // ties: the guild that reached its score first leads
    .sort((a, b) => b.approved - a.approved || b.crowns - a.crowns || (b.rating ?? 0) - (a.rating ?? 0) || a.last.localeCompare(b.last) || a.name.localeCompare(b.name))
    .map(({ last: _l, ...s }) => s);
}

export function rivalry(week?: string): Rivalry {
  const start = week ? parseWeek(week) : weekStart(new Date());
  if (!start) throw new Error('week must look like 2026-W45.');
  const end = new Date(start.getTime() + 7 * DAY);
  const list = standings(start.toISOString(), end.toISOString());
  const top = list[0];
  const thisWeek = weekStart(new Date()).getTime();
  return {
    week: isoWeek(start),
    start: start.toISOString(),
    end: end.toISOString(),
    standings: list,
    champion: top && top.approved > 0 ? (top.province as ProvinceId) : null,
    prevWeek: isoWeek(new Date(start.getTime() - 7 * DAY)),
    nextWeek: start.getTime() < thisWeek ? isoWeek(end) : null,
  };
}

// Champion of the current week, cached briefly (asked by every /realm/live poll).
let cache: { at: number; v: ProvinceId | null } | null = null;
export function currentChampion(): ProvinceId | null {
  if (cache && Date.now() - cache.at < 15_000) return cache.v;
  const v = rivalry().champion;
  cache = { at: Date.now(), v };
  return v;
}
