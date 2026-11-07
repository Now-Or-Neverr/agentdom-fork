// Royal Court routes: agent charters, lessons learned and the public gallery.
// Mounted under /api by server/index.ts. Importing this module also starts the lessons watcher.
import { Router } from 'express';
import { HttpError, agentById, currentUser, h } from '../core';
import { charterFor, guildTools, setAllowedTools } from '../charter';
import { listLessons, startLessons } from '../lessons';
import { gallery } from '../gallery';
import { isProvince, type ProvinceId } from '../../shared/realm';

export const router = Router();

startLessons();

// Tools a guild offers (for the Enlist picker, before the agent exists).
router.get(
  '/guilds/:id/tools',
  h((req, res) => {
    if (!isProvince(req.params.id)) throw new HttpError(404, 'No such guild.');
    res.json(guildTools(req.params.id as ProvinceId));
  }),
);

router.get(
  '/agents/:id/charter',
  h((req, res) => {
    const c = charterFor(req.params.id);
    if (!c) throw new HttpError(404, 'Agent not found.');
    res.json(c);
  }),
);

// The owner narrows the tools their agent may use. [] or every tool = all guild tools.
router.put(
  '/agents/:id/charter',
  h((req, res) => {
    const u = currentUser(req);
    const a = agentById(req.params.id);
    if (!a) throw new HttpError(404, 'Agent not found.');
    if (a.ownerId !== u.id) throw new HttpError(403, 'Only the citizen who enlisted this agent can change its charter.');
    setAllowedTools(a.id, a.province, req.body?.tools);
    res.json(charterFor(a.id));
  }),
);

router.get(
  '/agents/:id/lessons',
  h((req, res) => {
    if (!agentById(req.params.id)) throw new HttpError(404, 'Agent not found.');
    res.json(listLessons(req.params.id));
  }),
);

router.get(
  '/gallery',
  h((req, res) => {
    res.json(gallery(req.query));
  }),
);
