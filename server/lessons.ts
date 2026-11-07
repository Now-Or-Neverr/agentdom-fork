// Lessons learned: when a requester approves a decree with a rating, or asks for a revision,
// one small Claude call distills 0–2 general, reusable craft lessons for that agent.
// Private details (names, brief text, the requester's personal preferences) are never stored.
// Each approval / revision is learned once, also across restarts (table lesson_sources).
import Anthropic from '@anthropic-ai/sdk';
import { db, now, uid, type Row } from './db';
import { bus } from './events';
import { PROVINCE, type ProvinceId } from '../shared/realm';
import type { Lesson } from '../shared/court';

db.exec(`
CREATE TABLE IF NOT EXISTS agent_lessons (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  lesson TEXT NOT NULL,
  norm TEXT NOT NULL,
  source_decree_id TEXT,
  kind TEXT NOT NULL,          -- 'praise' | 'revision'
  created_at TEXT NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS agent_lessons_agent ON agent_lessons(agent_id, created_at);
CREATE TABLE IF NOT EXISTS lesson_sources (
  key TEXT PRIMARY KEY,        -- 'approve:<decree>' or 'revise:<decree>:<revision>'
  decree_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL,        -- 'pending' | 'done' | 'failed'
  lessons INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  at TEXT NOT NULL
);
`);
{
  const cols = db.prepare('PRAGMA table_info(lesson_sources)').all() as Row[];
  if (!cols.some((c) => c.name === 'attempts')) db.exec('ALTER TABLE lesson_sources ADD COLUMN attempts INTEGER NOT NULL DEFAULT 1');
}

const MAX_PER_AGENT = 20;
const LESSONS_MODEL = process.env.CLAUDE_LESSONS_MODEL || 'claude-haiku-5-5';
const FALLBACK_MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic());

// ---------------- read side (worker prompt + pages) ----------------
/** Newest lessons for an agent, for the worker's system prompt. Counts each read as a use. */
export function lessonsFor(agentId: string, limit = 6): string[] {
  const rows = db.prepare('SELECT id, lesson FROM agent_lessons WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?').all(agentId, Math.max(1, Math.min(20, limit))) as Row[];
  if (rows.length) db.prepare(`UPDATE agent_lessons SET uses = uses + 1 WHERE id IN (${rows.map(() => '?').join(',')})`).run(...rows.map((r) => r.id as string));
  return rows.map((r) => r.lesson as string);
}

/** Lessons for display (no source decree id: the decree may be private). */
export function listLessons(agentId: string): Lesson[] {
  return (db.prepare('SELECT * FROM agent_lessons WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?').all(agentId, MAX_PER_AGENT) as Row[]).map((r) => ({
    id: r.id,
    lesson: r.lesson,
    kind: r.kind,
    createdAt: r.created_at,
    uses: r.uses,
  }));
}

// ---------------- storing ----------------
const STOP = new Set('a an the to of and or for in on with when is are be it its this that as by at from your their'.split(' '));
export const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .join(' ');

function similar(a: string, b: string): boolean {
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const A = new Set(a.split(' '));
  const B = new Set(b.split(' '));
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.max(1, Math.min(A.size, B.size)) >= 0.8 && inter >= 3;
}

function store(agentId: string, decreeId: string, kind: 'praise' | 'revision', lessons: string[]): number {
  const existing = (db.prepare('SELECT norm FROM agent_lessons WHERE agent_id = ?').all(agentId) as Row[]).map((r) => r.norm as string);
  let added = 0;
  for (const raw of lessons) {
    const lesson = raw.replace(/\s+/g, ' ').trim().slice(0, 220);
    const norm = normalize(lesson);
    if (lesson.length < 12 || norm.split(' ').length < 3) continue;
    if (existing.some((e) => similar(e, norm))) continue;
    db.prepare('INSERT INTO agent_lessons (id, agent_id, lesson, norm, source_decree_id, kind, created_at, uses) VALUES (?,?,?,?,?,?,?,0)').run(
      uid('lsn'),
      agentId,
      lesson,
      norm,
      decreeId,
      kind,
      now(),
    );
    existing.push(norm);
    added++;
  }
  // keep the newest 20
  db.prepare('DELETE FROM agent_lessons WHERE agent_id = ? AND id NOT IN (SELECT id FROM agent_lessons WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?)').run(agentId, agentId, MAX_PER_AGENT);
  return added;
}

// ---------------- distilling ----------------
const SCHEMA = {
  type: 'object',
  properties: {
    lessons: {
      type: 'array',
      items: { type: 'string', description: 'One general, reusable craft lesson in one English sentence (max 25 words).' },
    },
  },
  required: ['lessons'],
  additionalProperties: false,
};

const SYSTEM = [
  'You help an AI agent in Agentdom improve its craft from requester feedback.',
  'Return 0 to 2 short lessons the agent can reuse on FUTURE decrees from OTHER requesters.',
  'Rules:',
  '- General craft only (structure, format, tone choices, completeness, checking work). Phrase as an instruction, e.g. "When asked for taglines, offer 3 options with different tones."',
  '- Never include names, companies, products, places, numbers, quotes or any text copied from the decree, the result or the feedback.',
  '- Never store one requester\'s personal preference as a rule; only lessons that would help most requesters.',
  '- If the feedback teaches nothing general (e.g. a bare rating), return an empty list.',
].join('\n');

const clip = (s: unknown, n: number) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + ' …' : t;
};

async function distill(d: Row, kind: 'praise' | 'revision'): Promise<string[]> {
  const p = PROVINCE[d.province as ProvinceId];
  const feedback =
    kind === 'praise'
      ? `The requester APPROVED the work with ${d.rating}/5 stars.${d.review ? ` Their review: "${clip(d.review, 500)}"` : ' No written review.'}`
      : `The requester asked for a REVISION. Their note: "${clip(d.revision_note, 800)}"`;
  const user = [
    `Guild: ${p?.name ?? d.province} (${p?.craft ?? ''}).`,
    `Decree type: ${clip(d.title, 120)}`,
    `What the agent delivered (start): ${clip(d.result, 1500)}`,
    '',
    feedback,
  ].join('\n');

  const call = (model: string) =>
    getClient().messages.create({
      model,
      max_tokens: 400,
      // Haiku accepts thinking off (cheapest); Opus-class fallbacks reject it, so leave it to them.
      ...(/haiku/i.test(model) ? { thinking: { type: 'disabled' as const } } : {}),
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: user }],
    });
  let res: Anthropic.Message;
  try {
    res = await call(LESSONS_MODEL);
  } catch (e) {
    // Fall back only when the lessons model itself is unavailable (unknown id or no access).
    const modelProblem = e instanceof Anthropic.NotFoundError || e instanceof Anthropic.PermissionDeniedError || (e instanceof Anthropic.BadRequestError && /model/i.test(e.message));
    if (modelProblem && LESSONS_MODEL !== FALLBACK_MODEL) {
      console.warn(`[lessons] ${LESSONS_MODEL} failed (${(e as Error).message}); falling back to ${FALLBACK_MODEL}`);
      res = await call(FALLBACK_MODEL);
    } else throw e;
  }
  if (res.stop_reason === 'refusal') return [];
  const text = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? '{}';
  const v = JSON.parse(text) as { lessons?: unknown };
  return Array.isArray(v.lessons) ? v.lessons.filter((x): x is string => typeof x === 'string').slice(0, 2) : [];
}

/** The learnable event a decree row currently represents, if any. */
function signal(d: Row): { key: string; kind: 'praise' | 'revision' } | null {
  // Only requester approvals carry a rating (quest auto-approvals do not): bare system approvals teach nothing.
  if (d.status === 'approved' && d.rating != null) return { key: `approve:${d.id}`, kind: 'praise' };
  if (d.revision_note && d.revision > 0 && ['queued', 'working', 'delivered'].includes(d.status)) return { key: `revise:${d.id}:${d.revision}`, kind: 'revision' };
  return null;
}

const seen = new Set<string>(); // keys already handled in this process
const inFlight = new Set<string>();

/** Learn from a decree's current approval / revision, once. Returns the lessons added (or null if nothing to learn). */
export async function learnFrom(decreeId: string): Promise<string[] | null> {
  const d = db.prepare('SELECT id, agent_id, province, title, status, rating, review, revision, revision_note, result, history, brief FROM decrees WHERE id = ?').get(decreeId) as Row | undefined;
  if (!d) return null;
  const s = signal(d);
  if (!s || seen.has(s.key) || inFlight.has(s.key)) return null;
  // DB guard: claim the key. An existing row means it was learned (or is being learned) already;
  // a failed attempt (API error) may be retried up to 3 times in all.
  seen.add(s.key);
  let claimed = Number(db.prepare("INSERT OR IGNORE INTO lesson_sources (key, decree_id, agent_id, status, attempts, at) VALUES (?,?,?,'pending',1,?)").run(s.key, d.id, d.agent_id, now()).changes);
  if (!claimed) claimed = Number(db.prepare("UPDATE lesson_sources SET status = 'pending', attempts = attempts + 1, at = ? WHERE key = ? AND status = 'failed' AND attempts < 3").run(now(), s.key).changes);
  if (claimed !== 1) return null;
  if (!process.env.ANTHROPIC_API_KEY) {
    db.prepare("UPDATE lesson_sources SET status = 'failed', error = 'AI disabled' WHERE key = ?").run(s.key);
    return null;
  }
  inFlight.add(s.key);
  try {
    // For a revision the result column is being rewritten: use the delivered version the note is about.
    if (s.kind === 'revision') {
      try {
        const h = JSON.parse(d.history || '[]') as { result?: string }[];
        d.result = h[d.revision - 1]?.result ?? h[h.length - 1]?.result ?? '';
      } catch {
        d.result = '';
      }
    }
    const lessons = await distill(d, s.kind);
    // Privacy guard: drop a lesson that repeats 5+ consecutive words of the private brief or feedback.
    const priv = ` ${normalize([d.brief, d.revision_note, d.review].filter(Boolean).join(' '))} `;
    const kept = lessons.filter((l) => {
      const w = normalize(l).split(' ');
      for (let i = 0; i + 5 <= w.length; i++) if (priv.includes(` ${w.slice(i, i + 5).join(' ')} `)) return false;
      return !/[\w.+-]+@[\w-]+\.\w+|https?:\/\//i.test(l);
    });
    const added = store(d.agent_id, d.id, s.kind, kept);
    db.prepare("UPDATE lesson_sources SET status = 'done', lessons = ?, error = NULL WHERE key = ?").run(added, s.key);
    if (added) console.log(`[lessons] ${added} lesson(s) for ${d.agent_id} from ${s.key}`);
    return kept;
  } catch (e) {
    db.prepare("UPDATE lesson_sources SET status = 'failed', error = ? WHERE key = ?").run(String((e as Error)?.message ?? e).slice(0, 300), s.key);
    console.warn(`[lessons] ${s.key} failed: ${(e as Error)?.message}`);
    seen.delete(s.key); // the next real change of this decree may retry (attempts cap above)
    return null;
  } finally {
    inFlight.delete(s.key);
  }
}

// Last seen (status|rating|revision) per decree, so the frequent streaming events stay cheap.
const last = new Map<string, string>();
let started = false;

/** Watch every decree change and learn from new approvals / revision requests. Idempotent. */
export function startLessons() {
  if (started) return;
  started = true;
  const q = db.prepare('SELECT status, rating, revision, revision_note IS NOT NULL AS rn FROM decrees WHERE id = ?');
  bus.on('decree:any', (id: string) => {
    try {
      const r = q.get(id) as Row | undefined;
      if (!r) return;
      const k = `${r.status}|${r.rating ?? ''}|${r.revision}|${r.rn}`;
      if (last.get(id) === k) return;
      last.set(id, k);
      if (last.size > 2000) last.delete(last.keys().next().value as string);
      const learnable = (r.status === 'approved' && r.rating != null) || (r.rn && r.revision > 0);
      if (learnable) void learnFrom(id);
    } catch (e) {
      console.warn('[lessons] watcher error', (e as Error)?.message);
    }
  });
}
