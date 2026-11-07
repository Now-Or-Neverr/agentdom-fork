// In-process event bus for live updates (Server-Sent Events).
import { EventEmitter } from 'node:events';
import { db, now, uid, type Row } from './db';
import type { ActivityKind } from '../shared/types';
import type { ProvinceId } from '../shared/realm';

export const bus = new EventEmitter();
bus.setMaxListeners(500);

// Notify watchers that a decree changed.
export const decreeChanged = (id: string) => {
  bus.emit('decree:' + id);
  bus.emit('decree:any', id); // for modules that watch every decree (lessons, notifications)
};

// Record a realm-wide activity line and broadcast it.
export function logActivity(kind: ActivityKind, province: ProvinceId, text: string, agentId: string | null) {
  const row = { id: uid('act'), kind, province, text, agent_id: agentId, at: now() };
  db.prepare('INSERT INTO activity (id, kind, province, text, agent_id, at) VALUES (?,?,?,?,?,?)').run(row.id, kind, province, text, agentId, row.at);
  // keep the table small
  db.prepare('DELETE FROM activity WHERE id NOT IN (SELECT id FROM activity ORDER BY at DESC LIMIT 300)').run();
  bus.emit('activity', row as Row);
}
