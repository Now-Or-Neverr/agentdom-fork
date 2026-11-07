// Shared helpers for the media clients: real file-type checks (magic bytes), saving into
// data/uploads (served at /uploads) and small usage counters for capped free tiers.
import fs from 'node:fs';
import path from 'node:path';
import { db, UPLOAD_DIR, uid } from '../db';

export type MediaExt = 'jpg' | 'png' | 'webp' | 'gif' | 'mp3' | 'wav' | 'ogg' | 'flac' | 'mp4' | 'webm' | 'm4a';

/** Detect a file type from its first bytes. Returns null for anything we do not accept. */
export function sniff(b: Buffer): MediaExt | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WAVE') return 'wav';
  if (b.subarray(0, 3).toString('latin1') === 'GIF') return 'gif';
  if (b.subarray(0, 3).toString('latin1') === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'mp3';
  if (b.subarray(0, 4).toString('latin1') === 'OggS') return 'ogg';
  if (b.subarray(0, 4).toString('latin1') === 'fLaC') return 'flac';
  if (b.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = b.subarray(8, 12).toString('latin1');
    return /^M4A|^M4B/.test(brand) ? 'm4a' : 'mp4';
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm';
  return null;
}
export const IMAGE_EXT: MediaExt[] = ['jpg', 'png', 'webp', 'gif'];
export const AUDIO_EXT: MediaExt[] = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'webm'];
export const VIDEO_EXT: MediaExt[] = ['mp4', 'webm'];

export const MIME: Record<MediaExt, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

export interface SavedFile {
  url: string; // '/uploads/<name>'
  file: string; // absolute path
  ext: MediaExt;
  bytes: number;
}

/** Check the bytes really are one of `allowed` and save them under data/uploads. */
export function saveUpload(buf: Buffer, prefix: string, allowed: MediaExt[], what = 'file'): SavedFile {
  const ext = sniff(buf);
  if (!ext || !allowed.includes(ext)) throw new Error(`The ${what} is not a valid ${allowed.join('/')} file.`);
  const name = `${prefix}-${uid(prefix).slice(prefix.length + 1)}.${ext}`;
  const file = path.join(UPLOAD_DIR, name);
  fs.writeFileSync(file, buf);
  return { url: `/uploads/${name}`, file, ext, bytes: buf.length };
}

/** Map '/uploads/x' or an absolute path inside UPLOAD_DIR to an existing file. */
export function resolveUpload(src: string): string {
  const s = String(src ?? '').split('?')[0];
  let file: string;
  if (s.startsWith('/uploads/')) file = path.join(UPLOAD_DIR, path.basename(s));
  else if (path.isAbsolute(s)) file = s;
  else throw new Error(`Media must be an /uploads/ URL: ${s.slice(0, 80)}`);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`File not found: ${s.slice(0, 80)}`);
  return file;
}

/** Decode a `data:<mime>;base64,...` string (browser uploads). */
export function fromDataUrl(s: unknown, maxBytes: number): Buffer {
  const m = /^data:[a-z]+\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)$/i.exec(String(s ?? ''));
  if (!m) throw new Error('Upload must be a base64 data URL.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > maxBytes) throw new Error(`The file must be ${Math.round(maxBytes / 1024 / 1024)} MB or smaller.`);
  return buf;
}

// ---------------- usage counters (capped free tiers) ----------------
db.exec(`
CREATE TABLE IF NOT EXISTS media_usage (
  id TEXT PRIMARY KEY,
  tool TEXT NOT NULL,
  who TEXT,
  units REAL NOT NULL DEFAULT 1,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS media_usage_tool ON media_usage(tool, at);
`);

export const utcDayStart = () => new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z';
export const utcMonthStart = () => new Date().toISOString().slice(0, 7) + '-01T00:00:00.000Z';

/** Units used by `tool` since `sinceIso` (optionally for one user). Private table: never exposed raw. */
export function usage(tool: string, sinceIso: string, who?: string): number {
  const row = (
    who
      ? db.prepare('SELECT COALESCE(SUM(units),0) AS n FROM media_usage WHERE tool = ? AND at >= ? AND who = ?').get(tool, sinceIso, who)
      : db.prepare('SELECT COALESCE(SUM(units),0) AS n FROM media_usage WHERE tool = ? AND at >= ?').get(tool, sinceIso)
  ) as { n: number };
  return Number(row.n) || 0;
}
export function recordUsage(tool: string, units: number, who?: string | null) {
  db.prepare('INSERT INTO media_usage (id, tool, who, units, at) VALUES (?,?,?,?,?)').run(uid('mu'), tool, who ?? null, units, new Date().toISOString());
}

/** Thrown when a free-tier cap would be exceeded. Routes map it to HTTP 429. */
export class QuotaError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'QuotaError';
  }
}

export const envOn = (k: string) => process.env[k] === '1' || process.env[k] === 'true';
