// Royal Mint workshop: Solana stock tokens (official Stock Token API + Chainlink + DEX),
// dividends and splits, Chainlink oracles and what is trading on Solana.
import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { Search } from 'lucide-react';
import { chainTools, compact, num } from '../../lib/toolsApi';
import { Ext, Panel, Source, Status, useRun } from './shared';
import { NotFinancial } from './MintTools';
import { CandleChart, Change, Stats } from './MintCharts';

const table: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const cell: CSSProperties = { padding: '5px 6px', borderBottom: '1px solid rgba(127,127,127,.2)', textAlign: 'left', whiteSpace: 'nowrap' };
// The lookup table is not in a scroll box, so its cells may wrap on a phone.
const wrap: CSSProperties = { ...cell, whiteSpace: 'normal', verticalAlign: 'top', overflowWrap: 'break-word' };
const usd = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? '—' : '$' + v.toLocaleString('en', { minimumFractionDigits: d, maximumFractionDigits: d }));
const small = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v < 0.01 ? '$' + v.toPrecision(3) : usd(v, v < 1 ? 4 : 2));
const pctTxt = (p: number | null | undefined) => (p === null || p === undefined ? '—' : `${p > 0 ? '+' : ''}${p}%`);
const ago = (iso: string | null) => {
  if (!iso) return '—';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function StockBoardTool() {
  const [s, run] = useRun<Awaited<ReturnType<typeof chainTools.stocks>>>();
  useEffect(() => {
    run(chainTools.stocks());
  }, []);
  return (
    <Panel title="Stock tokens vs Wall Street" sub="Each token four ways: Wall Street (Solana's live quote × the token's multiplier), Solana's token price, the Chainlink oracle read onchain, and the DEX.">
      <div className="ws-row ws-end">
        <button className="btn btn-sm" disabled={s.loading} onClick={() => run(chainTools.stocks())}>
          Refresh
        </button>
      </div>
      <Status s={s} label="Reading Solana, Chainlink and the DEX…">
        {(d) => (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={table}>
                <thead>
                  <tr>
                    <th style={cell}>Token</th>
                    <th style={cell}>Wall Street × mult.</th>
                    <th style={cell}>Solana token</th>
                    <th style={cell}>Chainlink</th>
                    <th style={cell}>DEX</th>
                    <th style={cell}>DEX gap</th>
                    <th style={cell}>DEX liquidity</th>
                  </tr>
                </thead>
                <tbody>
                  {d.tokens.map((t) => (
                    <tr key={t.address}>
                      <td style={cell}>
                        {t.logo && <img src={t.logo} alt="" width={18} height={18} style={{ borderRadius: 4, verticalAlign: '-4px', marginRight: 6 }} loading="lazy" />}
                        <Ext href={t.url}>{t.ticker}</Ext> {t.halted && <span className="tag">halted</span>}
                      </td>
                      <td style={cell}>{usd(t.fairTokenPrice)}</td>
                      <td style={cell}>{usd(t.robinhoodTokenBid)}</td>
                      <td style={cell} title={t.oracleUpdatedAt ? `updated ${ago(t.oracleUpdatedAt)}` : ''}>
                        {usd(t.oraclePrice)}
                      </td>
                      <td style={cell}>{usd(t.tokenPriceUsd)}</td>
                      <td style={{ ...cell, color: t.gapPct !== null && Math.abs(t.gapPct) >= 1 ? 'var(--warn)' : undefined }}>{pctTxt(t.gapPct)}</td>
                      <td style={cell}>{usd(t.liquidityUsd, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="ws-muted">
              {num(d.listed, 0)} official stock tokens are listed by Solana; look any of them up below. {d.note}
            </p>
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

export function StockLookupTool() {
  const [sym, setSym] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof chainTools.stock>>>();
  return (
    <Panel title="Look up a stock token" sub="Any of the official Solana stock tokens, by ticker or contract address: quotes, oracle, DEX, supply onchain, multiplier and dividends.">
      <form
        className="ws-row ws-wrap"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (sym.trim()) run(chainTools.stock(sym.trim()));
        }}
      >
        <input className="field ws-grow" value={sym} onChange={(e) => setSym(e.target.value)} placeholder="Ticker, e.g. AAPL, or 0x… address" maxLength={60} spellCheck={false} />
        <button className="btn btn-seal" disabled={s.loading || !sym.trim()}>
          <Search size={15} /> Look up
        </button>
      </form>
      <Status s={s} label="Reading the stock token…">
        {(d) => (
          <>
            <p style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {d.logo && <img src={d.logo} alt="" width={28} height={28} style={{ borderRadius: 6 }} />}
              <b>{d.ticker}</b> {d.name} · <Ext href={d.url}>{short(d.address)}</Ext>
              {d.halted && <span className="tag">trading halt</span>}
            </p>
            <table style={table}>
              <tbody>
                <tr>
                  <td style={wrap}>Wall Street bid / ask</td>
                  <td style={wrap}>
                    {usd(d.wallStreetBid)} / {usd(d.wallStreetAsk)} · day {usd(d.dailyLow)}–{usd(d.dailyHigh)}
                  </td>
                </tr>
                <tr>
                  <td style={wrap}>Fair token price</td>
                  <td style={wrap}>
                    {usd(d.fairTokenPrice)} (multiplier {d.multiplier.toFixed(6)}
                    {d.pendingMultiplier ? `, changing to ${d.pendingMultiplier.toFixed(6)}${d.pendingAt ? ` on ${d.pendingAt.slice(0, 10)}` : ''}` : ''})
                  </td>
                </tr>
                <tr>
                  <td style={wrap}>Solana token bid / ask</td>
                  <td style={wrap}>
                    {usd(d.robinhoodTokenBid)} / {usd(d.robinhoodTokenAsk)}
                  </td>
                </tr>
                <tr>
                  <td style={wrap}>Chainlink oracle</td>
                  <td style={wrap}>
                    {usd(d.oraclePrice)} · updated {ago(d.oracleUpdatedAt)}
                  </td>
                </tr>
                <tr>
                  <td style={wrap}>DEX</td>
                  <td style={wrap}>
                    {usd(d.tokenPriceUsd)} · gap {pctTxt(d.gapPct)} · liquidity {usd(d.liquidityUsd, 0)}
                  </td>
                </tr>
                <tr>
                  <td style={wrap}>Supply onchain</td>
                  <td style={wrap}>
                    {d.supply === null ? '—' : Number(d.supply).toLocaleString('en', { maximumFractionDigits: 2 })} tokens · minted/burned today {usd(d.mintBurnUsd, 0)}
                  </td>
                </tr>
              </tbody>
            </table>
            {(d.shareCandles || d.tokenCandles) && (
              <div className="ws-grid2">
                {d.shareCandles && <CandleChart candles={d.shareCandles} label={`${d.ticker} share, last 24 h (Chainlink)`} empty="No share price candles in this window." />}
                {d.tokenCandles && <CandleChart candles={d.tokenCandles} label={`${d.ticker} token on DEX, last 24 h (Codex)`} empty="Not enough DEX trades yet to draw a chart." />}
              </div>
            )}
            {d.actions.length > 0 && (
              <>
                <h4>Dividends and splits</h4>
                <ul className="ws-list">
                  {d.actions.map((a, i) => (
                    <li key={i}>
                      <span className="tag">{a.type}</span> {a.detail} · {a.date} · {a.status}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <NotFinancial />
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

export function ActionsTool() {
  const [s, run] = useRun<Awaited<ReturnType<typeof chainTools.actions>>>();
  useEffect(() => {
    run(chainTools.actions());
  }, []);
  return (
    <Panel title="Dividends and splits" sub="Corporate actions Solana is processing for its stock tokens, newest first. Splits are applied through each token's multiplier.">
      <Status s={s} label="Reading corporate actions…">
        {(d) => (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={table}>
                <tbody>
                  {d.actions.slice(0, 15).map((a, i) => (
                    <tr key={i}>
                      <td style={cell}>{a.url ? <Ext href={a.url}>{a.symbol}</Ext> : a.symbol}</td>
                      <td style={cell}>{a.type}</td>
                      <td style={cell}>{a.detail}</td>
                      <td style={cell}>{a.date}</td>
                      <td style={cell}>{a.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

export function OracleTool() {
  const [kind, setKind] = useState<'crypto' | 'stock'>('crypto');
  const [s, run] = useRun<Awaited<ReturnType<typeof chainTools.oracles>>>();
  useEffect(() => {
    run(chainTools.oracles(kind));
  }, [kind]);
  return (
    <Panel title="Chainlink prices onchain" sub="Price oracles on Solana, read straight from the Chainlink feed contracts.">
      <div className="ws-row">
        <button className={'btn btn-sm' + (kind === 'crypto' ? ' btn-seal' : '')} onClick={() => setKind('crypto')}>
          Crypto
        </button>
        <button className={'btn btn-sm' + (kind === 'stock' ? ' btn-seal' : '')} onClick={() => setKind('stock')}>
          Stocks (24/7)
        </button>
      </div>
      <Status s={s} label="Reading Chainlink feeds…">
        {(d) => (
          <>
            <ul className="ws-list" style={{ columns: 2, columnGap: 24 }}>
              {d.feeds
                .filter((f) => f.price !== null)
                .map((f) => (
                  <li key={f.url} style={{ breakInside: 'avoid' }}>
                    <Ext href={f.url}>{f.name.replace(/^Solana\s+/, '')}</Ext> <b>{small(f.price)}</b> <span className="ws-muted">· {ago(f.updatedAt)}</span>
                  </li>
                ))}
            </ul>
            <p className="ws-muted">{d.note}</p>
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

export function MarketsTool({ onCheck }: { onCheck?: (address: string) => void }) {
  const [s, run] = useRun<Awaited<ReturnType<typeof chainTools.markets>>>();
  useEffect(() => {
    run(chainTools.markets());
  }, []);
  const list = (rows: NonNullable<typeof s.data>['trending'], fresh: boolean) => (
    <div style={{ overflowX: 'auto' }}>
      <table style={table}>
        <tbody>
          {rows.map((p) => (
            <tr key={p.url}>
              <td style={cell}>
                <Ext href={p.url}>{p.name}</Ext> <span className="ws-muted">{p.dex}</span>
              </td>
              <td style={cell}>{small(p.priceUsd)}</td>
              <td style={cell}>{fresh ? ago(p.createdAt) : pctTxt(p.change24h === null ? null : Math.round(p.change24h * 10) / 10)}</td>
              <td style={cell}>liq {usd(p.liquidityUsd, 0)}</td>
              <td style={cell}>vol {usd(p.volume24h, 0)}</td>
              <td style={cell}>
                {p.token && onCheck && (
                  <button className="btn btn-sm" onClick={() => onCheck(p.token!)}>
                    Check
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <Panel title="What is trading on Solana" sub="Trending pools and brand-new pools from GeckoTerminal. Press Check to run a token through the contract check.">
      <div className="ws-row ws-end">
        <button className="btn btn-sm" disabled={s.loading} onClick={() => run(chainTools.markets())}>
          Refresh
        </button>
      </div>
      <Status s={s} label="Reading GeckoTerminal…">
        {(d) => (
          <>
            <h4>Trending</h4>
            {list(d.trending, false)}
            <h4>Just launched</h4>
            {list(d.newest, true)}
            <p className="ws-muted">
              {d.dexCount ? `${d.dexCount} DEXes are active on Solana. ` : ''}
              {d.note}
            </p>
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

export function EconomyTool() {
  const [s, run] = useRun<Awaited<ReturnType<typeof chainTools.economy>>>();
  useEffect(() => {
    run(chainTools.economy());
  }, []);
  const money = (v: number | null) => (v === null ? '—' : '$' + compact(v));
  const rank = (rows: { name: string; value: number }[]) => {
    const max = Math.max(...rows.map((r) => r.value), 1);
    return (
      <ul className="ws-list">
        {rows.map((r) => (
          <li key={r.name} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '4px 12px', alignItems: 'center' }}>
            <span style={{ overflowWrap: 'anywhere' }}>{r.name}</span>
            <b style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 13 }}>{money(r.value)}</b>
            <span style={{ gridColumn: '1 / -1', height: 5, borderRadius: 99, background: 'var(--bg-2)', overflow: 'hidden' }}>
              <i style={{ display: 'block', height: '100%', width: `${(r.value / max) * 100}%`, background: 'var(--gold)', borderRadius: 99 }} />
            </span>
          </li>
        ))}
      </ul>
    );
  };
  return (
    <Panel title="Solana economy" sub="How much money lives on the chain and how much moves through it in a day: value locked, DEX volume, fees and stablecoins, from DefiLlama.">
      <Status s={s} label="Reading DefiLlama…">
        {(d) => (
          <>
            <Stats
              items={[
                { label: 'Value locked (TVL)', value: money(d.tvl) },
                {
                  label: 'DEX volume, 24 h',
                  value: money(d.dexVolume24h),
                  note: d.dexVolumeChange1d === null ? undefined : (
                    <>
                      <Change pct={d.dexVolumeChange1d} /> vs the day before
                    </>
                  ),
                },
                { label: 'Fees paid, 24 h', value: money(d.fees24h) },
                { label: 'Stablecoins', value: money(d.stablecoins) },
              ]}
            />
            {(d.topDexes.length > 0 || d.topFees.length > 0) && (
              <div className="ws-grid2">
                {d.topDexes.length > 0 && (
                  <div>
                    <h4>Top DEXes by 24 h volume</h4>
                    {rank(d.topDexes.map((x) => ({ name: x.name, value: x.volume24h })))}
                  </div>
                )}
                {d.topFees.length > 0 && (
                  <div>
                    <h4>Top fee earners, 24 h</h4>
                    {rank(d.topFees.map((x) => ({ name: x.name, value: x.fees24h })))}
                  </div>
                )}
              </div>
            )}
            <p className="ws-muted">DefiLlama totals are updated a few times a day and count only protocols it tracks.</p>
            <NotFinancial />
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

export function LaunchesTool({ onCheck }: { onCheck?: (address: string) => void }) {
  const [s, run] = useRun<Awaited<ReturnType<typeof chainTools.launches>>>();
  useEffect(() => {
    run(chainTools.launches());
  }, []);
  return (
    <Panel title="New launches" sub="The newest tokens on Solana with at least $1,000 of liquidity, from Codex. Press Check to run one through the contract check.">
      <div className="ws-row ws-end">
        <button className="btn btn-sm" disabled={s.loading} onClick={() => run(chainTools.launches())}>
          Refresh
        </button>
      </div>
      <Status s={s} label="Reading Codex…">
        {(d) => (
          <>
            {d.launches.length ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={table}>
                  <thead>
                    <tr>
                      <th style={cell}>Token</th>
                      <th style={cell}>Launched</th>
                      <th style={cell}>Liquidity</th>
                      <th style={cell}>Market cap</th>
                      <th style={cell}>Volume 24 h</th>
                      <th style={cell}>Holders</th>
                      <th style={cell} />
                    </tr>
                  </thead>
                  <tbody>
                    {d.launches.map((l) => (
                      <tr key={l.address}>
                        <td style={{ ...cell, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }} title={`${l.name} (${l.symbol})`}>
                          <Ext href={l.url}>{l.symbol || short(l.address)}</Ext> <span className="ws-muted">{l.name}</span>
                        </td>
                        <td style={cell}>{ago(l.createdAt)}</td>
                        <td style={cell}>{usd(l.liquidityUsd, 0)}</td>
                        <td style={cell}>{usd(l.marketCapUsd, 0)}</td>
                        <td style={cell}>{usd(l.volume24h, 0)}</td>
                        <td style={cell}>{l.holders === null ? '—' : num(l.holders, 0)}</td>
                        <td style={cell}>
                          {onCheck && (
                            <button className="btn btn-sm" onClick={() => onCheck(l.address)}>
                              Check
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="ws-muted">No new tokens with enough liquidity right now.</p>
            )}
            <p className="ws-muted">{d.note}</p>
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}
