import express, { type NextFunction, type Request, type Response } from 'express';
import compression from 'compression';
import { cloudflareRanges } from './cloudflare-ips';
import fs from 'node:fs';
import path from 'node:path';
import { db, now, tx, uid, UPLOAD_DIR, type Row } from './db';
import { seed } from './seed';
import { router as realmRoutes } from './routes/realm';
import { router as toolRoutes } from './routes/tools';
import { router as questRoutes } from './routes/quests';
import { router as courtRoutes } from './routes/court';
import { router as mediaRoutes } from './routes/media';
import { router as court2Routes } from './routes/court2';
import { startDuties } from './duties';
import { bus, decreeChanged, logActivity } from './events';
import { MODEL, aiEnabled, runningDecrees, startWorker, vizierPick } from './worker';
import { GUILDS, PROVINCE, PROVINCES, isProvince, rankFor, routeByKeywords, type ProvinceId } from '../shared/realm';
import type { Activity, Agent, AgentLite, Banner, Commission, Decree, LedgerEntry, ProvinceInfo, RealmStatus, RoutePreview, User } from '../shared/types';

const GRANT = 500; // crowns for every new guest
const PORT = Number(process.env.PORT) || 8790;
// Limits that protect the API budget when the site is public.
const LIMIT_USER = Number(process.env.DAILY_DECREES_PER_USER) || 5;
const LIMIT_IP = Number(process.env.DAILY_DECREES_PER_IP) || 10;
const LIMIT_GLOBAL = Number(process.env.DAILY_DECREES_GLOBAL) || 200;

seed(MODEL);
startWorker();
startDuties();

const app = express();
// Only trust X-Forwarded-For from a local proxy (e.g. cloudflared on this machine); override with TRUST_PROXY.
// A number means "trust this many proxy hops" (e.g. 2 behind Railway's edge).
// With TRUST_CLOUDFLARE=1, hops from Cloudflare's published IP ranges are trusted as well, so the
// client IP is right whether a visitor comes through the Cloudflare proxy or straight to Railway,
// and a forged X-Forwarded-For can never pass as a Cloudflare hop.
const trustProxy = (process.env.TRUST_PROXY ?? 'loopback').trim();
if (/^\d+$/.test(trustProxy) && process.env.TRUST_CLOUDFLARE === '1') {
  const hops = Number(trustProxy);
  const cf = cloudflareRanges();
  const isCf = (addr: string) => {
    const a = addr.replace(/^::ffff:/, '');
    return cf.check(a, a.includes(':') ? 'ipv6' : 'ipv4');
  };
  app.set('trust proxy', (addr: string, i: number) => i < hops || isCf(addr));
  // When the nearest untrusted hop is still a Cloudflare edge (the request crossed two Cloudflare
  // zones), Cloudflare's own CF-Connecting-IP header holds the visitor. It is only used when the
  // request really arrived from Cloudflare, so it cannot be forged by calling Railway directly.
  app.use((req, _res, next) => {
    const via = req.ip ?? '';
    const real = req.get('cf-connecting-ip');
    if (real && isCf(via)) Object.defineProperty(req, 'ip', { value: real.trim(), configurable: true });
    next();
  });
} else app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
// gzip text responses (HTML, JS, CSS, JSON); never buffer live event streams
app.use(
  compression({
    filter: (req, res) => !String(res.getHeader('Content-Type') ?? '').includes('text/event-stream') && compression.filter(req, res),
  }),
);
app.use(express.json({ limit: '3mb' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

import { AGENT_SQL, HttpError, agentById, allAgents, count, currentUser, h, ledger, lite, optionalUser, startOfDay, text, toActivity, toAgent, toCommission, toDecree, toUser, workingAgents } from './core';

// ---------------- users ----------------
app.post(
  '/api/me',
  h((req, res) => {
    let r = optionalUser(req.header('x-user'));
    if (!r) {
      const id = uid('usr');
      tx(() => {
        db.prepare('INSERT INTO users (id, name, crowns, created_at) VALUES (?,?,?,?)').run(id, `Guest ${id.slice(-4).toUpperCase()}`, GRANT, now());
        ledger(id, GRANT, 'grant', null);
      });
      r = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row;
    }
    res.json(toUser(r));
  }),
);

app.post(
  '/api/me/name',
  h((req, res) => {
    const u = currentUser(req);
    const name = text(req.body?.name, 40, 'Name');
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, u.id);
    res.json(toUser({ ...u, name }));
  }),
);

app.get(
  '/api/me/ledger',
  h((req, res) => {
    const u = currentUser(req);
    const rows = db.prepare('SELECT * FROM ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 200').all(u.id) as Row[];
    res.json(rows.map((r): LedgerEntry => ({ id: r.id, amount: r.amount, kind: r.kind, ref: r.ref, createdAt: r.created_at })));
  }),
);

// ---------------- realm status & activity ----------------
app.get(
  '/api/status',
  h((req, res) => {
    const u = optionalUser(req.header('x-user'));
    const s: RealmStatus = {
      aiEnabled: aiEnabled(),
      model: MODEL,
      agents: count("SELECT COUNT(*) AS n FROM agents WHERE active = 1 AND province != 'throne'"),
      working: runningDecrees().size,
      approved: count("SELECT COUNT(*) AS n FROM decrees WHERE status = 'approved'"),
      queued: count("SELECT COUNT(*) AS n FROM decrees WHERE status = 'queued'"),
      crownsInVault: count("SELECT COALESCE(SUM(price), 0) AS n FROM decrees WHERE status IN ('queued','working','delivered')"),
      dailyLimitPerUser: LIMIT_USER,
      usedToday: u ? count('SELECT COUNT(*) AS n FROM decrees WHERE user_id = ? AND created_at >= ?', u.id, startOfDay()) : null,
    };
    res.json(s);
  }),
);

app.get(
  '/api/activity',
  h((_req, res) => {
    const agents = allAgents();
    res.json((db.prepare('SELECT * FROM activity ORDER BY at DESC LIMIT 40').all() as Row[]).map((r) => toActivity(r, agents)));
  }),
);

function sse(res: Response) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  return () => clearInterval(ping);
}

app.get('/api/activity/stream', (req, res) => {
  const stop = sse(res);
  const on = (r: Row) => res.write(`data: ${JSON.stringify(toActivity(r))}\n\n`);
  bus.on('activity', on);
  req.on('close', () => {
    stop();
    bus.off('activity', on);
  });
});

app.get(
  '/api/route-preview',
  h((req, res) => {
    const t = text(req.query.text, 2000, 'Text');
    const { province, hits } = routeByKeywords(t);
    const agents = [...allAgents().values()].filter((a) => a.province === province && a.active);
    agents.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.approved - a.approved);
    const out: RoutePreview = { province, hits, agent: agents[0] ? lite(agents[0]) : null };
    res.json(out);
  }),
);

// ---------------- agents ----------------
app.get(
  '/api/agents',
  h((req, res) => {
    const { province, sort, minRating, active, q, mine } = req.query as Record<string, string>;
    let rows = [...allAgents().values()].filter((a) => a.province !== 'throne');
    if (isProvince(province)) rows = rows.filter((a) => a.province === province);
    if (minRating) rows = rows.filter((a) => (a.rating ?? 0) >= Number(minRating));
    if (active === 'true') rows = rows.filter((a) => a.active);
    if (mine === 'true') {
      const u = currentUser(req);
      rows = rows.filter((a) => a.ownerId === u.id);
    }
    if (q) {
      const s = q.toLowerCase();
      rows = rows.filter((a) => [a.name, a.title, a.bio, PROVINCE[a.province].craft, PROVINCE[a.province].name].join(' ').toLowerCase().includes(s));
    }
    const cmp: Record<string, (a: Agent, b: Agent) => number> = {
      rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.approved - a.approved,
      approved: (a, b) => b.approved - a.approved || (b.rating ?? 0) - (a.rating ?? 0),
      new: (a, b) => b.createdAt.localeCompare(a.createdAt),
    };
    rows.sort(cmp[sort] ?? cmp.rating);
    res.json(rows);
  }),
);

app.get(
  '/api/leaderboard',
  h((_req, res) => {
    const rows = [...allAgents().values()].filter((a) => a.province !== 'throne');
    rows.sort((a, b) => b.approved - a.approved || (b.rating ?? 0) - (a.rating ?? 0) || b.earned - a.earned || a.name.localeCompare(b.name));
    res.json(rows.slice(0, 30));
  }),
);

app.get(
  '/api/agents/:id',
  h((req, res) => {
    const a = agentById(req.params.id);
    if (!a) throw new HttpError(404, 'Agent not found.');
    const map = new Map([[a.id, a]]);
    const commissions = (db.prepare('SELECT * FROM commissions WHERE agent_id = ? ORDER BY price').all(a.id) as Row[]).map((r) => toCommission(r, map));
    const decrees = (
      db.prepare("SELECT * FROM decrees WHERE agent_id = ? AND status IN ('working','delivered','approved') ORDER BY created_at DESC LIMIT 20").all(a.id) as Row[]
    ).map((r) => toDecree(r, false, map));
    const works = (db.prepare("SELECT * FROM decrees WHERE agent_id = ? AND status = 'approved' AND is_public = 1 ORDER BY finished_at DESC LIMIT 6").all(a.id) as Row[]).map(
      (r) => ({ ...toDecree(r, true, map), userId: '', tokensIn: 0, tokensOut: 0, routeReason: null }),
    );
    res.json({ agent: a, commissions, decrees, works });
  }),
);

app.post(
  '/api/agents',
  h((req, res) => {
    const u = currentUser(req);
    const b = req.body ?? {};
    const name = text(b.name, 40, 'Agent name');
    if (!isProvince(b.province) || b.province === 'throne') throw new HttpError(400, 'Choose a guild for your agent.');
    const title = text(b.title, 80, 'Title');
    const bio = text(b.bio, 300, 'Bio');
    const instructions = text(b.instructions, 2000, 'Instructions');
    const commissionTitle = text(b.commissionTitle, 120, 'Commission title');
    const price = Math.round(Number(b.price));
    if (!(price >= 5 && price <= 500)) throw new HttpError(400, 'Commission price must be between 5 and 500 crowns.');
    if (count('SELECT COUNT(*) AS n FROM agents WHERE owner_id = ?', u.id) >= 5) throw new HttpError(400, 'You can enlist up to 5 agents.');
    const p = PROVINCE[b.province as ProvinceId];
    const id = uid('agt');
    tx(() => {
      db.prepare(
        'INSERT INTO agents (id, slug, name, province, title, bio, instructions, model, role, look, color, owner_id, active, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?)',
      ).run(id, id, name, p.id, title, bio, instructions, MODEL, p.role, [0, 1, 2, 3].includes(Number(b.look)) ? Number(b.look) : 0, p.color, u.id, now());
      db.prepare('INSERT INTO commissions (id, agent_id, province, title, description, price, eta_minutes, sample_brief, created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(
        uid('com'),
        id,
        p.id,
        commissionTitle,
        bio,
        price,
        8,
        '',
        now(),
      );
    });
    logActivity('agent_enlisted', p.id, `${name} joined the ${p.name}`, id);
    res.json(agentById(id));
  }),
);

// ---------------- commissions ----------------
app.get(
  '/api/commissions',
  h((req, res) => {
    const { province, q } = req.query as Record<string, string>;
    const agents = allAgents();
    let rows = (db.prepare('SELECT * FROM commissions ORDER BY created_at').all() as Row[]).map((r) => toCommission(r, agents));
    if (isProvince(province)) rows = rows.filter((c) => c.province === province);
    if (q) {
      const s = q.toLowerCase();
      rows = rows.filter((c) => [c.title, c.description, c.agent?.name, PROVINCE[c.province].craft].join(' ').toLowerCase().includes(s));
    }
    res.json(rows);
  }),
);

// ---------------- decrees ----------------
app.get(
  '/api/decrees/recent',
  h((req, res) => {
    const agents = allAgents();
    // Optional ?province= filter (used by the guild pages).
    const province = req.query.province;
    const sql = "SELECT * FROM decrees WHERE status IN ('working','delivered','approved')" + (isProvince(province) ? ' AND province = ?' : '') + ' ORDER BY created_at DESC LIMIT 24';
    const rows = (isProvince(province) ? db.prepare(sql).all(province) : db.prepare(sql).all()) as Row[];
    res.json(rows.map((r) => toDecree(r, false, agents)));
  }),
);

app.get(
  '/api/decrees/mine',
  h((req, res) => {
    const u = currentUser(req);
    const agents = allAgents();
    res.json((db.prepare('SELECT * FROM decrees WHERE user_id = ? ORDER BY created_at DESC').all(u.id) as Row[]).map((r) => toDecree(r, true, agents)));
  }),
);

function ownDecree(req: Request, userId?: string) {
  const u = userId ? optionalUser(userId) : currentUser(req);
  if (!u) throw new HttpError(401, 'Session not found.');
  const r = db.prepare('SELECT * FROM decrees WHERE id = ?').get(req.params.id) as Row | undefined;
  if (!r || r.user_id !== u.id) throw new HttpError(404, 'Decree not found.');
  return { u, r };
}

app.get(
  '/api/decrees/:id',
  h((req, res) => {
    res.json(toDecree(ownDecree(req).r, true));
  }),
);

// Live stream of one decree (EventSource can't send headers, so the user id comes in the query).
app.get('/api/decrees/:id/stream', (req, res) => {
  let row: Row;
  try {
    row = ownDecree(req, String(req.query.u ?? '')).r;
  } catch (e) {
    res.status(e instanceof HttpError ? e.status : 500).end();
    return;
  }
  const stop = sse(res);
  let last = '';
  const push = () => {
    const r = db.prepare('SELECT * FROM decrees WHERE id = ?').get(row.id) as Row;
    const payload = JSON.stringify(toDecree(r, true));
    if (payload !== last) {
      last = payload;
      res.write(`data: ${payload}\n\n`);
    }
  };
  push();
  bus.on('decree:' + row.id, push);
  req.on('close', () => {
    stop();
    bus.off('decree:' + row.id, push);
  });
});

app.post(
  '/api/decrees',
  h(async (req, res) => {
    const u = currentUser(req);
    const b = req.body ?? {};
    const title = text(b.title, 140, 'Decree title');
    const brief = text(b.brief, 6000, 'Decree details');
    const ip = req.ip ?? '';
    const today = startOfDay();
    if (count('SELECT COUNT(*) AS n FROM decrees WHERE user_id = ? AND created_at >= ?', u.id, today) >= LIMIT_USER)
      throw new HttpError(429, `You can issue ${LIMIT_USER} decrees per day. Come back tomorrow.`);
    if (ip && count('SELECT COUNT(*) AS n FROM decrees WHERE ip = ? AND created_at >= ?', ip, today) >= LIMIT_IP)
      throw new HttpError(429, 'Daily decree limit reached for this network.');
    if (count('SELECT COUNT(*) AS n FROM decrees WHERE created_at >= ?', today) >= LIMIT_GLOBAL)
      throw new HttpError(429, 'The realm has reached today’s decree limit. Try again tomorrow.');

    let price = Math.round(Number(b.price));
    let agent: Row | undefined;
    let commissionId: string | null = null;
    let eta = 10;
    let routedBy: Decree['routedBy'] = 'requester';
    let reason: string | null = null;

    if (b.commissionId) {
      const c = db.prepare('SELECT * FROM commissions WHERE id = ?').get(b.commissionId) as Row | undefined;
      if (!c) throw new HttpError(404, 'Commission not found.');
      agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(c.agent_id) as Row;
      price = c.price;
      commissionId = c.id;
      eta = c.eta_minutes;
    } else if (b.agentId) {
      agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(b.agentId) as Row | undefined;
      if (!agent || agent.province === 'throne') throw new HttpError(404, 'Agent not found.');
    } else {
      // Decree to the Grand Vizier: route automatically.
      const all = db.prepare("SELECT * FROM agents WHERE active = 1 AND province != 'throne'").all() as Row[];
      const prov = isProvince(b.province) && b.province !== 'throne' ? (b.province as ProvinceId) : undefined;
      const pool = prov ? all.filter((a) => a.province === prov) : all;
      if (aiEnabled()) {
        try {
          const pick = await vizierPick(
            title,
            brief,
            pool.map((a) => ({ slug: a.slug, name: a.name, title: a.title, province: a.province })),
          );
          agent = pool.find((a) => a.slug === pick.slug);
          reason = pick.reason;
          routedBy = 'vizier';
        } catch (e) {
          console.error('[vizier]', e);
        }
      }
      if (!agent) {
        const target = prov ?? routeByKeywords(`${title} ${brief}`).province;
        const inGuild = (pool.length ? pool : all).filter((a) => a.province === target);
        agent = inGuild[Math.floor(Math.random() * inGuild.length)] ?? all[0];
        routedBy = 'keywords';
        reason = prov
          ? `Sent to the ${PROVINCE[prov].name} as requested.`
          : `Matched by keywords to the ${PROVINCE[target].name} (the Grand Vizier’s AI is offline).`;
      }
    }
    if (!agent) throw new HttpError(400, 'No agent can take this decree.');
    if (!(price >= 5 && price <= 1000)) throw new HttpError(400, 'The reward must be between 5 and 1,000 crowns.');
    if (u.crowns < price) throw new HttpError(400, `Not enough crowns. You have ${u.crowns}, this needs ${price}.`);

    const id = uid('dec');
    tx(() => {
      db.prepare('UPDATE users SET crowns = crowns - ? WHERE id = ?').run(price, u.id);
      ledger(u.id, -price, 'vault_lock', id);
      db.prepare(
        `INSERT INTO decrees (id, user_id, agent_id, commission_id, province, title, brief, price, status, is_public, routed_by, ip, route_reason, eta_minutes, created_at)
         VALUES (?,?,?,?,?,?,?,?, 'queued', ?,?,?,?,?,?)`,
      ).run(id, u.id, agent!.id, commissionId, agent!.province, title, brief, price, b.isPublic ? 1 : 0, routedBy, ip, reason, eta, now());
    });
    logActivity('decree_issued', agent.province, `A decree reached ${agent.name}: “${title}”`, agent.id);
    res.json(toDecree(db.prepare('SELECT * FROM decrees WHERE id = ?').get(id) as Row, true));
  }),
);

app.post(
  '/api/decrees/:id/approve',
  h((req, res) => {
    const { r } = ownDecree(req);
    if (r.status !== 'delivered') throw new HttpError(400, 'This decree is not ready for approval.');
    const rating = Math.round(Number(req.body?.rating));
    if (!(rating >= 1 && rating <= 5)) throw new HttpError(400, 'Give a rating from 1 to 5.');
    const review = text(req.body?.review, 500, 'Review', false) || null;
    const a = db.prepare('SELECT owner_id, name FROM agents WHERE id = ?').get(r.agent_id) as Row;
    tx(() => {
      db.prepare("UPDATE decrees SET status = 'approved', rating = ?, review = ?, finished_at = ? WHERE id = ?").run(rating, review, now(), r.id);
      // Crowns leave the vault. User-owned agents pay their owner.
      if (a.owner_id) {
        db.prepare('UPDATE users SET crowns = crowns + ? WHERE id = ?').run(r.price, a.owner_id);
        ledger(a.owner_id, r.price, 'agent_earning', r.id);
      }
    });
    decreeChanged(r.id);
    logActivity('decree_approved', r.province, `“${r.title}” was approved · ${'★'.repeat(rating)} for ${a.name}`, r.agent_id);
    res.json(toDecree(db.prepare('SELECT * FROM decrees WHERE id = ?').get(r.id) as Row, true));
  }),
);

app.post(
  '/api/decrees/:id/revise',
  h((req, res) => {
    const { r } = ownDecree(req);
    if (r.status !== 'delivered') throw new HttpError(400, 'You can ask for a revision once the work is delivered.');
    if (r.revision >= 2) throw new HttpError(400, 'The revision limit (2) has been reached.');
    const note = text(req.body?.note, 2000, 'Revision note');
    db.prepare("UPDATE decrees SET status = 'queued', revision_note = ?, revision = revision + 1 WHERE id = ?").run(note, r.id);
    decreeChanged(r.id);
    res.json(toDecree(db.prepare('SELECT * FROM decrees WHERE id = ?').get(r.id) as Row, true));
  }),
);

app.post(
  '/api/decrees/:id/cancel',
  h((req, res) => {
    const { u, r } = ownDecree(req);
    if (r.status !== 'queued' || r.revision > 0) throw new HttpError(400, 'A decree can only be cancelled before work begins.');
    tx(() => {
      db.prepare("UPDATE decrees SET status = 'cancelled', finished_at = ? WHERE id = ? AND status = 'queued'").run(now(), r.id);
      db.prepare('UPDATE users SET crowns = crowns + ? WHERE id = ?').run(r.price, u.id);
      ledger(u.id, r.price, 'refund', r.id);
    });
    decreeChanged(r.id);
    res.json(toDecree(db.prepare('SELECT * FROM decrees WHERE id = ?').get(r.id) as Row, true));
  }),
);

// ---------------- banners ----------------
function toBanner(r: Row): Banner {
  const live = r.until && new Date(r.until).getTime() > Date.now();
  const renter = live && r.renter_id ? optionalUser(r.renter_id) : undefined;
  return {
    id: r.id,
    no: r.no,
    province: r.province,
    side: r.side,
    kind: r.kind,
    size: r.size,
    pricePerDay: r.price_per_day,
    renterId: live ? r.renter_id : null,
    renterName: renter?.name ?? null,
    title: live ? r.title : null,
    imageUrl: live ? r.image_url : null,
    until: live ? r.until : null,
  };
}

app.get(
  '/api/banners',
  h((_req, res) => {
    res.json((db.prepare('SELECT * FROM banners ORDER BY no').all() as Row[]).map(toBanner));
  }),
);

app.post(
  '/api/banners/:id/rent',
  h((req, res) => {
    const u = currentUser(req);
    const r = db.prepare('SELECT * FROM banners WHERE id = ?').get(req.params.id) as Row | undefined;
    if (!r) throw new HttpError(404, 'Banner not found.');
    if (toBanner(r).renterId) throw new HttpError(400, 'This banner is already rented.');
    const title = text(req.body?.title, 60, 'Title');
    const days = Math.round(Number(req.body?.days));
    if (!(days >= 1 && days <= 30)) throw new HttpError(400, 'Rent for 1 to 30 days.');
    const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.image ?? ''));
    if (!m) throw new HttpError(400, 'The image must be PNG, JPG or WebP.');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 1.6 * 1024 * 1024) throw new HttpError(400, 'The image must be 1.5 MB or smaller.');
    const cost = r.price_per_day * days;
    if (u.crowns < cost) throw new HttpError(400, `Not enough crowns. This needs ${cost}.`);
    const file = `banner-${r.no}-${Date.now()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, file), buf);
    const until = new Date(Date.now() + days * 86400000).toISOString();
    tx(() => {
      db.prepare('UPDATE users SET crowns = crowns - ? WHERE id = ?').run(cost, u.id);
      ledger(u.id, -cost, 'banner_rent', r.id);
      db.prepare('UPDATE banners SET renter_id = ?, title = ?, image_url = ?, until = ? WHERE id = ?').run(u.id, title, '/uploads/' + file, until, r.id);
    });
    logActivity('banner_raised', r.province, `A banner was raised over the ${PROVINCE[r.province as ProvinceId].name}: “${title}”`, null);
    res.json(toBanner(db.prepare('SELECT * FROM banners WHERE id = ?').get(r.id) as Row));
  }),
);

// ---------------- provinces ----------------
app.get(
  '/api/provinces',
  h((_req, res) => {
    const agents = [...allAgents().values()].filter((a) => a.active);
    const out = {} as Record<ProvinceId, ProvinceInfo>;
    for (const p of PROVINCES) {
      const here = agents.filter((a) => a.province === p.id);
      out[p.id] = {
        // "online" means able to work right now — only true with an API key.
        online: aiEnabled() ? here.length : 0,
        agents: here.map((a) => ({ ...lite(a), working: a.working })),
        approved: count("SELECT COUNT(*) AS n FROM decrees WHERE province = ? AND status = 'approved'", p.id),
      };
    }
    res.json(out);
  }),
);

// ---------------- feature routers ----------------
app.use('/api', realmRoutes);
app.use('/api', toolRoutes);
app.use('/api', questRoutes);
app.use('/api', courtRoutes);
app.use('/api', mediaRoutes);
app.use('/api', court2Routes);

// ---------------- errors & static ----------------
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'No such endpoint.')));
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

const dist = path.resolve('dist');
if (fs.existsSync(dist)) {
  // hashed build assets never change; index.html is always revalidated
  app.use('/assets', express.static(path.join(dist, 'assets'), { maxAge: '365d', immutable: true, fallthrough: false }));
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(dist, 'index.html'));
  });
}

app.listen(PORT, () => console.log(`[api] http://localhost:${PORT} · guilds: ${GUILDS.length}`));
