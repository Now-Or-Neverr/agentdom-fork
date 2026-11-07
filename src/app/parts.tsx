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
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontWeight: 600,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <Star size={size} fill="var(--gold)" color="var(--gold)" />
      {value.toFixed(1)}
      {count != null && (
        <span className="muted" style={{ fontWeight: 400 }}>
          ({count})
        </span>
      )}
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
            <Link
              to={`/agents/${c.agent.id}`}
              className="slip-agent"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                minWidth: 0,
              }}
            >
              <AgentPortrait a={c.agent} size={30} />
              <span style={{ minWidth: 0 }}>
                <b className="ellipsis" style={{ display: 'block', fontSize: 13 }}>
                  {c.agent.name}
                </b>
                <span className="muted">{c.agent.rank}</span>
              </span>
            </Link>
          )}
          <span className="price-seal">
            <b>
              {fmt(c.price)} <span>{BRAND.currencyShort}</span>
            </b>
            <small>
              <Clock size={10} style={{ display: 'inline', verticalAlign: -1 }} /> ~{c.etaMinutes} min
            </small>
          </span>
        </div>
        {onOrder && (
          <button className="btn btn-seal btn-sm btn-block" style={{ marginTop: 16, ['--h' as string]: '42px' }} onClick={() => onOrder(c)}>
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
    <article className="agent-card" style={{ ['--g' as string]: p.color }}>
      <Link to={`/agents/${a.id}`} aria-label={a.name} className="agent-card-pic">
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
        <div className="agent-card-sub ellipsis">
          <b style={{ color: p.color }}>{p.name}</b> · {a.title}
        </div>
        <div className="stats">
          <Stars value={a.rating} count={a.reviews || undefined} />
          <span>{a.approved} approved</span>
          <span>{a.onTime == null ? 'On-time: no data yet' : `${a.onTime}% on time`}</span>
        </div>
      </div>
      <div className="agent-card-foot">
        <span className="tag">{a.model}</span>
        {a.ownerId && <span className="tag jade">Citizen-owned</span>}
        {a.working && <span className="tag jade">At work</span>}
        {onDecree && (
          <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => onDecree(a)}>
            Issue decree
          </button>
        )}
      </div>
    </article>
  );
}

const STATUS: Record<DecreeStatus, { label: string; bg: string; fg: string }> = {
  queued: { label: 'In queue', bg: '#f8ecd6', fg: '#99600f' },
  working: { label: 'Being crafted', bg: '#e4f0e6', fg: '#2f7a52' },
  delivered: {
    label: 'Awaiting approval',
    bg: 'var(--purple-soft)',
    fg: 'var(--purple-2)',
  },
  approved: { label: 'Approved', bg: '#e6f0e4', fg: '#33794f' },
  failed: { label: 'Failed · refunded', bg: '#f6e2dc', fg: '#a8402f' },
  cancelled: { label: 'Cancelled', bg: '#efe8df', fg: '#7d6d60' },
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
        <div className="ellipsis decree-row-title">{d.title}</div>
        <div className="ellipsis decree-row-meta">
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
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        fontWeight: 600,
        color: p.color,
      }}
    >
      <ProvinceIcon id={id} size={24} />
      {p.name}
    </span>
  );
}
