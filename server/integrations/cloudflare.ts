// Cloudflare Workers AI (REST). Free plan = 10,000 neurons per day (resets 00:00 UTC).
// We keep a local estimate of neurons spent today (prices from
// https://developers.cloudflare.com/workers-ai/platform/pricing/) and refuse a call that would
// pass CF_NEURON_BUDGET (default 9,000, leaving a margin). If Cloudflare itself says the daily
// allocation is used up, we mark the day as spent and fail with an honest message.
// The account id sits in the URL path, so every call is logged as "workers-ai:<model>".
import fs from 'node:fs';
import { fetchJson, UpstreamError, type CallContext } from './http';
import { providerKey } from './registry';
import { QuotaError, recordUsage, resolveUpload, saveUpload, sniff, usage, utcDayStart, AUDIO_EXT } from './media-common';
import { audioToMp3, probeMedia } from './video';

export const CF_MODELS = {
  image: '@cf/black-forest-labs/flux-1-schnell',
  tts: '@cf/myshell-ai/melotts',
  stt: '@cf/openai/whisper-large-v3-turbo',
  translate: '@cf/meta/m2m100-1.2b',
  vision: '@cf/meta/llama-4-scout-17b-16e-instruct',
} as const;

const DAILY_FREE = 10_000;
const budget = () => Math.min(DAILY_FREE, Number(process.env.CF_NEURON_BUDGET) || 9_000);
const TOOL = 'cf-neurons';

export interface CfUsage {
  /** Estimated neurons used today (UTC), from our own call log. */
  usedToday: number;
  budget: number;
  left: number;
  resetsAt: string;
  estimate: true;
}
export function cfUsage(): CfUsage {
  const used = Math.round(usage(TOOL, utcDayStart()));
  const b = budget();
  const reset = new Date(utcDayStart());
  reset.setUTCDate(reset.getUTCDate() + 1);
  return { usedToday: used, budget: b, left: Math.max(0, b - used), resetsAt: reset.toISOString(), estimate: true };
}

function guard(estimate: number) {
  const u = cfUsage();
  if (u.usedToday + estimate > u.budget)
    throw new QuotaError(`Cloudflare Workers AI daily free allowance is used up (about ${u.usedToday} of ${u.budget} neurons today). It resets at 00:00 UTC.`);
}

export const cfEnabled = () => Boolean(providerKey('cloudflare') && process.env.CLOUDFLARE_ACCOUNT_ID);

interface CfEnvelope<T> {
  success?: boolean;
  result?: T;
  errors?: { code?: number; message?: string }[];
}

/** Run one model. `est` = neurons this call is expected to cost (charged up front, corrected after). */
async function runModel<T>(model: string, body: unknown, ctx: CallContext, est: number, timeoutMs = 60_000): Promise<{ result: T; fetchedAt: string }> {
  const token = providerKey('cloudflare');
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) throw new UpstreamError('cloudflare', 0, 'Cloudflare Workers AI is not configured on this server.');
  guard(est);
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/run/${model}`;
  const r = await fetchJson<CfEnvelope<T>>(url, {
    provider: 'cloudflare',
    ctx,
    method: 'POST',
    ttlMs: 0,
    timeoutMs,
    retries: 1,
    body: JSON.stringify(body),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    okStatuses: [400, 401, 403, 404, 408, 413, 422, 429],
    logEndpoint: `workers-ai:${model}`,
  });
  const env = r.data ?? {};
  if (r.status >= 400 || env.success === false || env.result === undefined) {
    const msg = (env.errors ?? []).map((e) => e.message).filter(Boolean).join('; ') || `HTTP ${r.status}`;
    if (r.status === 429 || /neuron|allocation|quota|daily limit/i.test(msg)) {
      const u = cfUsage();
      if (u.left > 0) recordUsage(TOOL, u.left); // Cloudflare says we're out: trust it for today
      throw new QuotaError('Cloudflare Workers AI daily free allowance (10,000 neurons) is used up. It resets at 00:00 UTC.');
    }
    if (r.status === 401 || r.status === 403) throw new UpstreamError('cloudflare', r.status, 'Cloudflare rejected the API token (check its Workers AI permission).');
    throw new UpstreamError('cloudflare', r.status, `Cloudflare Workers AI error: ${msg.slice(0, 200)}`);
  }
  return { result: env.result, fetchedAt: r.fetchedAt };
}

// ---------------- text to image ----------------
export interface CfImage {
  url: string;
  file: string;
  prompt: string;
  model: string;
  steps: number;
  bytes: number;
  type: string;
  neurons: number;
  sourceUrl: string;
  fetchedAt: string;
}
/** FLUX.1 [schnell] image (1024x1024 JPEG). ~4 tiles x 4.8 + steps x 9.6 neurons (≈58 at 4 steps). */
export async function cfImage(prompt: string, ctx: CallContext, opts: { steps?: number } = {}): Promise<CfImage> {
  const p = prompt.trim().replace(/\s+/g, ' ').slice(0, 2000);
  if (!p) throw new Error('Prompt is empty.');
  const steps = Math.min(8, Math.max(1, Math.round(opts.steps ?? 4)));
  const est = 4 * 4.8 + steps * 9.6;
  const { result, fetchedAt } = await runModel<{ image?: string }>(CF_MODELS.image, { prompt: p, steps }, ctx, est, 90_000);
  if (!result.image) throw new UpstreamError('cloudflare', 200, 'Cloudflare returned no image.');
  const buf = Buffer.from(result.image, 'base64');
  if (buf.length < 2000) throw new UpstreamError('cloudflare', 200, 'Cloudflare returned an image that is too small to be real.');
  const saved = saveUpload(buf, 'cfimg', ['jpg', 'png', 'webp'], 'generated image');
  recordUsage(TOOL, est);
  return { url: saved.url, file: saved.file, prompt: p, model: CF_MODELS.image, steps, bytes: saved.bytes, type: saved.ext, neurons: Math.round(est), sourceUrl: 'https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/', fetchedAt };
}

// ---------------- text to speech ----------------
export const TTS_LANGS = ['en', 'es', 'fr', 'zh', 'ja', 'ko'] as const;
export type TtsLang = (typeof TTS_LANGS)[number];
export interface CfSpeech {
  url: string;
  file: string;
  text: string;
  lang: TtsLang;
  model: string;
  durationSec: number;
  bytes: number;
  type: string;
  neurons: number;
  sourceUrl: string;
  fetchedAt: string;
}
/** WAV duration from its header (fmt byte rate + data chunk size). */
function wavSeconds(b: Buffer): number {
  if (b.subarray(0, 4).toString('latin1') !== 'RIFF') return 0;
  let off = 12;
  let byteRate = 0;
  while (off + 8 <= b.length) {
    const id = b.subarray(off, off + 4).toString('latin1');
    const size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') byteRate = b.readUInt32LE(off + 16);
    if (id === 'data') return byteRate ? Math.min(size, b.length - off - 8) / byteRate : 0;
    off += 8 + size + (size % 2);
  }
  return 0;
}
export const TTS_MAX_CHARS = 1500;
/** MeloTTS narration (WAV). 18.63 neurons per audio minute. Languages: en es fr zh ja ko. */
export async function cfSpeak(text: string, ctx: CallContext, opts: { lang?: string } = {}): Promise<CfSpeech> {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) throw new Error('Text is empty.');
  if (t.length > TTS_MAX_CHARS) throw new Error(`Narration text must be ${TTS_MAX_CHARS} characters or fewer.`);
  const lang = (TTS_LANGS as readonly string[]).includes(opts.lang ?? 'en') ? ((opts.lang ?? 'en') as TtsLang) : 'en';
  const estMin = Math.max(0.1, t.length / 14 / 60); // ~14 chars per second of speech
  const { result, fetchedAt } = await runModel<{ audio?: string }>(CF_MODELS.tts, { prompt: t, lang }, ctx, estMin * 18.63 + 1, 90_000);
  if (!result.audio) throw new UpstreamError('cloudflare', 200, 'Cloudflare returned no audio.');
  const buf = Buffer.from(result.audio, 'base64');
  const saved = saveUpload(buf, 'tts', AUDIO_EXT, 'narration');
  const dur = saved.ext === 'wav' ? wavSeconds(buf) : (await probeMedia(saved.file)).durationSec;
  if (!(dur > 0.2)) {
    fs.rmSync(saved.file, { force: true });
    throw new UpstreamError('cloudflare', 200, 'Cloudflare returned empty audio.');
  }
  const neurons = (dur / 60) * 18.63;
  recordUsage(TOOL, neurons);
  return { url: saved.url, file: saved.file, text: t, lang, model: CF_MODELS.tts, durationSec: Math.round(dur * 100) / 100, bytes: saved.bytes, type: saved.ext, neurons: Math.round(neurons * 100) / 100, sourceUrl: 'https://developers.cloudflare.com/workers-ai/models/melotts/', fetchedAt };
}

// ---------------- speech to text ----------------
export interface CfTranscript {
  text: string;
  language: string | null;
  durationSec: number;
  wordCount: number | null;
  vtt: string | null;
  model: string;
  neurons: number;
  sourceUrl: string;
  fetchedAt: string;
}
export const STT_MAX_SEC = 300;
/** Whisper large-v3-turbo transcription of a local audio file (/uploads/...). 46.63 neurons per audio minute. */
export async function cfTranscribe(src: string, ctx: CallContext, opts: { language?: string } = {}): Promise<CfTranscript> {
  const file = resolveUpload(src);
  let buf = fs.readFileSync(file);
  const ext = sniff(buf);
  if (!ext || !AUDIO_EXT.concat(['mp4']).includes(ext)) throw new Error('That file is not a supported audio file.');
  if (buf.length > 20 * 1024 * 1024) throw new Error('Audio must be 20 MB or smaller.');
  let dur = (await probeMedia(file)).durationSec;
  let mp3: Buffer | null = null;
  if (!(dur > 0)) {
    // Live MediaRecorder webm/ogg files carry no duration header: decode to mp3 (capped at
    // STT_MAX_SEC) and measure that instead (48 kb/s constant bitrate).
    mp3 = await audioToMp3(file, { maxSec: STT_MAX_SEC });
    dur = Math.round(((mp3.length * 8) / 48_000) * 100) / 100;
  }
  if (!(dur > 0)) throw new Error('Could not read the audio duration.');
  if (dur > STT_MAX_SEC) throw new Error(`Audio must be ${STT_MAX_SEC / 60} minutes or shorter.`);
  // Browser recordings (webm/ogg/m4a) and big WAVs become a small mono mp3 first.
  if (mp3) buf = mp3;
  else if (ext !== 'mp3' || buf.length > 4 * 1024 * 1024) buf = await audioToMp3(file, { maxSec: STT_MAX_SEC });
  const neurons = (dur / 60) * 46.63;
  const body: Record<string, unknown> = { audio: buf.toString('base64'), task: 'transcribe', vad_filter: true };
  if (opts.language && /^[a-z]{2}$/.test(opts.language)) body.language = opts.language;
  const { result, fetchedAt } = await runModel<{ text?: string; transcription_info?: { language?: string; duration?: number }; word_count?: number; vtt?: string }>(
    CF_MODELS.stt,
    body,
    ctx,
    neurons,
    120_000,
  );
  recordUsage(TOOL, neurons);
  return {
    text: (result.text ?? '').trim(),
    language: result.transcription_info?.language ?? null,
    durationSec: Math.round(dur * 100) / 100,
    wordCount: typeof result.word_count === 'number' ? result.word_count : null,
    vtt: result.vtt ?? null,
    model: CF_MODELS.stt,
    neurons: Math.round(neurons * 100) / 100,
    sourceUrl: 'https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/',
    fetchedAt,
  };
}

// ---------------- translation ----------------
export interface CfTranslation {
  text: string;
  translated: string;
  source: string;
  target: string;
  model: string;
  neurons: number;
  sourceUrl: string;
  fetchedAt: string;
}
export const TRANSLATE_MAX_CHARS = 3000;
/** M2M100 1.2B translation. Language codes like en, id, fr, de, ja. 31,050 neurons per M tokens each way. */
export async function cfTranslate(text: string, target: string, ctx: CallContext, source = 'en'): Promise<CfTranslation> {
  const t = text.trim();
  if (!t) throw new Error('Text is empty.');
  if (t.length > TRANSLATE_MAX_CHARS) throw new Error(`Text must be ${TRANSLATE_MAX_CHARS} characters or fewer.`);
  const lang = (s: string, name: string) => {
    const v = String(s ?? '').trim().toLowerCase();
    if (!/^[a-z]{2,3}$/.test(v)) throw new Error(`${name} must be a language code such as en, id or fr.`);
    return v;
  };
  const tgt = lang(target, 'Target language');
  const src = lang(source, 'Source language');
  const neurons = ((t.length / 3) * 2 * 31_050) / 1_000_000 + 0.5;
  const { result, fetchedAt } = await runModel<{ translated_text?: string }>(CF_MODELS.translate, { text: t, source_lang: src, target_lang: tgt }, ctx, neurons);
  if (!result.translated_text) throw new UpstreamError('cloudflare', 200, 'Cloudflare returned no translation.');
  recordUsage(TOOL, neurons);
  return { text: t, translated: result.translated_text.trim(), source: src, target: tgt, model: CF_MODELS.translate, neurons: Math.round(neurons * 100) / 100, sourceUrl: 'https://developers.cloudflare.com/workers-ai/models/m2m100-1.2b/', fetchedAt };
}

// ---------------- image to alt text (vision) ----------------
export interface CfAltText {
  alt: string;
  model: string;
  neurons: number;
  sourceUrl: string;
  fetchedAt: string;
}
const VISION = '@cf/meta/llama-4-scout-17b-16e-instruct';
// Llama 4 Scout: $0.27 / M input tokens, $0.85 / M output tokens → neurons per token:
const IN_N = 24_545 / 1_000_000;
const OUT_N = 77_273 / 1_000_000;
/** One-sentence alt text for a local image (≤ 4 MB) with Llama 4 Scout (vision). ~40-60 neurons. */
export async function cfAltText(src: string, ctx: CallContext, opts: { detail?: 'short' | 'long' } = {}): Promise<CfAltText> {
  const file = resolveUpload(src);
  const buf = fs.readFileSync(file);
  const ext = sniff(buf);
  if (!ext || !['jpg', 'png', 'webp'].includes(ext)) throw new Error('That file is not a supported image (JPG, PNG or WebP).');
  if (buf.length > 4 * 1024 * 1024) throw new Error('The image must be 4 MB or smaller.');
  const long = opts.detail === 'long';
  const maxTokens = long ? 160 : 70;
  const est = 2000 * IN_N + maxTokens * OUT_N;
  const ask = long
    ? 'Describe this image for a blind reader in 2-3 plain sentences. Only describe what is visible. No preamble.'
    : 'Write alt text for this image: one plain sentence, under 25 words, only what is visible. No preamble, no quotes.';
  const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  const { result, fetchedAt } = await runModel<{ choices?: { message?: { content?: string } }[]; response?: string; usage?: { prompt_tokens?: number; completion_tokens?: number } }>(
    VISION,
    { max_tokens: maxTokens, temperature: 0.2, messages: [{ role: 'user', content: [{ type: 'text', text: ask }, { type: 'image_url', image_url: { url: `data:${mime};base64,${buf.toString('base64')}` } }] }] },
    ctx,
    est,
    90_000,
  );
  const text = (result.choices?.[0]?.message?.content ?? result.response ?? '').trim();
  if (!text) throw new UpstreamError('cloudflare', 200, 'Cloudflare returned no description.');
  const u = result.usage;
  const neurons = u?.prompt_tokens ? u.prompt_tokens * IN_N + (u.completion_tokens ?? maxTokens) * OUT_N : est;
  recordUsage(TOOL, neurons);
  return { alt: text.replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').slice(0, 600), model: VISION, neurons: Math.round(neurons * 100) / 100, sourceUrl: 'https://developers.cloudflare.com/workers-ai/models/llama-4-scout-17b-16e-instruct/', fetchedAt };
}
