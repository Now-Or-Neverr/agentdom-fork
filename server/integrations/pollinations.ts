// Pollinations text-to-image. Bytes are downloaded on the server, checked to be a real image
// and saved to data/uploads (served at /uploads). Calls are serialized.
// Anonymous free tier = 1 image every 45 s per IP, so the registry throttle spaces calls ~47 s.
import fs from 'node:fs';
import path from 'node:path';
import { UPLOAD_DIR, uid } from '../db';
import { fetchBuffer, nextSlotIn, qs, UpstreamError, type CallContext } from './http';
import { PROVIDER, providerKey } from './registry';

export interface GeneratedImage {
  url: string; // '/uploads/img-….jpg'
  file: string; // absolute path on the server
  prompt: string;
  sourceUrl: string; // the Pollinations URL that produced it (re-opening it may render again)
  width: number;
  height: number;
  seed: number;
  bytes: number;
  fetchedAt: string;
}

export interface ImageOpts {
  width?: number; // 256..1280, default 1024
  height?: number; // 256..1280, default 768
  seed?: number;
  /** Fail fast (ImageBusyError) instead of queueing longer than this. Default: wait. */
  maxWaitMs?: number;
}

/** Thrown when the image queue is longer than `maxWaitMs`. */
export class ImageBusyError extends Error {
  constructor(public retryAfterSec: number) {
    super(`The image studio is busy (free tier: one image every ~45 seconds). Try again in about ${retryAfterSec} s.`);
    this.name = 'ImageBusyError';
  }
}

export const IMAGE_PROMPT_MAX = 400;

function imageType(b: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length > 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

let chain: Promise<unknown> = Promise.resolve();
let pending = 0;

/** Estimated ms before a new image request would start (queue + free-tier spacing). */
export function imageQueueWaitMs(): number {
  const interval = PROVIDER.pollinations.throttle?.minIntervalMs ?? 0;
  return nextSlotIn('pollinations') + pending * interval;
}

/** Generate one image. Takes ~5-30 s plus any queue wait. */
export function generateImage(prompt: string, ctx: CallContext, opts: ImageOpts = {}): Promise<GeneratedImage> {
  if (opts.maxWaitMs !== undefined) {
    const wait = imageQueueWaitMs();
    if (wait > opts.maxWaitMs) return Promise.reject(new ImageBusyError(Math.ceil(wait / 1000)));
  }
  pending++;
  const run = chain.then(() => {
    pending--;
    return doGenerate(prompt, ctx, opts);
  });
  chain = run.catch(() => undefined);
  return run;
}

async function doGenerate(prompt: string, ctx: CallContext, opts: ImageOpts): Promise<GeneratedImage> {
  const p = prompt.trim().replace(/\s+/g, ' ').slice(0, IMAGE_PROMPT_MAX);
  if (!p) throw new Error('Prompt is empty.');
  const clamp = (n: number | undefined, d: number) => Math.min(1280, Math.max(256, Math.round(n ?? d)));
  const width = clamp(opts.width, 1024);
  const height = clamp(opts.height, 768);
  const seed = opts.seed ?? Math.floor(Math.random() * 1_000_000);
  const sourceUrl = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(p) + qs({ width, height, nologo: 'true', seed });
  const token = providerKey('pollinations');
  let r;
  try {
    r = await fetchBuffer(sourceUrl, {
      provider: 'pollinations',
      ctx,
      timeoutMs: 75_000,
      retries: 1,
      accept: 'image/*',
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    });
  } catch (e) {
    if (e instanceof UpstreamError && (e.status === 402 || e.status === 429))
      throw new UpstreamError('pollinations', e.status, 'Pollinations free limit reached (one image every 45 seconds per server). Try again in a minute.');
    throw e;
  }
  const { buf, contentType } = r.data;
  const type = imageType(buf);
  if (!type || !/^image\//i.test(contentType) || buf.length < 2000) throw new UpstreamError('pollinations', r.status, 'Pollinations did not return a valid image.');
  const name = `img-${uid('img').slice(4)}.${type}`;
  const file = path.join(UPLOAD_DIR, name);
  fs.writeFileSync(file, buf);
  return { url: `/uploads/${name}`, file, prompt: p, sourceUrl, width, height, seed, bytes: buf.length, fetchedAt: r.fetchedAt };
}
