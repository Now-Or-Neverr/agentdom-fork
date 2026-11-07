// Shared server helpers: errors, input checks, sessions and row mappers.
import type { NextFunction, Request, Response } from 'express';
import { db, now, uid, type Row } from './db';
import { runningDecrees } from './worker';
import { listArtifacts, listSteps } from './artifacts';
import { rankFor } from '../shared/realm';
import type { Activity, Agent, AgentLite, Commission, Decree, LedgerEntry, User } from '../shared/types';

export class HttpError extends Error {
  constructor(
    public status: number,
    msg: string,
  ) {
    super(msg);
  }
}
export const h = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res)).catch(next);
};
export const text = (x: unknown, max: number, name: string, required = true) => {
  const s = typeof x === 'string' ? x.trim() : '';
  if (required && !s) throw new HttpError(400, `${name} is required.`);
  if (s.length > max) throw new HttpError(400, `${name} is too long (max ${max} characters).`);
  return s;
};
export const startOfDay = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
};

// ---------------- mappers ----------------
export const AGENT_SQL = `
  SELECT a.*,
    (SELECT COUNT(*) FROM decrees d WHERE d.agent_id = a.id AND d.status = 'approved') AS approved,
    (SELECT COUNT(*) FROM decrees d WHERE d.agent_id = a.id AND d.rating IS NOT NULL) AS reviews,
    (SELECT AVG(d.rating) FROM decrees d WHERE d.agent_id = a.id AND d.rating IS NOT NULL) AS rating,
    (SELECT SUM(CASE WHEN (julianday(d.delivered_at) - julianday(d.created_at)) * 1440 <= d.eta_minutes THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0)
       FROM decrees d WHERE d.agent_id = a.id AND d.status = 'approved') AS on_time,
    (SELECT COALESCE(SUM(d.price), 0) FROM decrees d WHERE d.agent_id = a.id AND d.status = 'approved') AS earned
  FROM agents a`;

export function workingAgents(): Set<string> {
  const ids = [...runningDecrees()];
  if (!ids.length) return new Set();
  const rows = db.prepare(`SELECT agent_id FROM decrees WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as Row[];
  return new Set(rows.map((r) => r.agent_id as string));
}

export function toAgent(r: Row, working = workingAgents()): Agent {
  const approved = Number(r.approved ?? 0);
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    province: r.province,
    title: r.title,
    bio: r.bio,
    model: r.model,
    role: r.role,
    look: r.look,
    color: r.color,
    ownerId: r.owner_id,
    active: !!r.active,
    approved,
    reviews: Number(r.reviews ?? 0),
    rating: r.rating == null ? null : Math.round(r.rating * 10) / 10,
    onTime: r.on_time == null ? null : Math.round(r.on_time),
    earned: Number(r.earned ?? 0),
    rank: rankFor(approved).name,
    working: working.has(r.id),
    createdAt: r.created_at,
  };
}
export const lite = (a: Agent): AgentLite => ({ id: a.id, name: a.name, role: a.role, look: a.look, color: a.color, model: a.model, rank: a.rank, title: a.title, province: a.province, rating: a.rating });

export function agentById(id: string): Agent | null {
  const r = db.prepare(AGENT_SQL + ' WHERE a.id = ?').get(id) as Row | undefined;
  return r ? toAgent(r) : null;
}
export function allAgents(): Map<string, Agent> {
  const w = workingAgents();
  return new Map((db.prepare(AGENT_SQL).all() as Row[]).map((r) => [r.id as string, toAgent(r, w)]));
}

export function toCommission(r: Row, agents: Map<string, Agent>): Commission {
  const a = agents.get(r.agent_id);
  return {
    id: r.id,
    agentId: r.agent_id,
    province: r.province,
    title: r.title,
    description: r.description,
    price: r.price,
    etaMinutes: r.eta_minutes,
    sampleBrief: r.sample_brief,
    agent: a ? lite(a) : undefined,
  };
}

// full=true only for the requester (or for public portfolio works).
export function toDecree(r: Row, full: boolean, agents?: Map<string, Agent>): Decree {
  const a = agents?.get(r.agent_id) ?? agentById(r.agent_id);
  return {
    id: r.id,
    userId: full ? r.user_id : '',
    agentId: r.agent_id,
    commissionId: r.commission_id,
    province: r.province,
    title: r.title,
    brief: full ? r.brief : '',
    price: r.price,
    status: r.status,
    result: full ? r.result : '',
    revisionNote: full ? r.revision_note : null,
    revision: r.revision,
    error: full ? r.error : null,
    rating: r.rating,
    review: r.review,
    isPublic: !!r.is_public,
    routedBy: r.routed_by,
    routeReason: full ? r.route_reason : null,
    tokensIn: full ? r.tokens_in : 0,
    tokensOut: full ? r.tokens_out : 0,
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at ?? r.delivered_at,
    agent: a ? lite(a) : undefined,
    steps: full ? listSteps(r.id) : [],
    artifacts: full ? listArtifacts(r.id) : [],
    nowDoing: full ? (r.now_doing ?? null) : null,
  };
}

export const toUser = (r: Row): User => ({ id: r.id, name: r.name, crowns: r.crowns, createdAt: r.created_at });

export function toActivity(r: Row, agents?: Map<string, Agent>): Activity {
  const a = r.agent_id ? (agents?.get(r.agent_id) ?? agentById(r.agent_id)) : null;
  return { id: r.id, kind: r.kind, province: r.province, text: r.text, agent: a ? lite(a) : null, at: r.at };
}

export function ledger(userId: string, amount: number, kind: LedgerEntry['kind'], ref: string | null) {
  db.prepare('INSERT INTO ledger (id, user_id, amount, kind, ref, created_at) VALUES (?,?,?,?,?,?)').run(uid('led'), userId, amount, kind, ref, now());
}

export function currentUser(req: Request): Row {
  const id = req.header('x-user');
  const r = id ? (db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row | undefined) : undefined;
  if (!r) throw new HttpError(401, 'Session not found. Please reload the page.');
  return r;
}
export const optionalUser = (id: string | undefined) => (id ? (db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row | undefined) : undefined);

export const count = (sql: string, ...args: (string | number)[]) => Number((db.prepare(sql).get(...args) as { n: number }).n);

