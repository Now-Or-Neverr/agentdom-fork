// ElevenLabs text-to-speech → MP3 in data/uploads. Free plan: ~10,000 credits a month,
// non-commercial use, attribution required ("Voice by ElevenLabs"). Model eleven_flash_v2_5
// (32 languages, about half a credit per character). Before every call we check the credits
// left and refuse when fewer remain than the text has characters:
// - from GET /v1/user/subscription when the key has the user_read permission
// - otherwise from our own counter (the credits ElevenLabs reports per call in the
//   `character-cost` header) against ELEVENLABS_MONTHLY_CREDITS (default 9,000) per UTC month.
// The key goes in the `xi-api-key` header.
import { fetchBuffer, fetchJson, UpstreamError, type CallContext } from './http';
import { requireKey } from './keys';
import { QuotaError, recordUsage, saveUpload, usage, utcMonthStart } from './media-common';
import { probeMedia } from './video';

const P = 'elevenlabs';
const BASE = 'https://api.elevenlabs.io/v1';
export const ELEVEN_MODEL = 'eleven_flash_v2_5';
export const VOICE_MAX_CHARS = 1500;
export const ELEVEN_ATTRIBUTION = 'Voice by ElevenLabs';

export interface ElevenVoice {
  id: string;
  name: string;
  description: string;
}
/** Default voices a free-plan key may use through the API (each checked with a real call on 2026-11-08;
 *  library voices such as Rachel need a paid plan). */
export const ELEVEN_VOICE_LIST: ElevenVoice[] = [
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', description: 'male, British, warm narrator' },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', description: 'male, British, news presenter' },
  { id: 'nPczCjzI2devNBz1zQrb', name: 'Brian', description: 'male, American, deep' },
  { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', description: 'male, American, young' },
  { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice', description: 'female, British, clear' },
  { id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura', description: 'female, American, young' },
  { id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica', description: 'female, American, expressive' },
  { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', description: 'female, American, warm' },
  { id: 'SAz9YHcvj6GT2YYXdXww', name: 'River', description: 'neutral, American, calm' },
];
export const ELEVEN_VOICES = ELEVEN_VOICE_LIST.map((v) => v.name);

const h = () => ({ 'xi-api-key': requireKey(P) });
const TOOL = 'elevenlabs';
const monthlyCredits = () => Number(process.env.ELEVENLABS_MONTHLY_CREDITS) || 9000;

export interface ElevenQuota {
  used: number;
  limit: number;
  left: number;
  resetsAt: string | null;
  /** 'account' = read from ElevenLabs, 'local' = our own counter (the key lacks user_read) */
  basis: 'account' | 'local';
}
export async function elevenQuota(ctx: CallContext): Promise<ElevenQuota> {
  const r = await fetchJson<any>(`${BASE}/user/subscription`, { provider: P, ctx, ttlMs: 0, retries: 0, headers: h(), okStatuses: [401] });
  const used = Number(r.data?.character_count ?? NaN);
  const limit = Number(r.data?.character_limit ?? NaN);
  if (r.status === 200 && Number.isFinite(used) && Number.isFinite(limit)) {
    const reset = Number(r.data?.next_character_count_reset_unix);
    return { used, limit, left: Math.max(0, limit - used), resetsAt: Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toISOString() : null, basis: 'account' };
  }
  const missingPerm = r.status === 401 && /missing_permissions/.test(JSON.stringify(r.data ?? ''));
  if (!missingPerm) throw new UpstreamError(P, r.status, `ElevenLabs returned HTTP ${r.status} for the credit check.`);
  const mine = usage(TOOL, utcMonthStart());
  const next = new Date();
  next.setUTCMonth(next.getUTCMonth() + 1, 1);
  return { used: mine, limit: monthlyCredits(), left: Math.max(0, monthlyCredits() - mine), resetsAt: next.toISOString().slice(0, 10) + 'T00:00:00.000Z', basis: 'local' };
}

export interface Voiceover {
  url: string;
  file: string;
  bytes: number;
  durationSec: number | null;
  voice: string;
  voiceId: string;
  model: string;
  chars: number;
  credits: number;
  quotaLeft: number;
  attribution: string;
  sourceUrl: string;
  fetchedAt: string;
}

export async function elevenSpeak(text: string, ctx: CallContext, opts: { voice?: string } = {}): Promise<Voiceover> {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) throw new Error('text is required.');
  if (t.length > VOICE_MAX_CHARS) throw new Error(`Voice-over text must be ${VOICE_MAX_CHARS} characters or fewer.`);
  const want = (opts.voice || ELEVEN_VOICE_LIST[0].name).trim().toLowerCase();
  const v = ELEVEN_VOICE_LIST.find((x) => x.name.toLowerCase() === want);
  if (!v) throw new Error(`voice must be one of: ${ELEVEN_VOICES.join(', ')}.`);
  const q = await elevenQuota(ctx);
  if (q.left < t.length)
    throw new QuotaError(`The realm’s ElevenLabs voice credits are nearly used up (${q.left} left, this text may need up to ${t.length}). They renew${q.resetsAt ? ` around ${q.resetsAt.slice(0, 10)}` : ' next month'}.`);
  const r = await fetchBuffer(`${BASE}/text-to-speech/${v.id}?output_format=mp3_44100_128`, {
    provider: P,
    ctx,
    method: 'POST',
    body: JSON.stringify({ text: t, model_id: ELEVEN_MODEL }),
    headers: { ...h(), 'content-type': 'application/json' },
    accept: 'audio/mpeg',
    timeoutMs: 90_000,
    retries: 0,
    okStatuses: [400, 401, 402, 404, 422, 429],
  });
  if (r.status >= 400) {
    let msg = '';
    try {
      const j = JSON.parse(r.data.buf.toString('utf8'));
      msg = String(j?.detail?.message ?? j?.detail?.status ?? j?.detail ?? '');
    } catch {
      /* not JSON */
    }
    if (r.status === 429 || (r.status === 401 && /quota/i.test(msg))) throw new QuotaError(`ElevenLabs is out of credits or busy right now${msg ? ` (${msg.slice(0, 120)})` : ''}.`);
    throw new UpstreamError(P, r.status, `ElevenLabs could not record the voice-over${msg ? `: ${msg.slice(0, 160)}` : '.'}`);
  }
  const saved = saveUpload(r.data.buf, 'vo', ['mp3'], 'voice-over');
  const cost = Number(r.data.headers?.['character-cost']);
  const credits = Number.isFinite(cost) && cost >= 0 ? cost : t.length;
  recordUsage(TOOL, credits);
  let durationSec: number | null = null;
  try {
    durationSec = (await probeMedia(saved.file)).durationSec || null;
  } catch {
    /* ffmpeg missing: leave unknown */
  }
  return {
    url: saved.url,
    file: saved.file,
    bytes: saved.bytes,
    durationSec,
    voice: v.name,
    voiceId: v.id,
    model: ELEVEN_MODEL,
    chars: t.length,
    credits,
    quotaLeft: Math.max(0, q.left - credits),
    attribution: ELEVEN_ATTRIBUTION,
    sourceUrl: 'https://elevenlabs.io',
    fetchedAt: r.fetchedAt,
  };
}
