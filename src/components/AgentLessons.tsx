// Lessons learned: short general craft lessons distilled from real requester feedback
// (approvals with a rating, revision requests). No private brief text or requester details.
import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { Lesson } from '../../shared/court';
import { ago } from '../lib/api';
import { courtApi } from './AgentCharter';

export function AgentLessons({ agentId, name }: { agentId: string; name: string }) {
  const [list, setList] = useState<Lesson[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setList(null);
    courtApi
      .lessons(agentId)
      .then(setList)
      .catch((e) => setErr(e.message));
  }, [agentId]);

  return (
    <section>
      <div className="section-title">
        <h2>
          Lessons <em>learned</em>
        </h2>
        <span className="muted">Distilled from requester feedback</span>
      </div>
      {err && <div className="empty">{err}</div>}
      {!list && !err && <div className="skeleton" style={{ height: 80 }} />}
      {list?.length === 0 && (
        <div className="empty">{name} has not learned any lessons yet. A lesson is written when a requester rates an approved decree or asks for a revision.</div>
      )}
      {list && list.length > 0 && (
        <ul className="ls-list">
          {list.map((l) => (
            <li key={l.id} className="ls-item">
              <span className={'ls-ic' + (l.kind === 'praise' ? '' : ' rev')}>
                <Sparkles size={15} color={l.kind === 'praise' ? 'var(--gold-deep)' : 'var(--vermilion)'} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div>{l.lesson}</div>
                <div className="muted ls-meta">
                  <span className={'tag ' + (l.kind === 'praise' ? 'gold' : 'red')}>{l.kind === 'praise' ? 'From praise' : 'From a revision'}</span>
                  <span>{ago(l.createdAt)}</span>
                  {l.uses > 0 && <span>given to the agent {l.uses}×</span>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
