// Pixabay photos + video clips. Pixabay asks API users to cache results for 24 h and not to
// hotlink used media, so search results are cached and anything we USE is downloaded into
// data/uploads first. Every item carries author + page URL for attribution.
import { fetchBuffer, fetchJson, qs, UpstreamError, type CallContext } from './http';
import { providerKey } from './registry';
import { IMAGE_EXT, saveUpload, VIDEO_EXT } from './media-common';

const DAY = 24 * 3600_000;

export interface PixabayCredit {
  author: string;
  authorUrl: string;
  pageUrl: string;
  license: 'Pixabay Content License';
  licenseUrl: string;
}
export interface PixabayImage extends PixabayCredit {
  id: number;
  tags: string[];
  previewUrl: string; // small thumbnail for search results only
  width: number;
  height: number;
}
export interface PixabayVideo extends PixabayCredit {
  id: number;
  tags: string[];
  durationSec: number;
  thumbnail: string | null;
  sizes: { quality: 'large' | 'medium' | 'small' | 'tiny'; width: number; height: number; bytes: number }[];
}
export interface PixabaySearch<T> {
  query: string;
  total: number;
  results: T[];
  sourceUrl: string;
  fetchedAt: string;
}
export interface PixabayDownload extends PixabayCredit {
  id: number;
  kind: 'image' | 'video';
  url: string; // '/uploads/…'
  file: string;
  bytes: number;
  type: string;
  width: number;
  height: number;
  durationSec: number | null;
  fetchedAt: string;
}

const LICENSE_URL = 'https://pixabay.com/service/license-summary/';
function key() {
  const k = providerKey('pixabay');
  if (!k) throw new UpstreamError('pixabay', 0, 'Pixabay is not configured on this server.');
  return k;
}
const credit = (h: { user?: string; user_id?: number; pageURL?: string }): PixabayCredit => ({
  author: h.user ?? 'Pixabay user',
  authorUrl: h.user && h.user_id ? `https://pixabay.com/users/${encodeURIComponent(h.user)}-${h.user_id}/` : 'https://pixabay.com',
  pageUrl: h.pageURL ?? 'https://pixabay.com',
  license: 'Pixabay Content License',
  licenseUrl: LICENSE_URL,
});
const tags = (s?: string) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 8);

interface RawImage {
  id: number;
  pageURL: string;
  tags: string;
  previewURL: string;
  webformatURL: string;
  largeImageURL: string;
  imageWidth: number;
  imageHeight: number;
  user: string;
  user_id: number;
}
interface RawVideo {
  id: number;
  pageURL: string;
  tags: string;
  duration: number;
  user: string;
  user_id: number;
  videos: Record<'large' | 'medium' | 'small' | 'tiny', { url: string; width: number; height: number; size: number; thumbnail?: string }>;
}

function cleanQuery(q: string) {
  const s = q.trim().replace(/\s+/g, ' ').slice(0, 100);
  if (!s) throw new Error('Search words are empty.');
  return s;
}

/** Search photos (safe search on). */
export async function pixabayImages(q: string, ctx: CallContext, opts: { perPage?: number; orientation?: 'horizontal' | 'vertical' } = {}): Promise<PixabaySearch<PixabayImage>> {
  const query = cleanQuery(q);
  const per = Math.min(30, Math.max(3, Math.round(opts.perPage ?? 12)));
  const r = await fetchJson<{ total: number; totalHits: number; hits: RawImage[] }>(
    'https://pixabay.com/api/' + qs({ key: key(), q: query, image_type: 'photo', safesearch: 'true', per_page: per, orientation: opts.orientation }),
    { provider: 'pixabay', ctx, ttlMs: DAY },
  );
  return {
    query,
    total: r.data.totalHits ?? 0,
    results: (r.data.hits ?? []).map((h) => ({ id: h.id, tags: tags(h.tags), previewUrl: h.previewURL, width: h.imageWidth, height: h.imageHeight, ...credit(h) })),
    sourceUrl: `https://pixabay.com/images/search/${encodeURIComponent(query)}/`,
    fetchedAt: r.fetchedAt,
  };
}

/** Search video clips (safe search on). */
export async function pixabayVideos(q: string, ctx: CallContext, opts: { perPage?: number } = {}): Promise<PixabaySearch<PixabayVideo>> {
  const query = cleanQuery(q);
  const per = Math.min(30, Math.max(3, Math.round(opts.perPage ?? 9)));
  const r = await fetchJson<{ totalHits: number; hits: RawVideo[] }>('https://pixabay.com/api/videos/' + qs({ key: key(), q: query, safesearch: 'true', per_page: per }), {
    provider: 'pixabay',
    ctx,
    ttlMs: DAY,
  });
  return {
    query,
    total: r.data.totalHits ?? 0,
    results: (r.data.hits ?? []).map((h) => ({
      id: h.id,
      tags: tags(h.tags),
      durationSec: h.duration,
      thumbnail: h.videos?.tiny?.thumbnail ?? h.videos?.small?.thumbnail ?? null,
      sizes: (['large', 'medium', 'small', 'tiny'] as const)
        .filter((k) => h.videos?.[k]?.url)
        .map((k) => ({ quality: k, width: h.videos[k].width, height: h.videos[k].height, bytes: h.videos[k].size })),
      ...credit(h),
    })),
    sourceUrl: `https://pixabay.com/videos/search/${encodeURIComponent(query)}/`,
    fetchedAt: r.fetchedAt,
  };
}

/** Download one photo by id into uploads (re-fetches the item: Pixabay media URLs expire). */
export async function pixabayDownloadImage(id: number, ctx: CallContext, opts: { large?: boolean } = {}): Promise<PixabayDownload> {
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid Pixabay image id.');
  const r = await fetchJson<{ hits: RawImage[] }>('https://pixabay.com/api/' + qs({ key: key(), id }), { provider: 'pixabay', ctx, ttlMs: 0 });
  const h = r.data.hits?.[0];
  if (!h) throw new UpstreamError('pixabay', 404, 'Pixabay has no image with that id.');
  const src = opts.large ? h.largeImageURL : h.webformatURL;
  const b = await fetchBuffer(src, { provider: 'pixabay', ctx, timeoutMs: 45_000, accept: 'image/*' });
  const saved = saveUpload(b.data.buf, 'pxi', IMAGE_EXT, 'Pixabay image');
  const scale = opts.large ? Math.min(1, 1280 / Math.max(h.imageWidth, h.imageHeight)) : Math.min(1, 640 / Math.max(h.imageWidth, h.imageHeight));
  return {
    id,
    kind: 'image',
    url: saved.url,
    file: saved.file,
    bytes: saved.bytes,
    type: saved.ext,
    width: Math.round(h.imageWidth * scale),
    height: Math.round(h.imageHeight * scale),
    durationSec: null,
    fetchedAt: b.fetchedAt,
    ...credit(h),
  };
}

export const PIXABAY_VIDEO_MAX_BYTES = 30 * 1024 * 1024;
/** Download one clip by id into uploads. Picks the best size up to `maxHeight` (default 720) and 30 MB. */
export async function pixabayDownloadVideo(id: number, ctx: CallContext, opts: { maxHeight?: number } = {}): Promise<PixabayDownload> {
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid Pixabay video id.');
  const r = await fetchJson<{ hits: RawVideo[] }>('https://pixabay.com/api/videos/' + qs({ key: key(), id }), { provider: 'pixabay', ctx, ttlMs: 0 });
  const h = r.data.hits?.[0];
  if (!h) throw new UpstreamError('pixabay', 404, 'Pixabay has no video with that id.');
  const maxH = opts.maxHeight ?? 720;
  const pick = (['large', 'medium', 'small', 'tiny'] as const)
    .map((k) => h.videos?.[k])
    .find((v) => v?.url && v.height <= maxH && v.size <= PIXABAY_VIDEO_MAX_BYTES);
  if (!pick) throw new Error('That clip has no size small enough to download.');
  const b = await fetchBuffer(pick.url, { provider: 'pixabay', ctx, timeoutMs: 120_000, accept: 'video/*' });
  if (b.data.buf.length > PIXABAY_VIDEO_MAX_BYTES) throw new Error('The clip is too large.');
  const saved = saveUpload(b.data.buf, 'pxv', VIDEO_EXT, 'Pixabay clip');
  return { id, kind: 'video', url: saved.url, file: saved.file, bytes: saved.bytes, type: saved.ext, width: pick.width, height: pick.height, durationSec: h.duration, fetchedAt: b.fetchedAt, ...credit(h) };
}
