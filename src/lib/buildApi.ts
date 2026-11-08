// Client for the App Builder (/api/builds*, /api/builder/status, /api/admin/builder).
import type { BuildView, BuilderStatus, GalleryPage } from '../../server/builder';
import { getUid } from './api';

export type { BuildView, BuilderStatus, GalleryPage };
export type BuildFormat = 'auto' | 'web' | 'md' | 'txt' | 'csv' | 'json' | 'svg';

async function req<T>(path: string, init: RequestInit = {}, admin?: string): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  const uid = getUid();
  if (uid) headers['x-user'] = uid;
  if (admin) headers['x-admin-key'] = admin;
  if (typeof init.body === 'string') headers['content-type'] = 'application/json';
  const res = await fetch(path, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}
const post = <T>(path: string, body: unknown, admin?: string) => req<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }, admin);

export interface AdminBuilder {
  today: { runs: number; cost: number; ok: number };
  total: { runs: number; cost: number; ok: number };
  days: { day: string; runs: number; cost: number }[];
  limitsActive: boolean;
  limitsFrom: string;
  dailyUsd: number;
  model: string;
  inflight: number;
  images: { today: { images: number; cost: number; cap: number }; total: { images: number; cost: number } };
  credits: { total: number; used: number; left: number } | null;
  builderImages: { n: number; cost: number };
  recent: { id: string; slug: string; title: string; filename: string; status: string; reports: number; views: number; is_public: number; remixed_from: string | null; created_at: string }[];
}

export const buildApi = {
  status: () => req<BuilderStatus>('/api/builder/status'),
  create: (prompt: string, format: BuildFormat) => post<{ id: string; slug: string }>('/api/builds', { prompt, format }),
  revise: (id: string, prompt: string) => post<{ id: string; slug: string }>(`/api/builds/${encodeURIComponent(id)}/revise`, { prompt }),
  restore: (id: string, version: number) => post<BuildView>(`/api/builds/${encodeURIComponent(id)}/restore`, { version }),
  get: (id: string) => req<BuildView>(`/api/builds/${encodeURIComponent(id)}`),
  gallery: (offset = 0, limit = 12) => req<GalleryPage>(`/api/builds/gallery?offset=${offset}&limit=${limit}`),
  remix: (from: string, prompt: string) => post<{ id: string; slug: string }>('/api/builds/remix', { from, prompt }),
  setPublic: (id: string, on: boolean) => post<BuildView>(`/api/builds/${encodeURIComponent(id)}/public`, { public: on }),
  rename: (id: string, slug: string) => post<BuildView>(`/api/builds/${encodeURIComponent(id)}/slug`, { slug }),
  mine: () => req<BuildView[]>('/api/builds/mine'),
  report: (slug: string, reason: string) => post<{ ok: true }>(`/api/builds/${encodeURIComponent(slug)}/report`, { reason }),
  admin: (key: string) => req<AdminBuilder>('/api/admin/builder', {}, key),
  remove: (key: string, slug: string) => post<{ ok: true }>(`/api/admin/builds/${encodeURIComponent(slug)}/remove`, {}, key),
  unlist: (key: string, slug: string) => post<{ ok: true }>(`/api/admin/builds/${encodeURIComponent(slug)}/unlist`, {}, key),
  unremove: (key: string, slug: string) => post<{ ok: true }>(`/api/admin/builds/${encodeURIComponent(slug)}/restore`, {}, key),
};

export const pageUrl = (slug: string) => `${location.origin}/p/${slug}`;
