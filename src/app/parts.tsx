import { Link } from 'react-router-dom';
import { Clock, Star } from 'lucide-react';
import type { Agent, AgentLite, Commission, Decree, DecreeStatus } from '../../shared/types';
import { PROVINCE, type ProvinceId } from '../../shared/realm';
import { Figure, Portrait } from '../components/Character';
import { ProvinceIcon } from '../components/ProvinceIcon';
import { ago, fmt } from '../lib/api';
import { BRAND } from '../config';

export function Stars({ value, size = 13, count }: { value: number | null; size?: number; count?: number }) {
  if (value == null) return <span className="tag">New</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 700 }}>
      <Star size={size} fill="var(--gold)" color="var(--gold)" />
      {value.toFixed(1)}
      {count != null && <span className="muted" style={{ fontWeight: 500 }}>({count})</span>}
    </span>
  );
}

export function AgentPortrait({ a, size = 48 }: { a: Pick<AgentLite, 'role' | 'look' | 'color'>; size?: number }) {
  return <Portrait role={a.role} look={a.look} color={a.color} size={size} />;
}

export function CommissionSlip({ c, onOrder }: { c: Commission; onOrder?: (c: Commission) => void }) {
  const p = PROVINCE[c.province];
  return (
    <article className="slip" style={{ ['--accent' as string]: p.color }}>
      <div className="slip-art">
        <span className="slip-guild">
          <ProvinceIcon id={c.province} size={20} />
          {p.craft}
        </span>
        {c.agent && (
          <span className="slip-fig">
            <Figure role={c.agent.role} look={c.agent.look} color={c.agent.color} size={128} idle={false} />
          </span>
        )}
      </div>
      <div className="slip-body">
        <h3 className="clamp2">{c.title}</h3>
        <p className="clamp2">{c.description}</p>
        <div className="slip-foot">
          {c.agent && (
            <Link to={`/agents/${c.agent.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <AgentPortrait a={c.agent} size={30} />
              <span style={{ minWidth: 0 }}>
                <b className="ellipsis" style={{ display: 'block', fontSize: 13 }}>
                  {c.agent.name}
                </b>
                <span className="muted" style={{ fontSize: 11 }}>
                  {c.agent.rank}
                </span>
              </span>
            </Link>
          )}
          <span className="price-seal">
            <b>
              {fmt(c.price)} {BRAND.currencyShort}
            </b>
            <small>
              <Clock size={10} style={{ display: 'inline', verticalAlign: -1 }} /> ~{c.etaMinutes} min
            </small>
          </span>
        </div>
        {onOrder && (
          <button className="btn btn-seal btn-sm btn-block" style={{ marginTop: 12 }} onClick={() => onOrder(c)}>
            Commission {c.agent?.name ?? 'this agent'}
          </button>
        )}
      </div>
    </article>
  );
}

export function AgentCard({ a, onDecree }: { a: Agent; onDecree?: (a: Agent) => void }) {
  const p = PROVINCE[a.province];
  return (
    <article className="agent-card">
      <Link to={`/agents/${a.id}`} aria-label={a.name}>
        <AgentPortrait a={a} size={64} />
      </Link>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Link to={`/agents/${a.id}`}>
          <h3>
            {a.working && <span className="dot live" title="At work" />}
            {a.name}
            <span className="rank-seal">{a.rank}</span>
          </h3>
        </Link>
        <div className="muted ellipsis" style={{ fontSize: 12.5, margin: '3px 0 8px' }}>
          <span style={{ color: p.color, fontWeight: 700 }}>{p.name}</span> · {a.title}
        </div>
        <div className="stats">
          <Stars value={a.rating} count={a.reviews || undefined} />
          <span>{a.approved} approved</span>
          <span>{a.onTime == null ? 'On-time: no data yet' : `${a.onTime}% on time`}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          <span className="tag">{a.model}</span>
          {a.ownerId && <span className="tag jade">Citizen-owned</span>}
          {a.working && <span className="tag jade">At work</span>}
          {onDecree && (
            <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => onDecree(a)}>
              Issue decree
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

const STATUS: Record<DecreeStatus, { label: string; bg: string; fg: string }> = {
  queued: { label: 'In queue', bg: '#fbefd9', fg: '#a5650b' },
  working: { label: 'Being crafted', bg: '#dff5ec', fg: '#1f7d60' },
  delivered: { label: 'Awaiting approval', bg: 'var(--purple-soft)', fg: 'var(--purple-2)' },
  approved: { label: 'Approved', bg: '#e3f4e9', fg: '#2f9e6b' },
  failed: { label: 'Failed · refunded', bg: '#fbe3e3', fg: '#c03a3a' },
  cancelled: { label: 'Cancelled', bg: '#eeeaf2', fg: '#6f6a80' },
};

export function StatusSeal({ s }: { s: DecreeStatus }) {
  const x = STATUS[s];
  return (
    <span className="status" style={{ background: x.bg, color: x.fg }}>
      {s === 'working' ? <span className="dot live" /> : <span className="dot" />}
      {x.label}
    </span>
  );
}

export function DecreeRow({ d, to }: { d: Decree; to?: string }) {
  const p = PROVINCE[d.province];
  const body = (
    <>
      {d.agent && <AgentPortrait a={d.agent} size={42} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="ellipsis" style={{ fontWeight: 700 }}>
          {d.title}
        </div>
        <div className="muted ellipsis" style={{ fontSize: 12.5 }}>
          {d.agent?.name} · {p.name} · {fmt(d.price)} {BRAND.currencyShort} · {ago(d.createdAt)}
        </div>
      </div>
      <StatusSeal s={d.status} />
    </>
  );
  return to ? (
    <Link to={to} className="decree-row">
      {body}
    </Link>
  ) : (
    <div className="decree-row">{body}</div>
  );
}

export function ProvinceName({ id }: { id: ProvinceId }) {
  const p = PROVINCE[id];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 700, color: p.color }}>
      <ProvinceIcon id={id} size={24} />
      {p.name}
    </span>
  );
}
