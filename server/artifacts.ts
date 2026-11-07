// Decree work log + artifacts: every real tool call an agent makes while carrying out a decree
// (decree_steps) and every file it really produced (decree_artifacts: images, videos, web pages).
// Also owns decrees.now_doing, a short live line ("Searching OpenAlex for …") for the realm map.
import { db, now, uid, type Row } from './db';
import { decreeChanged } from './events';
import type { DecreeArtifact, DecreeStep } from '../shared/types';

db.exec(`
CREATE TABLE IF NOT EXISTS decree_steps (
  id TEXT PRIMARY KEY,
  decree_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  round INTEGER NOT NULL,
  tool TEXT NOT NULL,
  input TEXT NOT NULL DEFAULT '{}',
  ok INTEGER,               -- NULL while running, 1 ok, 0 failed
  summary TEXT NOT NULL DEFAULT '',
  source_name TEXT,
  source_url TEXT,
  ms INTEGER,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS decree_steps_decree ON decree_steps(decree_id, at);
CREATE TABLE IF NOT EXISTS decree_artifacts (
  id TEXT PRIMARY KEY,
  decree_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL,       -- 'image' | 'video' | 'html' | 'site' | 'draft' | 'audit'
  url TEXT,                 -- '/uploads/…' for image and video
  content TEXT,             -- full HTML for kind 'html'
  title TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}',
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS decree_artifacts_decree ON decree_artifacts(decree_id, at);
`);

// Guarded ALTER: add decrees.now_doing once.
{
  const cols = db.prepare('PRAGMA table_info(decrees)').all() as Row[];
  if (!cols.some((c) => c.name === 'now_doing')) db.exec('ALTER TABLE decrees ADD COLUMN now_doing TEXT');
}

const parse = (s: unknown): Record<string, unknown> => {
  try {
    const v = JSON.parse(String(s ?? '{}'));
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
};

/** Set (or clear with null) the live "what the agent is doing" line. */
export function setNowDoing(decreeId: string, text: string | null) {
  const t = text ? text.replace(/\s+/g, ' ').trim().slice(0, 120) : null;
  const cur = db.prepare('SELECT now_doing FROM decrees WHERE id = ?').get(decreeId) as Row | undefined;
  if (!cur || (cur.now_doing ?? null) === t) return;
  db.prepare('UPDATE decrees SET now_doing = ? WHERE id = ?').run(t, decreeId);
  decreeChanged(decreeId);
}

/** Clear stale now_doing lines (e.g. after a restart). */
export const clearAllNowDoing = () => db.prepare('UPDATE decrees SET now_doing = NULL WHERE now_doing IS NOT NULL').run();

export function startStep(decreeId: string, revision: number, round: number, tool: string, input: unknown): string {
  const id = uid('stp');
  let json = '{}';
  try {
    json = JSON.stringify(input ?? {}).slice(0, 4000);
  } catch {
    /* keep {} */
  }
  db.prepare('INSERT INTO decree_steps (id, decree_id, revision, round, tool, input, ok, summary, at) VALUES (?,?,?,?,?,?,NULL,?,?)').run(id, decreeId, revision, round, tool, json, '', now());
  decreeChanged(decreeId);
  return id;
}

export function finishStep(stepId: string, decreeId: string, r: { ok: boolean; summary: string; sourceName?: string | null; sourceUrl?: string | null; ms: number }) {
  db.prepare('UPDATE decree_steps SET ok = ?, summary = ?, source_name = ?, source_url = ?, ms = ? WHERE id = ?').run(
    r.ok ? 1 : 0,
    r.summary.slice(0, 400),
    r.sourceName ?? null,
    r.sourceUrl ?? null,
    Math.round(r.ms),
    stepId,
  );
  decreeChanged(decreeId);
}

export interface NewArtifact {
  kind: DecreeArtifact['kind'];
  url?: string | null;
  content?: string | null;
  title: string;
  meta?: Record<string, unknown>;
}
export function addArtifact(decreeId: string, revision: number, a: NewArtifact): string {
  const id = uid('art');
  db.prepare('INSERT INTO decree_artifacts (id, decree_id, revision, kind, url, content, title, meta, at) VALUES (?,?,?,?,?,?,?,?,?)').run(
    id,
    decreeId,
    revision,
    a.kind,
    a.url ?? null,
    a.content ?? null,
    a.title.slice(0, 160),
    JSON.stringify(a.meta ?? {}),
    now(),
  );
  decreeChanged(decreeId);
  return id;
}

/** Remove the log and artifacts of one revision (used when an interrupted run starts over). */
export function resetRevision(decreeId: string, revision: number) {
  db.prepare('DELETE FROM decree_steps WHERE decree_id = ? AND revision = ?').run(decreeId, revision);
  db.prepare('DELETE FROM decree_artifacts WHERE decree_id = ? AND revision = ?').run(decreeId, revision);
}

export function listSteps(decreeId: string): DecreeStep[] {
  return (db.prepare('SELECT * FROM decree_steps WHERE decree_id = ? ORDER BY at, rowid').all(decreeId) as Row[]).map((r) => ({
    id: r.id,
    revision: r.revision,
    round: r.round,
    tool: r.tool,
    input: parse(r.input),
    status: r.ok == null ? 'running' : r.ok ? 'ok' : 'error',
    summary: r.summary,
    sourceName: r.source_name ?? null,
    sourceUrl: r.source_url ?? null,
    ms: r.ms ?? null,
    at: r.at,
  }));
}

export function listArtifacts(decreeId: string): DecreeArtifact[] {
  return (db.prepare('SELECT * FROM decree_artifacts WHERE decree_id = ? ORDER BY at, rowid').all(decreeId) as Row[]).map((r) => ({
    id: r.id,
    revision: r.revision,
    kind: r.kind,
    url: r.url ?? null,
    html: r.kind === 'html' ? (r.content ?? '') : null,
    title: r.title,
    meta: parse(r.meta),
    at: r.at,
  }));
}
