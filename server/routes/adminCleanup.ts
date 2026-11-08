// Admin-only cleanup of test data: removes chosen decrees (and everything hanging off them) and
// chosen builds. dryRun:true reports what would go without touching anything.
import { Router } from 'express';
import { db, tx } from '../db';
import { HttpError, h } from '../core';
import { isAdmin } from '../herald';

export const router = Router();

const exists = (table: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(table);
const cols = (table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

router.post(
  '/admin/cleanup',
  h((req, res) => {
    if (!isAdmin(req.header('x-admin-key'))) throw new HttpError(403, 'Admin key required.');
    const dry = req.body?.dryRun !== false;
    const ids = new Set<string>((Array.isArray(req.body?.decreeIds) ? req.body.decreeIds : []).filter((x: unknown) => typeof x === 'string'));
    if (req.body?.includeCancelled) for (const r of db.prepare("SELECT id FROM decrees WHERE status = 'cancelled'").all() as { id: string }[]) ids.add(r.id);
    const slugs: string[] = (Array.isArray(req.body?.buildSlugs) ? req.body.buildSlugs : []).filter((x: unknown) => typeof x === 'string');

    const decrees = [...ids].map((id) => db.prepare('SELECT id, title, status FROM decrees WHERE id = ?').get(id) as { id: string; title: string; status: string } | undefined).filter(Boolean) as { id: string; title: string; status: string }[];
    const builds = slugs.map((s) => db.prepare('SELECT id, slug, title FROM builds WHERE slug = ?').get(s) as { id: string; slug: string; title: string } | undefined).filter(Boolean) as { id: string; slug: string; title: string }[];
    // Standing decrees that produced or were copied from these decrees (reported, never deleted here).
    const schedules: unknown[] = [];
    if (exists('schedules')) {
      const sc = cols('schedules').filter((c) => c === 'last_decree_id' || c === 'source_decree_id');
      for (const d of decrees) for (const c of sc) schedules.push(...(db.prepare(`SELECT * FROM schedules WHERE ${c} = ?`).all(d.id) as unknown[]));
    }

    const removed: Record<string, number> = {};
    if (!dry) {
      tx(() => {
        const del = (table: string, col: string, val: string) => {
          if (!exists(table) || !cols(table).includes(col)) return;
          const r = db.prepare(`DELETE FROM ${table} WHERE ${col} = ?`).run(val);
          removed[table] = (removed[table] ?? 0) + Number(r.changes);
        };
        for (const d of decrees) {
          for (const t of ['decree_steps', 'decree_artifacts', 'decree_messages', 'lesson_sources', 'herald_posts', 'schedule_runs', 'quest_steps']) del(t, 'decree_id', d.id);
          del('agent_lessons', 'source_decree_id', d.id);
          del('ledger', 'ref', d.id);
          del('decrees', 'id', d.id);
        }
        for (const b of builds) {
          for (const t of ['build_versions', 'build_aliases']) del(t, 'build_id', b.id);
          del('builds', 'id', b.id);
        }
      });
    }
    res.json({ dryRun: dry, decrees, builds, linkedSchedules: schedules, removed });
  }),
);
