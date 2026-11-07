// remove.bg background removal → transparent PNG. The free plan has only 50 calls a month
// (preview size, up to 0.25 megapixels), so we keep two hard guards in our own database:
// - per user per UTC day: REMOVEBG_PER_USER_DAY (default 2)
// - all users per UTC month: REMOVEBG_MONTHLY (default 45, leaving a margin under 50)
import fs from 'node:fs';
import { fetchBuffer, fetchJson, UpstreamError, type CallContext } from './http';
import { providerKey } from './registry';
import { MIME, QuotaError, recordUsage, resolveUpload, saveUpload, sniff, usage, utcDayStart, utcMonthStart } from './media-common';

const TOOL = 'removebg';
const perUser = () => Number(process.env.REMOVEBG_PER_USER_DAY) || 2;
const monthly = () => Math.min(50, Number(process.env.REMOVEBG_MONTHLY) || 45);

export interface RemoveBgQuota {
  usedToday: number;
  perUserDay: number;
  usedThisMonth: number;
  monthly: number;
  left: number; // what this user can still do today
}
/** Quota for one caller (`who` = a private user id; it is never logged to api_calls). */
export function removeBgQuota(who: string): RemoveBgQuota {
  const usedToday = usage(TOOL, utcDayStart(), who);
  const usedThisMonth = usage(TOOL, utcMonthStart());
  return {
    usedToday,
    perUserDay: perUser(),
    usedThisMonth,
    monthly: monthly(),
    left: Math.max(0, Math.min(perUser() - usedToday, monthly() - usedThisMonth)),
  };
}

export interface Cutout {
  url: string; // '/uploads/…png'
  file: string;
  source: string;
  bytes: number;
  width: number | null;
  height: number | null;
  quota: RemoveBgQuota;
  sourceUrl: string;
  fetchedAt: string;
}

function pngSize(b: Buffer): { w: number; h: number } | null {
  return b.length > 24 && b.subarray(12, 16).toString('latin1') === 'IHDR' ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : null;
}

/** Cut out the subject of a local image. Throws QuotaError before calling if a guard is hit. */
export async function removeBackground(src: string, who: string, ctx: CallContext): Promise<Cutout> {
  const key = providerKey('removebg');
  if (!key) throw new UpstreamError('removebg', 0, 'remove.bg is not configured on this server.');
  const q = removeBgQuota(who);
  if (q.usedThisMonth >= q.monthly) throw new QuotaError(`The realm has used this month's free background removals (${q.monthly}). They renew on the 1st (UTC).`);
  if (q.usedToday >= q.perUserDay) throw new QuotaError(`You can remove ${q.perUserDay} backgrounds per day. Come back tomorrow.`);
  const file = resolveUpload(src);
  const buf = fs.readFileSync(file);
  const ext = sniff(buf);
  if (!ext || !['jpg', 'png', 'webp'].includes(ext)) throw new Error('remove.bg accepts JPG, PNG or WebP images.');
  if (buf.length > 12 * 1024 * 1024) throw new Error('The image must be 12 MB or smaller.');

  const form = new FormData();
  form.append('image_file', new Blob([new Uint8Array(buf)], { type: MIME[ext] }), `image.${ext}`);
  form.append('size', 'preview'); // free plan resolution (≤ 0.25 MP)
  form.append('format', 'png');
  const r = await fetchBuffer('https://api.remove.bg/v1.0/removebg', {
    provider: 'removebg',
    ctx,
    method: 'POST',
    body: form,
    timeoutMs: 60_000,
    retries: 0,
    accept: 'image/png, application/json',
    headers: { 'X-Api-Key': key },
    okStatuses: [400, 402, 403, 429],
  });
  const out = r.data.buf;
  if (r.status >= 400) {
    let msg = '';
    try {
      msg = (JSON.parse(out.toString('utf8')) as { errors?: { title?: string }[] }).errors?.map((e) => e.title).join('; ') ?? '';
    } catch {
      /* not JSON */
    }
    if (r.status === 402) {
      recordUsage(TOOL, Math.max(0, monthly() - usage(TOOL, utcMonthStart()))); // remove.bg says we're out: trust it
      throw new QuotaError('remove.bg free credits for this month are used up.');
    }
    if (r.status === 429) throw new UpstreamError('removebg', 429, 'remove.bg is rate limiting us. Try again in a minute.');
    throw new UpstreamError('removebg', r.status, `remove.bg could not process the image${msg ? `: ${msg.slice(0, 160)}` : '.'}`);
  }
  const saved = saveUpload(out, 'cut', ['png'], 'cut-out');
  recordUsage(TOOL, 1, who);
  const size = pngSize(out);
  return {
    url: saved.url,
    file: saved.file,
    source: src,
    bytes: saved.bytes,
    width: size?.w ?? null,
    height: size?.h ?? null,
    quota: removeBgQuota(who),
    sourceUrl: 'https://www.remove.bg',
    fetchedAt: r.fetchedAt,
  };
}

/** Read-only: remaining free API calls on the remove.bg account (costs no credit). */
export async function removeBgAccount(ctx: CallContext): Promise<{ freeCalls: number | null; credits: number | null; fetchedAt: string }> {
  const key = providerKey('removebg');
  if (!key) throw new UpstreamError('removebg', 0, 'remove.bg is not configured on this server.');
  const r = await fetchJson<{ data?: { attributes?: { credits?: { total?: number }; api?: { free_calls?: number } } } }>('https://api.remove.bg/v1.0/account', {
    provider: 'removebg',
    ctx,
    ttlMs: 60_000,
    headers: { 'X-Api-Key': key },
  });
  const a = r.data?.data?.attributes;
  return { freeCalls: a?.api?.free_calls ?? null, credits: a?.credits?.total ?? null, fetchedAt: r.fetchedAt };
}

