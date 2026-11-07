// Standing decrees (recurring) and Vizier quest planning. Mounted under /api by server/index.ts.
import { Router } from 'express';
import { db, type Row } from '../db';
import { currentUser, h } from '../core';
import { createSchedule, deleteSchedule, ownSchedule, setActive, startSchedules, toSchedule } from '../schedules';
import { confirmPlan, makePlan, plansLeft } from '../vizierPlan';
import { toQuest } from '../quests';
import { SCHEDULE_MAX_ACTIVE, VIZIER_PLANS_PER_USER } from '../../shared/schedules';

export const router = Router();
startSchedules();

// ---------------- standing decrees ----------------
router.get(
  '/schedules',
  h((req, res) => {
    const u = currentUser(req);
    const rows = db.prepare('SELECT * FROM schedules WHERE user_id = ? ORDER BY created_at DESC').all(u.id) as Row[];
    res.json({ maxActive: SCHEDULE_MAX_ACTIVE, schedules: rows.map((r) => toSchedule(r)) });
  }),
);

router.get(
  '/schedules/:id',
  h((req, res) => {
    const u = currentUser(req);
    res.json(toSchedule(ownSchedule(u.id, req.params.id), 100));
  }),
);

router.post(
  '/schedules',
  h((req, res) => {
    res.json(createSchedule(currentUser(req), req.body ?? {}));
  }),
);

router.post(
  '/schedules/:id/pause',
  h((req, res) => {
    res.json(setActive(currentUser(req).id, req.params.id, false));
  }),
);

router.post(
  '/schedules/:id/resume',
  h((req, res) => {
    res.json(setActive(currentUser(req).id, req.params.id, true));
  }),
);

router.delete(
  '/schedules/:id',
  h((req, res) => {
    deleteSchedule(currentUser(req).id, req.params.id);
    res.json({ ok: true });
  }),
);

// ---------------- Vizier planning ----------------
router.get(
  '/vizier/plan/quota',
  h((req, res) => {
    const u = currentUser(req);
    res.json({ left: plansLeft(u.id), limit: VIZIER_PLANS_PER_USER });
  }),
);

router.post(
  '/vizier/plan',
  h(async (req, res) => {
    res.json(await makePlan(currentUser(req), req.body ?? {}));
  }),
);

router.post(
  '/vizier/plan/confirm',
  h((req, res) => {
    const u = currentUser(req);
    const id = confirmPlan(u, req.ip ?? '', req.body ?? {});
    res.json(toQuest(db.prepare('SELECT * FROM quests WHERE id = ?').get(id) as Row, true));
  }),
);
