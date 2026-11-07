import type { CreateQuestBody, Quest, QuestTemplate } from '../../shared/quests';
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

export const questsApi = {
  templates: () => req<QuestTemplate[]>('/quests/templates'),
  mine: () => req<Quest[]>('/quests/mine'),
  get: (id: string) => req<Quest>('/quests/' + id),
  create: (body: CreateQuestBody) => req<Quest>('/quests', { method: 'POST', body: JSON.stringify(body) }),
  rate: (id: string, rating: number, review: string) => req<Quest>(`/quests/${id}/rate`, { method: 'POST', body: JSON.stringify({ rating, review }) }),
};

// Live updates for one quest (every step change and the running step's streamed result).
export function watchQuest(id: string, onData: (q: Quest) => void): () => void {
  const es = new EventSource(`/api/quests/${id}/stream?u=${encodeURIComponent(getUid() ?? '')}`);
  es.onmessage = (e) => {
    try {
      onData(JSON.parse(e.data));
    } catch {
      /* ignore */
    }
  };
  return () => es.close();
}
