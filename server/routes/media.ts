// Media & action routes (mounted under /api by server/index.ts):
// Atelier/Theatre/Scriptorium/Forge workshop tools backed by Cloudflare Workers AI, Pixabay,
// Freesound, remove.bg, local ffmpeg films and GitHub Pages, plus the admin-only Herald queue
// (Bluesky drafts) and owner notification checks. Nothing here invents data; every limit is real.
import { Router, type Request } from 'express';
import { db, now } from '../db';
import { HttpError, currentUser, h, text } from '../core';
import * as I from '../integrations';
import { QuotaError, recordUsage, usage, utcDayStart } from '../integrations/media-common';
import { approveHerald, heraldPost, isAdmin, listHerald, queueHeraldDraft, rejectHerald, xInfo, type HeraldStatus } from '../herald';
import { xCallback, xConnectUrl, xDisconnect } from '../integrations/x';
import { discordWebhookInfo, notifyEnabled, notifyOwner, notifyRealm, telegramGetMe } from '../notify';

export const router = Router();

const WS = (tool: string): I.CallContext => ({ context: 'workshop', ref: tool });
const ADMIN: I.CallContext = { context: 'realm', ref: 'admin-check' };

// ---------------- helpers ----------------
async function run<T>(p: Promise<T> | T): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (e instanceof QuotaError) throw new HttpError(429, e.message);
    if (e instanceof I.UpstreamError) throw new HttpError(e.status === 429 ? 429 : 502, e.message);
    throw new HttpError(400, (e as Error).message || 'Request failed.');
  }
}

const hits = new Map<string, number[]>();
function limitIp(req: Request, bucket: string, max: number, windowMs = 60_000) {
  const key = `${bucket}:${req.ip ?? 'unknown'}`;
  const t = Date.now();
  const arr = (hits.get(key) ?? []).filter((x) => x > t - windowMs);
  if (arr.length >= max) throw new HttpError(429, `Too many requests. Please wait ${Math.ceil((arr[0] + windowMs - t) / 1000)} s and try again.`);
  arr.push(t);
  hits.set(key, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => x > t - windowMs)) hits.delete(k);
}

/** Daily per-user caps (UTC day). Override with env MEDIA_LIMIT_<TOOL>, e.g. MEDIA_LIMIT_IMAGE=10. */
const DAILY: Record<string, number> = { image: 6, speak: 8, transcribe: 8, translate: 30, alt: 6, film: 3, download: 25, upload: 25 };
const cap = (tool: string) => Number(process.env[`MEDIA_LIMIT_${tool.toUpperCase()}`]) || DAILY[tool];
function quota(tool: string, userId: string) {
  const used = usage(`u:${tool}`, utcDayStart(), userId);
  return { used, limit: cap(tool), left: Math.max(0, cap(tool) - used) };
}
function takeQuota(tool: string, userId: string) {
  const q = quota(tool, userId);
  if (q.left <= 0) throw new HttpError(429, `Daily limit reached for this tool (${q.limit} per day). It resets at 00:00 UTC.`);
}
const spend = (tool: string, userId: string) => recordUsage(`u:${tool}`, 1, userId);

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const q = (req: Request, k: string) => str(req.query[k]);
function uploadsUrl(v: unknown, what: string): string {
  const s = str(v);
  if (!/^\/uploads\/[A-Za-z0-9._-]+$/.test(s)) throw new HttpError(400, `${what} must be a file from /uploads/.`);
  return s;
}
const posInt = (v: unknown, what: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `${what} must be a positive whole number.`);
  return n;
};
const strip = <T extends { file?: string }>(o: T): Omit<T, 'file'> => {
  const { file: _f, ...rest } = o;
  return rest;
};

// ---------------- status ----------------
router.get(
  '/media/status',
  h((req, res) => {
    const u = currentUser(req);
    const tools = Object.fromEntries(Object.keys(DAILY).map((t) => [t, quota(t, u.id)]));
    res.json({
      providers: {
        cloudflare: I.cfEnabled(),
        pixabay: I.enabled('pixabay'),
        freesound: I.enabled('freesound'),
        removebg: I.enabled('removebg'),
        huggingface: I.enabled('huggingface'),
        github: I.enabled('github') && Boolean(I.pagesRepo()),
      },
      cloudflare: I.cfUsage(),
      removebg: I.removeBgQuota(u.id),
      tools,
      publishEnabled: I.publishEnabled(),
      at: now(),
    });
  }),
);

// ---------------- uploads (images / audio from the browser) ----------------
// The global JSON body limit is 3 MB, so a base64 upload carries at most ~2 MB of file.
const UPLOAD_MAX = 2 * 1024 * 1024;
router.post(
  '/media/upload',
  h((req, res) => {
    const u = currentUser(req);
    limitIp(req, 'media-upload', 12);
    takeQuota('upload', u.id);
    const kind = str(req.body?.kind) === 'audio' ? 'audio' : 'image';
    const saved = (() => {
      try {
        const buf = I.fromDataUrl(req.body?.data, UPLOAD_MAX);
        return I.saveUpload(buf, kind === 'audio' ? 'aud' : 'upl', kind === 'audio' ? I.AUDIO_EXT : ['jpg', 'png', 'webp'], kind);
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
    })();
    spend('upload', u.id);
    res.json({ url: saved.url, type: saved.ext, bytes: saved.bytes });
  }),
);

// ---------------- Atelier ----------------
router.post(
  '/media/image',
  h(async (req, res) => {
    const u = currentUser(req);
    limitIp(req, 'media-ai', 10);
    takeQuota('image', u.id);
    const prompt = text(req.body?.prompt, 600, 'Prompt');
    const r = await run(I.cfImage(prompt, WS('cf-image')));
    spend('image', u.id);
    res.json({ ...strip(r), provider: 'cloudflare', name: 'Cloudflare Workers AI', quota: quota('image', u.id), usage: I.cfUsage() });
  }),
);

router.post(
  '/media/alt',
  h(async (req, res) => {
    const u = currentUser(req);
    limitIp(req, 'media-ai', 10);
    takeQuota('alt', u.id);
    const image = uploadsUrl(req.body?.image, 'Image');
    const r = await run(I.cfAltText(image, WS('alt-text'), { detail: str(req.body?.detail) === 'long' ? 'long' : 'short' }));
    spend('alt', u.id);
    res.json({ ...r, image, provider: 'cloudflare', name: 'Cloudflare Workers AI', quota: quota('alt', u.id) });
  }),
);

router.post(
  '/media/cutout',
  h(async (req, res) => {
    const u = currentUser(req);
    limitIp(req, 'media-cutout', 3);
    const image = uploadsUrl(req.body?.image, 'Image');
    const r = await run(I.removeBackground(image, u.id, WS('cutout')));
    res.json({ ...strip(r), provider: 'removebg', name: 'remove.bg' });
  }),
);

router.get(
  '/media/pixabay/images',
  h(async (req, res) => {
    limitIp(req, 'media-search', 30);
    res.json({ ...(await run(I.pixabayImages(q(req, 'q'), WS('pixabay-search')))), provider: 'pixabay', name: 'Pixabay' });
  }),
);
router.get(
  '/media/pixabay/videos',
  h(async (req, res) => {
    limitIp(req, 'media-search', 30);
    res.json({ ...(await run(I.pixabayVideos(q(req, 'q'), WS('pixabay-search')))), provider: 'pixabay', name: 'Pixabay' });
  }),
);
router.post(
  '/media/pixabay/download',
  h(async (req, res) => {
    const u = currentUser(req);
    limitIp(req, 'media-download', 10);
    takeQuota('download', u.id);
    const id = posInt(req.body?.id, 'id');
    const r = await run(str(req.body?.kind) === 'video' ? I.pixabayDownloadVideo(id, WS('pixabay-download')) : I.pixabayDownloadImage(id, WS('pixabay-download')));
    spend('download', u.id);
    res.json({ ...strip(r), provider: 'pixabay', name: 'Pixabay' });
  }),
);

// ---------------- Lantern Theatre ----------------
router.post(
  '/media/speak',
  h(async (req, res) => {
    const u = currentUser(req);
    limitIp(req, 'media-ai', 10);
    takeQuota('speak', u.id);
    const t = text(req.body?.text, I.TTS_MAX_CHARS, 'Narration text');
    const r = await run(I.cfSpeak(t, WS('tts'), { lang: str(req.body?.lang) || 'en' }));
    spend('speak', u.id);
    res.json({ ...strip(r), provider: 'cloudflare', name: 'Cloudflare Workers AI', quota: quota('speak', u.id) });
  }),
);

router.post(
  '/media/transcribe',
  h(async (req, res) => {
    const u = currentUser(req);
    limitIp(req, 'media-ai', 10);
    takeQuota('transcribe', u.id);
    const audio = uploadsUrl(req.body?.audio, 'Audio');
    const r = await run(I.cfTranscribe(audio, WS('stt'), { language: str(req.body?.language) || undefined }));
    spend('transcribe', u.id);
    res.json({ ...r, audio, provider: 'cloudflare', name: 'Cloudflare Workers AI', quota: quota('transcribe', u.id) });
  }),
);

router.get(
  '/media/sounds',
  h(async (req, res) => {
    limitIp(req, 'media-search', 30);
    const kind = (['music', 'sfx'].includes(q(req, 'kind')) ? q(req, 'kind') : 'any') as I.SoundKind;
    res.json({ ...(await run(I.freesoundSearch(q(req, 'q'), WS('freesound-search'), { kind }))), provider: 'freesound', name: 'Freesound' });
  }),
);
router.post(
  '/media/sounds/download',
  h(async (req, res) => {
    const u = currentUser(req);
    limitIp(req, 'media-download', 10);
    takeQuota('download', u.id);
    const r = await run(I.freesoundDownload(posInt(req.body?.id, 'id'), WS('freesound-download')));
    spend('download', u.id);
    res.json({ ...strip(r), provider: 'freesound', name: 'Freesound' });
  }),
);

router.post(
  '/media/film',
  h(async (req, res) => {
    const u = currentUser(req);
    limitIp(req, 'media-film', 3);
    takeQuota('film', u.id);
    const b = req.body ?? {};
    const list = (v: unknown, what: string) => (Array.isArray(v) ? v.slice(0, I.FILM_MAX_SCENES).map((x) => uploadsUrl(x, what)) : []);
    const clips = list(b.clips, 'Clip');
    const images = list(b.images, 'Image');
    const captions = Array.isArray(b.captions) ? b.captions.slice(0, I.FILM_MAX_SCENES).map((c: unknown) => str(c).slice(0, 160)) : [];
    const r = await run(
      I.makeFilm({
        clips,
        images,
        captions,
        narration: b.narration ? uploadsUrl(b.narration, 'Narration') : null,
        music: b.music ? uploadsUrl(b.music, 'Music') : null,
        musicVolume: Number.isFinite(Number(b.musicVolume)) ? Number(b.musicVolume) : undefined,
      }),
    );
    spend('film', u.id);
    res.json({ ...strip(r), quota: quota('film', u.id) });
  }),
);

// ---------------- Scriptorium ----------------
router.post(
  '/media/translate',
  h(async (req, res) => {
    const u = currentUser(req);
    limitIp(req, 'media-ai', 20);
    takeQuota('translate', u.id);
    const t = text(req.body?.text, I.TRANSLATE_MAX_CHARS, 'Text');
    const r = await run(I.cfTranslate(t, str(req.body?.target), WS('translate'), str(req.body?.source) || 'en'));
    spend('translate', u.id);
    res.json({ ...r, provider: 'cloudflare', name: 'Cloudflare Workers AI', quota: quota('translate', u.id) });
  }),
);

// ---------------- Forge (GitHub Pages) ----------------
router.get(
  '/media/sites/:slug',
  h(async (req, res) => {
    limitIp(req, 'media-search', 20);
    const slug = await run(I.checkSlug(req.params.slug));
    res.json({ slug, url: I.siteUrl(slug), status: await I.siteStatus(slug, WS('pages-status')), at: now() });
  }),
);

// ---------------- admin ----------------
function admin(req: Request) {
  if (!isAdmin(req.header('x-admin-key'))) throw new HttpError(401, 'Admin key required.');
}

/** Publishing arbitrary HTML is admin-only (Forge agents call I.publishSite from server code). */
router.post(
  '/admin/publish',
  h(async (req, res) => {
    admin(req);
    const html = typeof req.body?.html === 'string' ? req.body.html : '';
    res.json(await run(I.publishSite(str(req.body?.slug), html, { context: 'realm', ref: 'admin-publish' })));
  }),
);

router.get(
  '/admin/herald',
  h((req, res) => {
    admin(req);
    const s = q(req, 'status') as HeraldStatus;
    const ok = ['pending', 'approved', 'posted', 'rejected', 'failed'].includes(s);
    res.json({ posts: listHerald(ok ? s : undefined), bluesky: I.bskyEnabled(), x: xInfo(), at: now() });
  }),
);
router.post(
  '/admin/herald',
  h(async (req, res) => {
    admin(req);
    const b = req.body ?? {};
    // Wrapped so a validation error becomes a 400 with its message (queueHeraldDraft throws synchronously).
    const draft = async () =>
      queueHeraldDraft({
        text: str(b.text),
        image: str(b.image) || null,
        alt: str(b.alt) || null,
        decreeId: str(b.decreeId) || null,
        network: b.network === 'x' ? 'x' : 'bluesky',
        source: 'admin',
        scheduledAt: str(b.scheduledAt) || null,
      });
    res.json(await run(draft()));
  }),
);
router.post(
  '/admin/herald/:id/approve',
  h(async (req, res) => {
    admin(req);
    if (!heraldPost(req.params.id)) throw new HttpError(404, 'Draft not found.');
    res.json(await run(approveHerald(req.params.id)));
  }),
);
router.post(
  '/admin/herald/:id/reject',
  h(async (req, res) => {
    admin(req);
    if (!heraldPost(req.params.id)) throw new HttpError(404, 'Draft not found.');
    res.json(await run(rejectHerald(req.params.id, str(req.body?.reason) || undefined)));
  }),
);

// ---------------- X connect (OAuth 2.0) ----------------
/** Admin asks for the X authorize link; the browser then goes there. */
router.post(
  '/admin/x/connect',
  h((req, res) => {
    admin(req);
    res.json({ url: xConnectUrl() });
  }),
);
/** X sends the browser back here. Protected by the single-use state, not the admin key. */
router.get(
  '/admin/x/callback',
  h(async (req, res) => {
    const back = (p: Record<string, string>) => res.redirect(302, `/admin/herald?${new URLSearchParams(p)}`);
    if (q(req, 'error')) return back({ x: 'error', msg: 'X sign-in was cancelled.' });
    try {
      const r = await xCallback(q(req, 'code'), q(req, 'state'));
      back({ x: 'connected', user: r.username });
    } catch (e) {
      back({ x: 'error', msg: (e as Error).message.slice(0, 300) });
    }
  }),
);
router.post(
  '/admin/x/disconnect',
  h(async (req, res) => {
    admin(req);
    await xDisconnect();
    res.json(xInfo());
  }),
);

/** Read-only credential checks. Sends nothing anywhere. */
router.get(
  '/admin/checks',
  h(async (req, res) => {
    admin(req);
    const safe = async <T>(p: () => Promise<T>) => {
      try {
        return { ok: true, data: await p(), error: null as string | null };
      } catch (e) {
        return { ok: false, data: null, error: (e as Error).message };
      }
    };
    const [bluesky, telegram, discord, repo, pages, removebg] = await Promise.all([
      safe(async () => {
        const s = await I.bskySession(ADMIN, true);
        return { handle: s.handle };
      }),
      safe(() => telegramGetMe()),
      safe(async () => {
        const d = await discordWebhookInfo();
        return { ok: d.ok, name: d.name, error: d.error };
      }),
      safe(() => I.pagesRepoInfo(ADMIN)),
      safe(() => I.pagesStatus(ADMIN)),
      safe(() => I.removeBgAccount(ADMIN)),
    ]);
    res.json({ bluesky, telegram, discord, repo, pages, removebg, cloudflare: I.cfUsage(), notifyEnabled: notifyEnabled(), publishEnabled: I.publishEnabled(), at: now() });
  }),
);

/** How the server sees the caller's IP (to check TRUST_PROXY behind proxies). */
router.get(
  '/admin/ip',
  h((req, res) => {
    admin(req);
    res.json({ ip: req.ip, ips: req.ips, forwardedFor: req.get('x-forwarded-for') ?? null, cfConnectingIp: req.get('cf-connecting-ip') ?? null, trustProxy: req.app.get('trust proxy') });
  }),
);

/** Test message to Telegram + Discord. Dry run unless NOTIFY_ENABLED=1. */
router.post(
  '/admin/notify/test',
  h(async (req, res) => {
    admin(req);
    const msg = text(req.body?.text ?? 'Agentdom test message', 500, 'Text');
    res.json({ results: await Promise.all([notifyOwner(msg), notifyRealm(msg)]), at: now() });
  }),
);

// Keep the private usage table from growing forever.
setInterval(() => {
  try {
    db.prepare('DELETE FROM media_usage WHERE at < ?').run(new Date(Date.now() - 40 * 86400_000).toISOString());
  } catch {
    /* ignore */
  }
}, 6 * 3600_000).unref();
