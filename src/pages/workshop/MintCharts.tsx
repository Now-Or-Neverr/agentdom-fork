// Small, dependency-free building blocks for the Royal Mint workshop: a price chart for
// hourly candles (plain SVG, colours from the theme tokens) and a top-holders list.
import { useId, type CSSProperties, type ReactNode } from 'react';
import type * as I from '../../../server/integrations';
import { Ext } from './shared';

/** A USD price that may be tiny ($0.0000329) or large ($351.72). */
export const price = (v: number | null | undefined) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (v === 0) return '$0';
  if (Math.abs(v) < 0.01) return '$' + v.toPrecision(3);
  return '$' + v.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 });
};
export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const hm = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const W = 600;
const H = 150;
const PAD = 12;

/**
 * Close prices as a line with a soft area under it. The x axis follows real time, so hours
 * without trades show as a straight segment instead of being squeezed out.
 */
export function CandleChart({ candles, label, empty = 'Not enough trades yet to draw a chart.' }: { candles: I.Candle[] | null | undefined; label: string; empty?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  // Providers differ in order (Chainlink sends newest first), so sort by time.
  const list = (candles ?? []).filter((c) => Number.isFinite(c.c) && c.c > 0 && Number.isFinite(Date.parse(c.t))).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  if (list.length < 2) {
    return (
      <figure className="ws-spark" style={{ margin: 0 }}>
        <figcaption className="ws-muted">
          <b style={{ fontWeight: 600 }}>{label}</b> · {list.length === 1 ? `one candle so far (${price(list[0].c)} at ${hm(list[0].t)}). ` : ''}
          {empty}
        </figcaption>
      </figure>
    );
  }
  const ts = list.map((c) => Date.parse(c.t));
  const t0 = ts[0];
  const tSpan = ts[ts.length - 1] - t0 || 1;
  const closes = list.map((c) => c.c);
  const lo = Math.min(...closes);
  const hi = Math.max(...closes);
  const span = hi - lo || hi * 0.01 || 1;
  const x = (i: number) => ((ts[i] - t0) / tSpan) * W;
  const y = (v: number) => H - PAD - ((v - lo) / span) * (H - PAD * 2);
  const line = list.map((c, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(c.c).toFixed(1)}`).join(' ');
  const area = `${line} L${W},${H} L0,${H} Z`;
  const first = list[0].o > 0 ? list[0].o : list[0].c;
  const last = list[list.length - 1].c;
  const change = ((last - first) / first) * 100;
  const up = change >= 0;
  const tone = up ? 'var(--ok)' : 'var(--bad)';
  const rangeLo = Math.min(...list.map((c) => (Number.isFinite(c.l) && c.l > 0 ? c.l : c.c)));
  const rangeHi = Math.max(...list.map((c) => (Number.isFinite(c.h) && c.h > 0 ? c.h : c.c)));
  const tag: CSSProperties = {
    position: 'absolute',
    left: 10,
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    color: 'var(--ink-3)',
    background: 'color-mix(in srgb, var(--surface-2) 80%, transparent)',
    padding: '1px 5px',
    borderRadius: 6,
    pointerEvents: 'none',
  };
  return (
    <figure className="ws-spark" style={{ margin: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 12px' }}>
        <b style={{ fontWeight: 600 }}>{label}</b>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>
          {price(last)}{' '}
          <span style={{ color: tone, fontWeight: 600 }}>
            {up ? '+' : ''}
            {change.toFixed(2)}%
          </span>
        </span>
      </div>
      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${label}: ${price(first)} to ${price(last)}, ${change.toFixed(2)}%`} style={{ display: 'block' }}>
          <defs>
            <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={tone} stopOpacity="0.28" />
              <stop offset="100%" stopColor={tone} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#g${id})`} stroke="none" />
          <path d={line} fill="none" stroke={tone} strokeWidth="2.25" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <span style={{ ...tag, top: 6 }}>high {price(hi)}</span>
        <span style={{ ...tag, bottom: 6 }}>low {price(lo)}</span>
      </div>
      <figcaption className="ws-muted">
        {hm(list[0].t)} → {hm(list[list.length - 1].t)} · {list.length} hourly candles · close prices · intraday range {price(rangeLo)}–{price(rangeHi)}
      </figcaption>
    </figure>
  );
}

const table: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const cell: CSSProperties = { padding: '5px 6px', borderBottom: '1px solid rgba(127,127,127,.2)', textAlign: 'left', whiteSpace: 'nowrap' };

/** Top holders of a token: name or short address, share of supply with a thin bar, balance. */
export function HolderList({ holders, symbol, limit = 10 }: { holders: I.HolderRow[]; symbol?: string | null; limit?: number }) {
  if (!holders.length) return <p className="ws-muted">The explorer lists no holders yet.</p>;
  const top = holders.slice(0, limit);
  const max = Math.max(...top.map((h) => h.pct ?? 0), 1);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={table}>
        <tbody>
          {top.map((h, i) => (
            <tr key={h.address}>
              <td style={{ ...cell, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', fontSize: 12, width: 24 }}>{i + 1}</td>
              <td style={{ ...cell, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                <Ext href={h.url}>{h.name ?? shortAddr(h.address)}</Ext> {h.isContract && <span className="tag">contract</span>}
                <div className="ws-muted" style={{ fontSize: 12 }}>
                  {Number(h.balance).toLocaleString('en', { notation: 'compact', maximumFractionDigits: 2 })}
                  {symbol ? ` ${symbol}` : ''}
                </div>
              </td>
              <td style={{ ...cell, width: '38%', minWidth: 110 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, minWidth: 48 }}>{h.pct === null ? '—' : `${h.pct.toFixed(2)}%`}</span>
                  <span style={{ flex: 1, height: 6, borderRadius: 99, background: 'var(--bg-2)', overflow: 'hidden', minWidth: 30 }}>
                    <i style={{ display: 'block', height: '100%', width: `${((h.pct ?? 0) / max) * 100}%`, background: 'var(--gold)', borderRadius: 99 }} />
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A responsive grid of small stat tiles. */
export function Stats({ items }: { items: { label: string; value: ReactNode; note?: ReactNode }[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
      {items.map((s) => (
        <div key={s.label} style={{ background: 'var(--surface-2)', border: '1px solid var(--line-c)', borderRadius: 14, padding: '12px 14px', minWidth: 0 }}>
          <div className="ws-muted" style={{ fontSize: 12 }}>
            {s.label}
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, lineHeight: 1.15, overflowWrap: 'anywhere' }}>{s.value}</div>
          {s.note && (
            <div className="ws-muted" style={{ fontSize: 12 }}>
              {s.note}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** Coloured change text: green when up, red when down. */
export function Change({ pct, digits = 2 }: { pct: number | null | undefined; digits?: number }) {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return <span>—</span>;
  return (
    <span style={{ color: pct >= 0 ? 'var(--ok)' : 'var(--bad)', fontWeight: 600 }}>
      {pct > 0 ? '+' : ''}
      {pct.toFixed(digits)}%
    </span>
  );
}
