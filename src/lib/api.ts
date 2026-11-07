import type { Activity, Agent, Banner, Commission, Decree, LedgerEntry, ProvinceInfo, RealmStatus, RoutePreview, User } from '../../shared/types';
import type { ProvinceId } from '../../shared/realm';

// Lightweight identity: a guest id kept in localStorage and sent as a header.
const KEY = 'agentdom.uid';

export function getUid(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
function setUid(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* ignore */
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  const uid = getUid();
  if (uid) headers['x-user'] = uid;
  if (typeof init.body === 'string') headers['content-type'] = 'application/json';
  const res = await fetch('/api' + path, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

const qs = (o: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '' && v !== null && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? '?' + s : '';
};

export type AgentQuery = { province?: ProvinceId | 'all'; sort?: 'rating' | 'approved' | 'new'; minRating?: number; active?: boolean; q?: string; mine?: boolean };

export const api = {
  async me(): Promise<User> {
    const u = await req<User>('/me', { method: 'POST', body: '{}' });
    setUid(u.id);
    return u;
  },
  rename: (name: string) => req<User>('/me/name', { method: 'POST', body: JSON.stringify({ name }) }),
  ledger: () => req<LedgerEntry[]>('/me/ledger'),
  status: () => req<RealmStatus>('/status'),
  activity: () => req<Activity[]>('/activity'),
  routePreview: (text: string) => req<RoutePreview>('/route-preview' + qs({ text })),

  agents: (q: AgentQuery = {}) => req<Agent[]>('/agents' + qs({ ...q, province: q.province === 'all' ? undefined : q.province })),
  agent: (id: string) => req<{ agent: Agent; commissions: Commission[]; decrees: Decree[]; works: Decree[] }>('/agents/' + id),
  leaderboard: () => req<Agent[]>('/leaderboard'),
  enlist: (body: { name: string; province: ProvinceId; title: string; bio: string; instructions: string; price: number; commissionTitle: string; look: number }) =>
    req<Agent>('/agents', { method: 'POST', body: JSON.stringify(body) }),

  commissions: (q: { province?: ProvinceId | 'all'; q?: string } = {}) =>
    req<Commission[]>('/commissions' + qs({ ...q, province: q.province === 'all' ? undefined : q.province })),

  recentDecrees: (province?: ProvinceId) => req<Decree[]>('/decrees/recent' + qs({ province })),
  myDecrees: () => req<Decree[]>('/decrees/mine'),
  decree: (id: string) => req<Decree>('/decrees/' + id),
  issue: (body: { title: string; brief: string; price: number; agentId?: string; commissionId?: string; province?: ProvinceId; isPublic?: boolean }) =>
    req<Decree>('/decrees', { method: 'POST', body: JSON.stringify(body) }),
  approve: (id: string, rating: number, review: string) => req<Decree>(`/decrees/${id}/approve`, { method: 'POST', body: JSON.stringify({ rating, review }) }),
  revise: (id: string, note: string) => req<Decree>(`/decrees/${id}/revise`, { method: 'POST', body: JSON.stringify({ note }) }),
  cancel: (id: string) => req<Decree>(`/decrees/${id}/cancel`, { method: 'POST', body: '{}' }),

  banners: () => req<Banner[]>('/banners'),
  rentBanner: (id: string, body: { title: string; image: string; days: number }) => req<Banner>(`/banners/${id}/rent`, { method: 'POST', body: JSON.stringify(body) }),

  provinces: () => req<Record<ProvinceId, ProvinceInfo>>('/provinces'),
};

// Server-sent events for a single decree (live result streaming).
export function watchDecree(id: string, onData: (d: Decree) => void): () => void {
  const uid = getUid();
  const es = new EventSource(`/api/decrees/${id}/stream?u=${encodeURIComponent(uid ?? '')}`);
  es.onmessage = (e) => {
    try {
      onData(JSON.parse(e.data));
    } catch {
      /* ignore */
    }
  };
  return () => es.close();
}

// Server-sent events for realm-wide activity.
export function watchActivity(onItem: (a: Activity) => void): () => void {
  const es = new EventSource('/api/activity/stream');
  es.onmessage = (e) => {
    try {
      onItem(JSON.parse(e.data));
    } catch {
      /* ignore */
    }
  };
  return () => es.close();
}

export const fmt = (n: number) => new Intl.NumberFormat('en-US').format(n);

export function ago(iso: string | null) {
  if (!iso) return '';
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 45) return 'just now';
  if (d < 3600) return `${Math.max(1, Math.floor(d / 60))}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}
