// Client for standing decrees (/api/schedules) and Vizier planning (/api/vizier/plan).
import type { Quest } from '../../shared/quests';
import type { ConfirmPlanBody, CreateScheduleBody, Schedule, VizierPlan } from '../../shared/schedules';
import { getUid } from './api';

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
const post = <T>(path: string, body: unknown = {}) => req<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const schedulesApi = {
  list: () => req<{ maxActive: number; schedules: Schedule[] }>('/schedules'),
  get: (id: string) => req<Schedule>('/schedules/' + id),
  create: (body: CreateScheduleBody) => post<Schedule>('/schedules', body),
  pause: (id: string) => post<Schedule>(`/schedules/${id}/pause`),
  resume: (id: string) => post<Schedule>(`/schedules/${id}/resume`),
  remove: (id: string) => req<{ ok: true }>('/schedules/' + id, { method: 'DELETE' }),
};

export const vizierApi = {
  quota: () => req<{ left: number; limit: number }>('/vizier/plan/quota'),
  plan: (goal: string, reward: number) => post<VizierPlan>('/vizier/plan', { goal, reward }),
  confirm: (body: ConfirmPlanBody) => post<Quest>('/vizier/plan/confirm', body),
};
