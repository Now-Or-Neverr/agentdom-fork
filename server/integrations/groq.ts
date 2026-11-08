// Groq speech-to-text (Whisper large-v3 turbo). Free tier: files up to 25 MB, billed per audio
// second (minimum 10 s) with hourly/daily audio-second limits. We download the file ourselves
// with a size cap, shrink video or large audio to a small mono MP3 with ffmpeg, and send it as
// multipart. The key goes in the Authorization header.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fetchJson, UpstreamError, type CallContext } from './http';
import { requireKey } from './keys';
import { resolveUpload, sniff, AUDIO_EXT, MIME, type MediaExt } from './media-common';
import { audioToMp3, probeMedia } from './video';
import { downloadPublic } from './download';
import { uid } from '../db';

const P = 'groq';
export const GROQ_STT_MODEL = 'whisper-large-v3-turbo';
/** Groq free-tier upload limit. */
export const GROQ_MAX_UPLOAD = 25 * 1024 * 1024;
/** What we accept from a link before shrinking (video files are larger than their audio). */
export const GROQ_MAX_DOWNLOAD = 80 * 1024 * 1024;
export const GROQ_MAX_SEC = 20 * 60;

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}
export interface Transcript {
  text: string;
  language: string | null;
  durationSec: number;
  segments: TranscriptSegment[];
  srt: string;
  model: string;
  /** true when only the first GROQ_MAX_SEC seconds were transcribed */
  truncated: boolean;
  source: string;
  sourceUrl: string;
  fetchedAt: string;
}

const ts = (s: number) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(sec)},${pad(ms % 1000, 3)}`;
};
export function toSrt(segs: TranscriptSegment[]): string {
  return segs
    .filter((s) => s.text.trim())
    .map((s, k) => `${k + 1}\n${ts(s.start)} --> ${ts(s.end)}\n${s.text.trim()}\n`)
    .join('\n');
}

/** Transcribe a public audio/video link or an /uploads/ file. */
export async function groqTranscribe(src: { url?: string; upload?: string }, ctx: CallContext, opts: { language?: string } = {}): Promise<Transcript> {
  const key = requireKey(P);
  let file: string;
  let tmp: string | null = null;
  let source: string;
  if (src.upload) {
    file = resolveUpload(src.upload);
    source = src.upload;
  } else if (src.url) {
    const d = await downloadPublic(src.url, GROQ_MAX_DOWNLOAD, 90_000);
    const ext = sniff(d.buf);
    if (!ext || !(AUDIO_EXT as MediaExt[]).concat(['mp4']).includes(ext)) throw new Error('That link is not an audio or video file I can read (mp3, wav, ogg, flac, m4a, mp4 or webm).');
    tmp = path.join(os.tmpdir(), `stt-${uid('t').slice(2)}.${ext}`);
    fs.writeFileSync(tmp, d.buf);
    file = tmp;
    source = d.finalUrl;
  } else throw new Error('Give a public audio/video link or an /uploads/ file.');
  try {
    const buf0 = fs.readFileSync(file);
    const ext = sniff(buf0);
    if (!ext || !(AUDIO_EXT as MediaExt[]).concat(['mp4']).includes(ext)) throw new Error('That file is not a supported audio or video file.');
    const probe = await probeMedia(file);
    if (probe.video && !probe.audio) throw new Error('That video has no audio track.');
    let dur = probe.durationSec;
    const truncated = dur > GROQ_MAX_SEC;
    let buf = buf0;
    let sendExt: MediaExt = ext;
    // Video, long or large files: keep only the audio as a 48 kb/s mono MP3 (20 min ≈ 7 MB).
    if (probe.video || ext === 'mp4' || buf.length > 15 * 1024 * 1024 || truncated || !(dur > 0)) {
      buf = await audioToMp3(file, { maxSec: GROQ_MAX_SEC });
      sendExt = 'mp3';
      if (!(dur > 0)) dur = Math.round(((buf.length * 8) / 48_000) * 100) / 100;
    }
    if (buf.length > GROQ_MAX_UPLOAD) throw new Error('The audio is still larger than 25 MB after compression.');
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buf)], { type: MIME[sendExt] }), `audio.${sendExt}`);
    form.append('model', GROQ_STT_MODEL);
    form.append('response_format', 'verbose_json');
    form.append('temperature', '0');
    if (opts.language && /^[a-z]{2}$/.test(opts.language)) form.append('language', opts.language);
    const r = await fetchJson<any>('https://api.groq.com/openai/v1/audio/transcriptions', {
      provider: P,
      ctx,
      method: 'POST',
      body: form,
      timeoutMs: 180_000,
      retries: 0,
      headers: { authorization: `Bearer ${key}` },
      okStatuses: [400, 413, 429],
    });
    if (r.status === 429) throw new UpstreamError(P, 429, 'Groq’s free transcription limit is reached for now. Try again later.');
    if (r.status >= 400) throw new UpstreamError(P, r.status, `Groq could not transcribe the file${r.data?.error?.message ? `: ${String(r.data.error.message).slice(0, 160)}` : '.'}`);
    const segments: TranscriptSegment[] = ((r.data?.segments ?? []) as any[]).map((s) => ({ start: Number(s.start) || 0, end: Number(s.end) || 0, text: String(s.text ?? '').trim() }));
    const lang = typeof r.data?.language === 'string' ? r.data.language : null;
    return {
      text: String(r.data?.text ?? '').trim(),
      language: lang,
      durationSec: Math.round((Number(r.data?.duration) || Math.min(dur, GROQ_MAX_SEC)) * 100) / 100,
      segments,
      srt: toSrt(segments),
      model: GROQ_STT_MODEL,
      truncated,
      source,
      sourceUrl: 'https://console.groq.com/docs/speech-to-text',
      fetchedAt: r.fetchedAt,
    };
  } finally {
    if (tmp) fs.rmSync(tmp, { force: true });
  }
}
