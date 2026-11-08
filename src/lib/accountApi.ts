// Recovery key (move your guest to another device) and the light "still working" feed.
import type { User } from '../../shared/types';
import { getUid, setUid } from './api';

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  const uid = getUid();
  if (uid) headers['x-user'] = uid;
  if (typeof init.body === 'string') headers['content-type'] = 'application/json';
  const res = await fetch('/api' + path, { ...init, headers, cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

export interface WorkFeed {
  decrees: { id: string; title: string; status: string }[];
  builds: { id: string; slug: string; title: string; status: string; failed: boolean; version: number }[];
}

export const accountApi = {
  keyInfo: () => req<{ hasKey: boolean; createdAt: string | null }>('/me/recovery'),
  newKey: () => req<{ key: string; createdAt: string }>('/me/recovery', { method: 'POST', body: '{}' }),
  /** Switches this browser to the user the key belongs to. */
  async restore(key: string): Promise<User> {
    const u = await req<User>('/me/restore', { method: 'POST', body: JSON.stringify({ key }) });
    setUid(u.id);
    return u;
  },
  work: (d: string[], b: string[]) => req<WorkFeed>(`/me/work?d=${encodeURIComponent(d.join(','))}&b=${encodeURIComponent(b.join(','))}`),
};
