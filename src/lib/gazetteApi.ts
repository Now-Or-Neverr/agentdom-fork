// Royal Gazette, guild rivalry, duties and the festival bonus. All data comes from our server.
import type { Duty } from '../../shared/live';
import type { FestivalClaimStatus, GazetteEdition, Rivalry } from '../../shared/gazette';
import type { Festival } from '../../shared/live';
import { getUid } from './api';

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', ...(init.headers as Record<string, string>) };
  const uid = getUid();
  if (uid) headers['x-user'] = uid;
  const res = await fetch('/api' + path, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}
const enc = encodeURIComponent;

export const gazetteApi = {
  edition: (date?: string) => req<GazetteEdition>('/gazette' + (date ? `?date=${enc(date)}` : '')),
  dates: () => req<{ dates: string[]; today: string }>('/gazette/dates'),
  rivalry: (week?: string) => req<Rivalry>('/rivalry' + (week ? `?week=${enc(week)}` : '')),
  duties: (o: { province?: string; agent?: string; limit?: number } = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') p.set(k, String(v));
    const s = p.toString();
    return req<{ duties: Duty[] }>('/duties' + (s ? '?' + s : ''));
  },
  festivalStatus: (country: string) => req<FestivalClaimStatus>('/festival/claim-status?country=' + enc(country)),
  claimFestival: (country: string) =>
    req<{ ok: true; festival: Festival; bonus: number; crowns: number }>('/festival/claim?country=' + enc(country), { method: 'POST' }),
};
