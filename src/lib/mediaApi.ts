// Client for the media workshop tools (/api/media/*) and the admin Herald queue (/api/admin/*).
// Every call goes to our own server, which holds the keys. Type-only imports are erased at build.
import type * as I from '../../server/integrations';
import type { HeraldPost, HeraldStatus } from '../../server/herald';
import type { NotifyResult } from '../../server/notify';
import { getUid } from './api';

export type { HeraldPost, HeraldStatus, NotifyResult };

async function req<T>(path: string, init: RequestInit = {}, admin?: string): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  const uid = getUid();
  if (uid) headers['x-user'] = uid;
  if (admin) headers['x-admin-key'] = admin;
  if (typeof init.body === 'string') headers['content-type'] = 'application/json';
  const res = await fetch('/api' + path, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (HTTP ${res.status})`);
  return data as T;
}
const post = <T>(path: string, body: unknown, admin?: string) => req<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }, admin);
const enc = encodeURIComponent;

type Named = { provider: string; name: string };
export interface ToolQuota {
  used: number;
  limit: number;
  left: number;
}
export interface MediaStatus {
  providers: Record<'cloudflare' | 'pixabay' | 'freesound' | 'removebg' | 'huggingface' | 'github', boolean>;
  cloudflare: I.CfUsage;
  removebg: I.RemoveBgQuota;
  tools: Record<string, ToolQuota>;
  publishEnabled: boolean;
  at: string;
}
type NoFile<T> = Omit<T, 'file'>;

/** Read a browser File as a base64 data URL. */
export function fileToDataUrl(f: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsDataURL(f);
  });
}
export const UPLOAD_MAX_BYTES = 2 * 1024 * 1024;

export const media = {
  status: () => req<MediaStatus>('/media/status'),
  upload: async (file: Blob, kind: 'image' | 'audio') => {
    if (file.size > UPLOAD_MAX_BYTES) throw new Error('The file must be 2 MB or smaller.');
    return post<{ url: string; type: string; bytes: number }>('/media/upload', { kind, data: await fileToDataUrl(file) });
  },
  // Atelier
  image: (prompt: string) => post<NoFile<I.CfImage> & Named & { quota: ToolQuota; usage: I.CfUsage }>('/media/image', { prompt }),
  alt: (image: string, detail?: 'short' | 'long') => post<I.CfAltText & Named & { image: string; quota: ToolQuota }>('/media/alt', { image, detail }),
  cutout: (image: string) => post<NoFile<I.Cutout> & Named>('/media/cutout', { image }),
  pixabayImages: (q: string) => req<I.PixabaySearch<I.PixabayImage> & Named>(`/media/pixabay/images?q=${enc(q)}`),
  pixabayVideos: (q: string) => req<I.PixabaySearch<I.PixabayVideo> & Named>(`/media/pixabay/videos?q=${enc(q)}`),
  pixabayDownload: (id: number, kind: 'image' | 'video') => post<NoFile<I.PixabayDownload> & Named>('/media/pixabay/download', { id, kind }),
  // Theatre
  speak: (text: string, lang: string) => post<NoFile<I.CfSpeech> & Named & { quota: ToolQuota }>('/media/speak', { text, lang }),
  transcribe: (audio: string, language?: string) => post<I.CfTranscript & Named & { audio: string; quota: ToolQuota }>('/media/transcribe', { audio, language }),
  sounds: (q: string, kind: I.SoundKind) => req<I.SoundSearch & Named>(`/media/sounds?q=${enc(q)}&kind=${kind}`),
  soundDownload: (id: number) => post<NoFile<I.SoundDownload> & Named>('/media/sounds/download', { id }),
  film: (b: { clips?: string[]; images?: string[]; captions?: string[]; narration?: string | null; music?: string | null; musicVolume?: number }) =>
    post<NoFile<I.Film> & { quota: ToolQuota }>('/media/film', b),
  // Scriptorium
  translate: (text: string, target: string, source = 'en') => post<I.CfTranslation & Named & { quota: ToolQuota }>('/media/translate', { text, target, source }),
  // Forge
  site: (slug: string) => req<{ slug: string; url: string; status: 'live' | 'building'; at: string }>(`/media/sites/${enc(slug)}`),
};

export const herald = {
  list: (key: string, status?: HeraldStatus) => req<{ posts: HeraldPost[]; bluesky: boolean; at: string }>(`/admin/herald${status ? `?status=${status}` : ''}`, {}, key),
  queue: (key: string, d: { text: string; image?: string; alt?: string; decreeId?: string }) => post<HeraldPost>('/admin/herald', d, key),
  approve: (key: string, id: string) => post<HeraldPost>(`/admin/herald/${enc(id)}/approve`, {}, key),
  reject: (key: string, id: string, reason?: string) => post<HeraldPost>(`/admin/herald/${enc(id)}/reject`, { reason }, key),
  checks: (key: string) => req<Record<string, unknown>>('/admin/checks', {}, key),
};
