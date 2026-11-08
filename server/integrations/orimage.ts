// Designed images via OpenRouter (Gemini image models): posters, ads and social graphics with
// legible text inside the picture. Paid per image from the realm's OpenRouter credit, so every
// call is costed from OpenRouter's own usage numbers and capped per day.
import { db, now, uid } from '../db';
import { fetchJson, type CallContext } from './http';
import { requireKey } from './keys';
import { saveUpload } from './media-common';

const P = 'openrouter';
export const OR_IMAGE_MODEL = process.env.OR_IMAGE_MODEL || 'google/gemini-3.1-flash-image';
const DAILY = Number(process.env.OR_IMAGE_DAILY) || 25;
export const OR_IMAGE_PROMPT_MAX = 1500;
export const OR_ASPECTS = ['1:1', '4:5', '9:16', '16:9', '3:2'] as const;
export type OrAspect = (typeof OR_ASPECTS)[number];

db.exec(`
CREATE TABLE IF NOT EXISTS or_image_runs (
  id TEXT PRIMARY KEY,
  ref TEXT,
  model TEXT NOT NULL,
  cost REAL NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 0,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS or_image_runs_at ON or_image_runs(at);
`);

const dayStart = () => new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z';
export function orImageToday() {
  const r = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(cost),0) AS cost FROM or_image_runs WHERE ok = 1 AND at >= ?').get(dayStart()) as { n: number; cost: number };
  return { images: Number(r.n), cost: Number(r.cost), cap: DAILY };
}
export function orImageTotal() {
  const r = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(cost),0) AS cost FROM or_image_runs WHERE ok = 1').get() as { n: number; cost: number };
  return { images: Number(r.n), cost: Number(r.cost) };
}

export interface DesignedImage {
  url: string;
  bytes: number;
  model: string;
  cost: number;
  aspect: OrAspect;
  note: string | null;
}

/** Render one designed image. Text that must appear in the picture goes in `text` (kept short). */
export async function designImage(prompt: string, ctx: CallContext, opts: { aspect?: OrAspect; text?: string } = {}): Promise<DesignedImage> {
  const key = requireKey(P);
  const p = prompt.trim();
  if (!p) throw new Error('prompt is required.');
  if (p.length > OR_IMAGE_PROMPT_MAX) throw new Error(`prompt is too long (max ${OR_IMAGE_PROMPT_MAX} characters).`);
  const aspect = opts.aspect && OR_ASPECTS.includes(opts.aspect) ? opts.aspect : '1:1';
  if (orImageToday().images >= DAILY) throw new Error('Today’s designed images are used up. Use generate_image instead, or try again tomorrow.');
  const text = opts.text?.trim().slice(0, 200);
  const full =
    `Create one finished, high-quality image (aspect ratio ${aspect}). ${p}` +
    (text ? `\nRender exactly this text in the image, spelled correctly, clearly legible, well placed: "${text}"` : '\nDo not add any text unless the description asks for it.') +
    '\nNo watermarks, no borders, no mock-up frames unless asked.';
  const r = await fetchJson<any>('https://openrouter.ai/api/v1/chat/completions', {
    provider: P,
    ctx,
    method: 'POST',
    ttlMs: 0,
    retries: 0,
    timeoutMs: 150_000,
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      'HTTP-Referer': 'https://agentdom.world',
      'X-Title': 'Agentdom',
    },
    body: JSON.stringify({
      model: OR_IMAGE_MODEL,
      messages: [{ role: 'user', content: full }],
      modalities: ['image', 'text'],
      image_config: { aspect_ratio: aspect },
      usage: { include: true },
    }),
  });
  const cost = Number(r.data?.usage?.cost) || 0;
  const msg = r.data?.choices?.[0]?.message;
  const dataUrl: string | undefined = msg?.images?.[0]?.image_url?.url;
  const m = typeof dataUrl === 'string' ? /^data:image\/[a-z+]+;base64,(.+)$/i.exec(dataUrl) : null;
  db.prepare('INSERT INTO or_image_runs (id, ref, model, cost, ok, at) VALUES (?,?,?,?,?,?)').run(uid('ori'), ctx.ref ? String(ctx.ref).slice(0, 120) : null, OR_IMAGE_MODEL, cost, m ? 1 : 0, now());
  if (!m) throw new Error(`The image model returned no image${typeof msg?.content === 'string' && msg.content ? `: ${msg.content.slice(0, 160)}` : '.'}`);
  const saved = saveUpload(Buffer.from(m[1], 'base64'), 'orimg', ['png', 'jpg', 'webp'], 'image');
  return { url: saved.url, bytes: saved.bytes, model: OR_IMAGE_MODEL, cost, aspect, note: typeof msg?.content === 'string' && msg.content.trim() ? msg.content.trim().slice(0, 300) : null };
}
