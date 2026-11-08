// App Builder routes: /api/builds* (make, revise, read, report), /api/admin/builder (stats,
// takedown) and the public host /p/<slug>. Hosted files run in a CSP sandbox with an opaque
// origin: they cannot read agentdom.world cookies or storage, cannot send network requests and
// cannot submit forms anywhere, so a page made here cannot be used to collect anything.
import { Router, type Request, type Response } from 'express';
import { db, now } from '../db';
import { HttpError, currentUser, h, optionalUser, text } from '../core';
import { isAdmin } from '../herald';
import {
  FORMATS,
  adminStats,
  builderStatus,
  buildView,
  extOf,
  openRouterCredits,
  restoreVersion,
  startBuild,
  startRevision,
  type BuildFormat,
} from '../builder';

export const router = Router();
const REPORT_HIDE = Number(process.env.BUILDER_REPORT_HIDE) || 5;

const byId = (id: string) => db.prepare('SELECT * FROM builds WHERE id = ?').get(id) as any;
const bySlug = (slug: string) => db.prepare('SELECT * FROM builds WHERE slug = ?').get(slug) as any;
const ipOf = (req: Request) => req.ip ?? '';

router.get(
  '/api/builder/status',
  h((req, res) => {
    const u = optionalUser(req.header('x-user'));
    res.json(builderStatus(u ? String(u.id) : null));
  }),
);

router.post(
  '/api/builds',
  h((req, res) => {
    const u = currentUser(req);
    const prompt = text(req.body?.prompt, 4000, 'Description');
    if (prompt.length < 8) throw new HttpError(400, 'Describe what you want in a few more words.');
    const format = (FORMATS.includes(req.body?.format) ? req.body.format : 'auto') as BuildFormat;
    res.json(startBuild(String(u.id), ipOf(req), prompt, format));
  }),
);

router.post(
  '/api/builds/:id/revise',
  h((req, res) => {
    const u = currentUser(req);
    const prompt = text(req.body?.prompt, 2000, 'Change request');
    res.json(startRevision(String(u.id), ipOf(req), req.params.id, prompt));
  }),
);

router.post(
  '/api/builds/:id/restore',
  h((req, res) => {
    const u = currentUser(req);
    const v = Number(req.body?.version);
    if (!Number.isInteger(v) || v < 1) throw new HttpError(400, 'Pick a version.');
    restoreVersion(String(u.id), req.params.id, v);
    res.json(buildView(byId(req.params.id), String(u.id)));
  }),
);

router.get(
  '/api/builds/mine',
  h((req, res) => {
    const u = optionalUser(req.header('x-user'));
    if (!u) return res.json([]);
    const rows = db.prepare("SELECT * FROM builds WHERE user_id = ? AND status != 'removed' ORDER BY created_at DESC LIMIT 50").all(u.id) as any[];
    res.json(rows.map((b) => buildView(b, String(u.id))));
  }),
);

router.get(
  '/api/builds/:id',
  h((req, res) => {
    const u = optionalUser(req.header('x-user'));
    const b = byId(req.params.id) ?? bySlug(req.params.id);
    if (!b || b.status === 'removed') throw new HttpError(404, 'Build not found.');
    res.json(buildView(b, u ? String(u.id) : null));
  }),
);

router.get(
  '/api/builds/:id/source',
  h((req, res) => {
    const b = byId(req.params.id) ?? bySlug(req.params.id);
    if (!b || b.status === 'removed' || !b.content) throw new HttpError(404, 'Build not found.');
    res.json({ filename: b.filename, content: b.content });
  }),
);

const reported = new Map<string, number>();
router.post(
  '/api/builds/:slug/report',
  h((req, res) => {
    const b = bySlug(req.params.slug) ?? byId(req.params.slug);
    if (!b) throw new HttpError(404, 'Build not found.');
    const key = `${ipOf(req)}:${b.id}`;
    if (!reported.has(key)) {
      reported.set(key, Date.now());
      const reason = text(req.body?.reason, 300, 'Reason', false);
      db.prepare('UPDATE builds SET reports = reports + 1 WHERE id = ?').run(b.id);
      console.warn(`[builder] report on ${b.slug}: ${reason || '(no reason)'}`);
    }
    res.json({ ok: true });
  }),
);

// ---------------- admin ----------------
const admin = (req: Request) => {
  if (!isAdmin(req.header('x-admin-key'))) throw new HttpError(403, 'Admin key required.');
};
router.get(
  '/api/admin/builder',
  h(async (req, res) => {
    admin(req);
    res.json({ ...adminStats(), credits: await openRouterCredits() });
  }),
);
router.post(
  '/api/admin/builds/:slug/remove',
  h((req, res) => {
    admin(req);
    const b = bySlug(req.params.slug) ?? byId(req.params.slug);
    if (!b) throw new HttpError(404, 'Build not found.');
    db.prepare("UPDATE builds SET status = 'removed', updated_at = ? WHERE id = ?").run(now(), b.id);
    res.json({ ok: true });
  }),
);
router.post(
  '/api/admin/builds/:slug/restore',
  h((req, res) => {
    admin(req);
    const b = bySlug(req.params.slug) ?? byId(req.params.slug);
    if (!b) throw new HttpError(404, 'Build not found.');
    db.prepare("UPDATE builds SET status = 'live', reports = 0, updated_at = ? WHERE id = ?").run(now(), b.id);
    res.json({ ok: true });
  }),
);

// ---------------- public host ----------------
const CSP = [
  'sandbox allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads',
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://cdn.tailwindcss.com",
  "style-src 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com",
  'font-src data: https://fonts.gstatic.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com',
  'img-src https: data: blob:',
  'media-src https: data: blob:',
  "connect-src 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join('; ');

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const json = (x: unknown) => JSON.stringify(x).replace(/</g, '\\u003c');

function badge(slug: string) {
  return `<div id="agentdom-badge" style="all:initial;position:fixed;right:12px;bottom:12px;z-index:2147483647;display:flex;gap:6px;align-items:center;padding:6px 8px 6px 12px;border-radius:999px;background:rgba(31,22,17,.86);color:#fffaf2;font:500 12px/1 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.25)"><a href="/build" target="_blank" rel="noopener" style="all:unset;cursor:pointer;color:#f3d38e">Built with Agentdom</a><a href="/build?report=${esc(slug)}" target="_blank" rel="noopener" title="Report this page" style="all:unset;cursor:pointer;padding:3px 7px;border-radius:999px;background:rgba(255,250,242,.12);color:#fffaf2;font-size:11px">Report</a></div>`;
}

function shell(title: string, slug: string, body: string, head = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>:root{color-scheme:light}body{margin:0;background:#f6eee2;color:#241a13;font:16px/1.65 system-ui,-apple-system,Segoe UI,sans-serif}main{max-width:820px;margin:0 auto;padding:40px 20px 90px}.bar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:22px;font:500 12px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.06em;text-transform:uppercase;color:#7a6656}.bar a{color:#6b4226;text-decoration:none;border:1px solid #e2cdb6;padding:7px 12px;border-radius:999px;background:#fffbf5}.doc{background:#fffbf5;border:1px solid #eadccb;border-radius:20px;padding:28px clamp(18px,4vw,40px)}pre{white-space:pre-wrap;word-break:break-word;font:13.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;margin:0}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border-bottom:1px solid #eadccb;padding:8px 10px;text-align:left;vertical-align:top}th{font-weight:600;background:#f6eee2;position:sticky;top:0}.scroll{overflow:auto;max-height:75vh}.doc h1,.doc h2,.doc h3{line-height:1.2}.doc code{background:#f2e7da;padding:1px 5px;border-radius:5px}.doc pre code{background:none;padding:0}.doc img{max-width:100%}.doc blockquote{margin:0;padding-left:14px;border-left:3px solid #e0a93e;color:#5a473a}</style>${head}</head>
<body><main><div class="bar"><span>${esc(title)}</span><a href="?download=1" target="_blank" rel="noopener">Download</a></div><div class="doc">${body}</div></main>${badge(slug)}</body></html>`;
}

function render(b: any): { type: string; body: string } {
  const ext = extOf(b.filename);
  const c: string = b.content;
  if (ext === 'html') {
    const i = c.toLowerCase().lastIndexOf('</body>');
    const html = i >= 0 ? c.slice(0, i) + badge(b.slug) + c.slice(i) : c + badge(b.slug);
    return { type: 'text/html; charset=utf-8', body: html };
  }
  if (ext === 'svg') return { type: 'image/svg+xml; charset=utf-8', body: c };
  if (ext === 'md')
    return {
      type: 'text/html; charset=utf-8',
      body: shell(
        b.title,
        b.slug,
        `<div id="md"><pre>${esc(c)}</pre></div><script>var src=${json(c)};try{document.getElementById('md').innerHTML=marked.parse(src)}catch(e){}</script>`,
        '<script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>',
      ),
    };
  if (ext === 'csv')
    return {
      type: 'text/html; charset=utf-8',
      body: shell(
        b.title,
        b.slug,
        `<div class="scroll" id="t"><pre>${esc(c)}</pre></div><script>
var s=${json(c)};function parse(t){var r=[],row=[],f='',q=false;for(var i=0;i<t.length;i++){var ch=t[i];if(q){if(ch=='"'){if(t[i+1]=='"'){f+='"';i++}else q=false}else f+=ch}else if(ch=='"')q=true;else if(ch==','){row.push(f);f=''}else if(ch=='\\n'||ch=='\\r'){if(ch=='\\r'&&t[i+1]=='\\n')i++;row.push(f);r.push(row);row=[];f=''}else f+=ch}if(f||row.length){row.push(f);r.push(row)}return r.filter(function(x){return x.length>1||x[0]!==''})}
try{var rows=parse(s),tb=document.createElement('table');rows.forEach(function(r,i){var tr=document.createElement('tr');r.forEach(function(v){var c=document.createElement(i?'td':'th');c.textContent=v;tr.appendChild(c)});tb.appendChild(tr)});var el=document.getElementById('t');el.innerHTML='';el.appendChild(tb)}catch(e){}</script>`,
      ),
    };
  if (ext === 'json') {
    let pretty = c;
    try {
      pretty = JSON.stringify(JSON.parse(c), null, 2);
    } catch {
      /* keep raw */
    }
    return { type: 'text/html; charset=utf-8', body: shell(b.title, b.slug, `<pre>${esc(pretty)}</pre>`) };
  }
  return { type: 'text/html; charset=utf-8', body: shell(b.title, b.slug, `<pre>${esc(c)}</pre>`) };
}

function notice(res: Response, status: number, title: string, line: string) {
  res.status(status).setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'");
  res.send(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6eee2;color:#241a13;font:16px/1.6 system-ui,sans-serif;text-align:center;padding:20px}h1{font:400 34px Georgia,serif;margin:0 0 8px}a{color:#6b4226}</style></head><body><div><h1>${esc(title)}</h1><p>${esc(line)}</p><p><a href="/build">Build your own on Agentdom</a></p></div></body></html>`,
  );
}

router.get('/p/:slug', (req, res) => {
  const b = bySlug(req.params.slug);
  if (!b || b.status === 'removed') return notice(res, 404, 'Nothing here', 'This page does not exist or was taken down.');
  if (!b.content) return notice(res, 404, b.status === 'building' ? 'Still building' : 'Nothing here', b.status === 'building' ? 'This page is being built. Refresh in a moment.' : 'This build did not finish.');
  if (Number(b.reports) >= REPORT_HIDE) return notice(res, 451, 'Under review', 'This page was reported by visitors and is hidden while we review it.');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.query.download !== undefined) {
    const ext = extOf(b.filename);
    const mime: Record<string, string> = { html: 'text/html', md: 'text/markdown', txt: 'text/plain', csv: 'text/csv', json: 'application/json', svg: 'image/svg+xml' };
    res.setHeader('Content-Type', `${mime[ext] ?? 'text/plain'}; charset=utf-8`);
    res.setHeader('Content-Disposition', `attachment; filename="${b.filename.replace(/[^a-z0-9._-]/gi, '_')}"`);
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    return res.send(b.content);
  }
  if (!req.header('x-agentdom-preview')) db.prepare('UPDATE builds SET views = views + 1 WHERE id = ?').run(b.id);
  const r = render(b);
  res.setHeader('Content-Type', r.type);
  res.setHeader('Content-Security-Policy', CSP);
  res.send(r.body);
});
