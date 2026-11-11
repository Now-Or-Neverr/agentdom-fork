// Workshop tools for the Royal Mint: read-only Solana data. Every answer shows its
// source, an explorer link to verify it, and when it was fetched. Nothing here can send or sign.
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { AlertTriangle, ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Search } from 'lucide-react';
import { chainTools, compact, num } from '../../lib/toolsApi';
import { BRAND } from '../../config';
import { Ext, Panel, Source, Status, useRun } from './shared';
import * as Markets from './MintMarkets';
import { CandleChart, Change, HolderList, Stats, price } from './MintCharts';
import type * as I from '../../../server/integrations';

const AGENTDOM_CA = BRAND.ca;

const table: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
// Values wrap so the tables fit a phone.
const cell: CSSProperties = { padding: '5px 6px', borderBottom: '1px solid rgba(127,127,127,.2)', textAlign: 'left', verticalAlign: 'top', overflowWrap: 'break-word' };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const usd = (n: number | null, d = 2) => (n === null ? '—' : '$' + n.toLocaleString('en', { minimumFractionDigits: d, maximumFractionDigits: d }));
const amt = (s: string | null) => {
  if (s === null) return '—';
  const v = Number(s);
  return v > 0 && v < 1e-8 ? '< 0.00000001' : v.toLocaleString('en', { maximumFractionDigits: v < 1 ? 8 : 2 });
};
const ZERO = '0x0000000000000000000000000000000000000000';
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export function NotFinancial() {
  return (
    <p className="ws-muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <AlertTriangle size={14} /> Read-only data from Solana. Not financial advice.
    </p>
  );
}

function AddrForm({ value, set, onGo, busy, placeholder, button }: { value: string; set: (v: string) => void; onGo: () => void; busy: boolean; placeholder: string; button: string }) {
  return (
    <form
      className="ws-row ws-wrap"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (value.trim()) onGo();
      }}
    >
      <input className="field ws-grow" value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder} maxLength={80} spellCheck={false} />
      <button className="btn btn-seal" disabled={busy || !value.trim()}>
        <Search size={15} /> {button}
      </button>
    </form>
  );
}

export function AgentdomVaultTool() {
  const [s, run] = useRun<Awaited<ReturnType<typeof chainTools.agentdom>>>();
  useEffect(() => {
    run(chainTools.agentdom());
  }, []);
  return (
    <Panel title="$AGENTDOM ledger" sub="The realm's own token, read live: price and liquidity from DexScreener, the 24 h chart from Codex, holders from the explorer, supply and burned amount from the chain.">
      <Status s={s} label="Reading the $AGENTDOM ledger…">
        {(d) => (
          <>
            <CandleChart candles={d.chart} label="$AGENTDOM, last 24 h" />
            <table style={table}>
              <tbody>
                <tr>
                  <td style={cell}>Holders</td>
                  <td style={cell}>{d.holders === null ? '—' : num(d.holders, 0)}{d.top10Pct !== null ? ` · top 10 hold ${num(d.top10Pct, 1)}%` : ''}</td>
                </tr>
                <tr>
                  <td style={cell}>Burned</td>
                  <td style={cell}>
                    {amt(d.burned)} AGENTDOM{d.burnedPct !== null ? ` (${d.burnedPct}% of supply)` : ''}
                  </td>
                </tr>
                <tr>
                  <td style={cell}>Total supply</td>
                  <td style={cell}>{amt(d.totalSupply)}</td>
                </tr>
                <tr>
                  <td style={cell}>Price</td>
                  <td style={cell}>
                    {price(d.priceUsd)}
                    {d.change24h !== null && (
                      <>
                        {' '}
                        · <Change pct={d.change24h} /> in 24 h
                      </>
                    )}
                    {d.fdv !== null ? ` · FDV ${usd(d.fdv, 0)}` : ''}
                  </td>
                </tr>
                <tr>
                  <td style={cell}>Liquidity · 24 h volume</td>
                  <td style={cell}>
                    {usd(d.liquidityUsd, 0)} · {usd(d.volume24h, 0)}
                  </td>
                </tr>
                {d.txns24h && (
                  <tr>
                    <td style={cell}>Trades in 24 h</td>
                    <td style={cell}>
                      {num(d.txns24h.buys, 0)} buys · {num(d.txns24h.sells, 0)} sells
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {d.topHolders && d.topHolders.length > 0 && (
              <>
                <h4>Top holders</h4>
                <HolderList holders={d.topHolders} symbol="AGENTDOM" />
                <p className="ws-muted">Pools and launch lockers hold part of the supply; they are named where the explorer knows them.</p>
              </>
            )}
            <p className="ws-muted">
              Contract <Ext href={d.sourceUrl}>{short(d.address)}</Ext>
              {d.pairUrl && (
                <>
                  {' '}
                  · <Ext href={d.pairUrl}>DexScreener pair</Ext>
                </>
              )}
            </p>
            <NotFinancial />
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

export function ChainPulseTool() {
  const [s, run] = useRun<Awaited<ReturnType<typeof chainTools.pulse>>>();
  useEffect(() => {
    run(chainTools.pulse());
  }, []);
  return (
    <Panel title="Solana right now" sub="The latest slots from the public RPC: block time and transactions per slot.">
      <div className="ws-row ws-end">
        <button className="btn btn-sm" disabled={s.loading} onClick={() => run(chainTools.pulse())}>
          Refresh
        </button>
      </div>
      <Status s={s} label="Reading the latest blocks…">
        {(d) => (
          <>
            <p>
              Block <Ext href={d.sourceUrl}>{num(d.latestBlock, 0)}</Ext> · {d.avgBlockSeconds !== null ? `a block every ${d.avgBlockSeconds} s · ` : ''}
              {d.avgTxPerBlock} transactions per block · gas {d.gasPriceGwei} gwei
            </p>
            {d.stats && (
              <>
                <Stats
                  items={[
                    { label: 'Transactions today', value: d.stats.transactionsToday === null ? '—' : compact(d.stats.transactionsToday) },
                    { label: 'Transactions ever', value: d.stats.totalTransactions === null ? '—' : compact(d.stats.totalTransactions) },
                    { label: 'Addresses', value: d.stats.totalAddresses === null ? '—' : compact(d.stats.totalAddresses) },
                    {
                      label: 'Average block time',
                      value: d.stats.avgBlockMs === null ? '—' : d.stats.avgBlockMs < 1000 ? `${num(d.stats.avgBlockMs, 0)} ms` : `${num(d.stats.avgBlockMs / 1000, 2)} s`,
                    },
                    ...(d.stats.gas
                      ? [{ label: 'Gas, gwei', value: `${num(d.stats.gas.slow, 3)}–${num(d.stats.gas.fast, 3)}`, note: `slow ${num(d.stats.gas.slow, 3)} · average ${num(d.stats.gas.average, 3)} · fast ${num(d.stats.gas.fast, 3)}` }]
                      : []),
                  ]}
                />
                <p className="ws-muted">Chain totals, block time and gas tiers from the Blockscout explorer; blocks below from the public RPC.</p>
              </>
            )}
            <ul className="ws-list">
              {d.blocks.map((b) => (
                <li key={b.number}>
                  <Ext href={b.url}>#{num(b.number, 0)}</Ext> <span className="ws-muted">· {b.txs} tx · {new Date(b.time).toLocaleTimeString()}</span>
                </li>
              ))}
            </ul>
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

export function TxTool() {
  const [hash, setHash] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof chainTools.tx>>>();
  return (
    <Panel title="Explain a transaction" sub="Paste a Solana transaction signature. See status, fee, and account keys involved.">
      <AddrForm value={hash} set={setHash} onGo={() => run(chainTools.tx(hash.trim()))} busy={s.loading} placeholder="Signature (base58)…" button="Explain" />
      <Status s={s} label="Reading the transaction…">
        {(d) => (
          <>
            <p>
              <span className="tag">{d.status}</span> {d.method ?? 'contract call'} · block {d.block === null ? 'pending' : num(d.block, 0)} · {when(d.time)}
            </p>
            <p className="ws-muted">
              From <Ext href={d.sourceUrl.replace(/tx\/.*/, `address/${d.from}`)}>{short(d.from)}</Ext>
              {d.to && (
                <>
                  {' '}
                  to <Ext href={d.sourceUrl.replace(/tx\/.*/, `address/${d.to}`)}>{short(d.to)}</Ext>
                </>
              )}
              {d.contractCreated && <> · created contract {short(d.contractCreated)}</>} · value {amt(d.valueEth)} ETH · fee {d.feeEth === null ? '—' : `${amt(d.feeEth)} ETH`}
            </p>
            {d.tokenTransfers.length > 0 && (
              <>
                <h4>Token transfers</h4>
                <ul className="ws-list">
                  {d.tokenTransfers.map((t, i) => (
                    <li key={i}>
                      {amt(t.amount)} <Ext href={t.url}>{t.symbol ?? short(t.token)}</Ext> from {short(t.from)} to {short(t.to)} {t.burn && <span className="tag">burned</span>}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

export function AddressTool() {
  const [addr, setAddr] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof chainTools.address>>>();
  return (
    <Panel title="Look up a wallet" sub="SOL balance and SPL token accounts from Solana RPC.">
      <AddrForm value={addr} set={setAddr} onGo={() => run(chainTools.address(addr.trim()))} busy={s.loading} placeholder="Solana wallet address…" button="Look up" />
      <Status s={s} label="Reading the address…">
        {(d) => (
          <>
            <p>
              <span className="tag">{d.kind}</span> <Ext href={d.sourceUrl}>{short(d.address)}</Ext> · {amt(d.ethBalance)} ETH · {num(d.txCount, 0)} sent transactions
              {d.activity?.tokenTransfers !== null && d.activity?.tokenTransfers !== undefined ? ` · ${num(d.activity.tokenTransfers, 0)} token transfers` : ''}
            </p>
            {d.portfolio && (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 12px' }}>
                  <span className="ws-big">{usd(d.portfolio.totalUsd)}</span>
                  <span className="ws-muted">
                    portfolio on Solana · <Ext href={d.portfolio.sourceUrl}>portfolio</Ext>
                  </span>
                </div>
                {d.portfolio.positions.length > 0 && (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={table}>
                      <tbody>
                        {d.portfolio.positions.map((p, i) => (
                          <tr key={p.symbol + i}>
                            <td style={cell}>
                              <b>{p.symbol}</b> <span className="ws-muted">{p.name}</span>
                            </td>
                            <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>{p.quantity < 1e-6 ? '< 0.000001' : num(p.quantity, p.quantity < 1 ? 6 : 2)}</td>
                            <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>{p.valueUsd === null ? '—' : p.valueUsd < 0.01 ? '< $0.01' : usd(p.valueUsd)}</td>
                            <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>{p.change1dPct === null ? '' : <Change pct={p.change1dPct} />}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
            <h4>Tokens</h4>
            {d.tokens.length ? (
              <ul className="ws-list">
                {d.tokens.map((t) => (
                  <li key={t.address}>
                    {amt(t.balance)} <Ext href={t.url}>{t.symbol}</Ext> <span className="ws-muted">{t.name}</span>
                    {t.valueUsd !== null && <b> · {t.valueUsd < 0.01 ? '< $0.01' : usd(t.valueUsd)}</b>}
                    {t.flagged && (
                      <>
                        {' '}
                        <span className="tag" style={{ color: 'var(--bad)' }}>
                          flagged as spam or scam
                        </span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ws-muted">{d.allTokens ? 'No ERC-20 tokens are held.' : `None of the ${d.checkedTokens} known tokens are held.`}</p>
            )}
            {d.transfers.length > 0 && (
              <>
                <h4>Recent transfers</h4>
                <ul className="ws-list">
                  {d.transfers.slice(0, 10).map((t, i) => {
                    const Icon = t.direction === 'in' ? ArrowDownLeft : t.direction === 'out' ? ArrowUpRight : ArrowLeftRight;
                    const other = t.direction === 'in' ? t.from : t.to;
                    return (
                      <li key={t.hash + i} style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: 8, alignItems: 'start' }}>
                        <span style={{ color: t.direction === 'in' ? 'var(--ok)' : t.direction === 'out' ? 'var(--bad)' : 'var(--ink-3)', display: 'inline-flex', paddingTop: 3 }} aria-label={t.direction} title={t.direction}>
                          <Icon size={15} />
                        </span>
                        <span style={{ overflowWrap: 'anywhere' }}>
                          {t.direction === 'in' ? 'In' : t.direction === 'out' ? 'Out' : 'Self'} {t.amount === null ? '' : num(t.amount, t.amount < 1 ? 6 : 2)}{' '}
                          {t.asset ?? (/erc721|erc1155/.test(t.category) ? 'NFT' : t.category)}
                          {t.direction === 'in' && t.from.toLowerCase() === ZERO ? ' (minted)' : other && t.direction !== 'self' ? (t.direction === 'in' ? ' from ' : ' to ') + short(other) : ''}
                          {t.burn && (
                            <>
                              {' '}
                              <span className="tag">burn</span>
                            </>
                          )}{' '}
                          <span className="ws-muted">
                            · <Ext href={t.url}>{when(t.time)}</Ext>
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            {d.recent.length > 0 && (
              <>
                <h4>Recent transactions</h4>
                <ul className="ws-list">
                  {d.recent.slice(0, 6).map((t) => (
                    <li key={t.hash}>
                      <Ext href={t.url}>{t.method ?? 'call'}</Ext>
                      {t.to ? ` to ${t.toName ?? short(t.to)}` : ''} {!t.ok && <span className="tag">failed</span>}
                      <span className="ws-muted">
                        {' '}
                        · {Number(t.valueEth) > 0 ? `${amt(t.valueEth)} ETH · ` : ''}fee {t.feeEth === null ? '—' : `${amt(t.feeEth)} ETH`} · {when(t.time)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {d.nfts && d.nfts.total > 0 && (
              <>
                <h4>NFTs ({num(d.nfts.total, 0)})</h4>
                <ul className="ws-list">
                  {d.nfts.items.slice(0, 5).map((n) => (
                    <li key={n.contract + n.tokenId} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      {n.image && <img src={n.image} alt="" width={28} height={28} style={{ borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />}
                      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                        {n.name} {n.collection && n.collection !== n.name && <span className="ws-muted">· {n.collection}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
                {d.nfts.total > 5 && <p className="ws-muted">and {num(d.nfts.total - 5, 0)} more.</p>}
              </>
            )}
            <p className="ws-muted">
              {d.note}
              {d.portfolio ? ' Portfolio total and positions from Zerion.' : ''}
              {d.transfers.length || d.nfts ? ' Transfers and NFTs from Alchemy.' : ''}
            </p>
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

export function ContractTool({ preset }: { preset?: { address: string; n: number } | null }) {
  const [addr, setAddr] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof chainTools.contract>>>();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!preset) return;
    setAddr(preset.address);
    run(chainTools.contract(preset.address));
    box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [preset?.n]);
  return (
    <div ref={box} style={{ scrollMarginTop: 90 }}>
    <Panel title="Check a token contract" sub="Before you touch a token: who controls it, what they could change, how deep its liquidity is and how its holders are spread.">
      <AddrForm value={addr} set={setAddr} onGo={() => run(chainTools.contract(addr.trim()))} busy={s.loading} placeholder="SPL mint address…" button="Check" />
      <Status s={s} label="Reading the contract…">
        {(d) =>
          !d.isContract ? (
            <p>{d.note}</p>
          ) : (
            <>
              <p>
                <Ext href={d.sourceUrl}>{d.token ? `${d.token.name ?? ''} (${d.token.symbol ?? '?'})` : short(d.address)}</Ext>
                {d.stockToken && <span className="tag">official stock token</span>}
                {d.honeypot === true && <span className="tag">honeypot flag</span>}
              </p>
              <table style={table}>
                <tbody>
                  <tr>
                    <td style={cell}>Supply · burned</td>
                    <td style={cell}>
                      {amt(d.totalSupply)} · {amt(d.burned)}
                    </td>
                  </tr>
                  <tr>
                    <td style={cell}>Owner</td>
                    <td style={cell}>{d.owner === null ? 'no owner() function' : d.ownerRenounced ? 'renounced' : short(d.owner)}</td>
                  </tr>
                  <tr>
                    <td style={cell}>Upgradeable</td>
                    <td style={cell}>{d.proxy ? `yes, proxy to ${short(d.proxy.implementation)}` : 'no proxy found'}</td>
                  </tr>
                  {d.market && (
                    <tr>
                      <td style={cell}>Market</td>
                      <td style={cell}>
                        liquidity {usd(d.market.liquidityUsd, 0)} · 24 h volume {usd(d.market.volume24h, 0)} · {d.market.pairs} pair(s)
                        {d.market.pairCreatedAt ? ` · since ${when(d.market.pairCreatedAt)}` : ''}
                      </td>
                    </tr>
                  )}
                  {d.holders && (
                    <tr>
                      <td style={cell}>Holders</td>
                      <td style={cell}>
                        {num(d.holders.count, 0)}
                        {d.holders.top10Pct !== null ? ` · top 10 hold ${num(d.holders.top10Pct, 1)}%` : ''}
                      </td>
                    </tr>
                  )}
                  {d.verified && (
                    <tr>
                      <td style={cell}>Source code (Blockscout)</td>
                      <td style={{ ...cell, whiteSpace: 'normal' }}>
                        {d.verified.verified ? (
                          <>
                            verified as <b>{d.verified.name ?? 'unnamed'}</b>
                            {d.verified.compiler ? ` · ${d.verified.compiler.replace(/\+commit.*$/, '')}` : ''}
                            {d.verified.license ? ` · license ${d.verified.license}` : ''}
                            {d.verified.proxyType ? ` · ${d.verified.proxyType} proxy` : ''}
                            {d.verified.implementations.length > 0 && ` · implementation ${d.verified.implementations.map((x) => x.name ?? short(x.address)).join(', ')}`}
                          </>
                        ) : (
                          <span style={{ color: 'var(--warn)' }}>not verified</span>
                        )}
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td style={cell}>Sourcify</td>
                    <td style={cell}>{d.sourcify ? <Ext href={d.sourcify.url}>{d.sourcify.match.replace(/_/g, ' ')} match</Ext> : 'no match'}</td>
                  </tr>
                  {d.reputation && d.reputation !== 'ok' && (
                    <tr>
                      <td style={cell}>Explorer reputation</td>
                      <td style={{ ...cell, color: 'var(--bad)' }}>{d.reputation}</td>
                    </tr>
                  )}
                </tbody>
              </table>
              {d.goplus && <GoPlus g={d.goplus} />}
              <h4>What the controller could do</h4>
              {d.flags.length ? (
                <ul className="ws-list">
                  {d.flags.map((f) => (
                    <li key={f.label}>
                      <span className="tag">{f.label}</span> {f.why} <span className="ws-muted">({f.found.join(', ')})</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ws-muted">No mint, pause, blacklist, fee, trading-switch or limit functions found in the bytecode.</p>
              )}
              {d.topHolders && d.topHolders.length > 0 && (
                <>
                  <h4>Top holders</h4>
                  <HolderList holders={d.topHolders} symbol={d.token?.symbol} />
                </>
              )}
              <p className="ws-muted">{d.note}</p>
              <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
            </>
          )
        }
      </Status>
    </Panel>
    </div>
  );
}

/** GoPlus token security: taxes, honeypot simulation and what the owner can do. */
function GoPlus({ g }: { g: I.GoPlusReport }) {
  // risk = true means a "yes" is bad; openSource is the other way round.
  const flag = (label: string, v: boolean | null, risk = true) => ({ label, v, bad: v === null ? null : risk ? v : !v });
  const items = [
    flag('Honeypot', g.honeypot),
    flag('Cannot sell all', g.cannotSellAll),
    flag('Can mint', g.mintable),
    flag('Owner can change balances', g.ownerCanChangeBalance),
    flag('Hidden owner', g.hiddenOwner),
    flag('Can take back ownership', g.canTakeBackOwnership),
    flag('Transfers pausable', g.transferPausable),
    flag('Blacklist', g.blacklist),
    flag('Source code open', g.openSource, false),
  ];
  const tax = (v: number | null) => (v === null ? '—' : `${num(v, 2)}%`);
  const box: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 10px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--line-c)', fontSize: 13.5, minWidth: 0 };
  return (
    <>
      <h4>GoPlus security scan</h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 8 }}>
        <div style={box}>
          <span>Buy tax · sell tax</span>
          <b style={{ color: (g.buyTax ?? 0) > 10 || (g.sellTax ?? 0) > 10 ? 'var(--bad)' : undefined }}>
            {tax(g.buyTax)} · {tax(g.sellTax)}
          </b>
        </div>
        <div style={box}>
          <span>LP locked</span>
          <b>{g.lpLockedPct === null ? '—' : `${num(g.lpLockedPct, 2)}%`}</b>
        </div>
        {items.map((x) => (
          <div key={x.label} style={box}>
            <span>{x.label}</span>
            <b style={{ color: x.bad === null ? 'var(--ink-3)' : x.bad ? 'var(--bad)' : 'var(--ok)' }}>{x.v === null ? 'unknown' : x.v ? 'yes' : 'no'}</b>
          </div>
        ))}
      </div>
      <p className="ws-muted">
        {g.holders !== null ? `GoPlus counts ${num(g.holders, 0)} holders. ` : ''}
        {g.creator ? <>Created by {short(g.creator)}. </> : ''}
        <Ext href={g.sourceUrl}>Full GoPlus report</Ext>. LP locked counts liquidity tokens in a known locker; Uniswap v4 positions are often not counted.
      </p>
    </>
  );
}

export function MovesTool() {
  const [addr, setAddr] = useState<string>(AGENTDOM_CA);
  const [hours, setHours] = useState(6);
  const [m, runM] = useRun<Awaited<ReturnType<typeof chainTools.moves>>>();
  const [h, runH] = useRun<Awaited<ReturnType<typeof chainTools.holders>>>();
  const go = (a = addr.trim(), hr = hours) => {
    if (!a) return;
    runM(chainTools.moves(a, hr));
    runH(chainTools.holders(a));
  };
  useEffect(() => {
    go();
  }, []);
  const name = (x: string | null, n: string | null) => (x ? n ?? short(x) : '—');
  return (
    <Panel title="Big moves and top holders" sub="The biggest transfers of a token in the last hours, with pools and lockers named, and who holds the most. Prefilled with $AGENTDOM; paste any token contract.">
      <form
        className="ws-row ws-wrap"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          go();
        }}
      >
        <input className="field ws-grow" style={{ flexBasis: 280 }} value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="SPL mint address…" maxLength={80} spellCheck={false} />
        <select
          className="field ws-sel"
          value={hours}
          onChange={(e) => {
            setHours(Number(e.target.value));
            go(addr.trim(), Number(e.target.value));
          }}
          aria-label="Time window"
        >
          <option value={1}>1 hour</option>
          <option value={6}>6 hours</option>
          <option value={24}>24 hours</option>
        </select>
        <button className="btn btn-seal" disabled={m.loading || !addr.trim()}>
          <Search size={15} /> Show
        </button>
      </form>
      <Status s={m} label="Reading transfers…">
        {(d) => (
          <>
            <p>
              <b>{d.token.symbol ?? short(d.token.address)}</b> {d.token.name && <span className="ws-muted">{d.token.name}</span>} · {num(d.transfers, 0)}
              {d.transfers >= 1000 ? '+' : ''} transfers in {d.hours} h{d.burned > 0 ? ` · ${compact(d.burned)} burned` : ''}
            </p>
            {d.biggest.length ? (
              <ul className="ws-list">
                {d.biggest.map((t, i) => (
                  <li key={t.hash + i}>
                    <b>{t.amount === null ? '—' : compact(t.amount)}</b> {t.asset ?? d.token.symbol} <span className="ws-muted">from</span> <Ext href={t.url.replace(/tx\/.*/, `address/${t.from}`)}>{name(t.from, t.fromName)}</Ext>{' '}
                    <span className="ws-muted">to</span> {t.to ? <Ext href={t.url.replace(/tx\/.*/, `address/${t.to}`)}>{name(t.to, t.toName)}</Ext> : '—'} {t.burn && <span className="tag">burn</span>}
                    <span className="ws-muted">
                      {' '}
                      · <Ext href={t.url}>{when(t.time)}</Ext>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ws-muted">No transfers of this token in the last {d.hours} h.</p>
            )}
            <p className="ws-muted">{d.note}</p>
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
      <Status s={h} label="Reading holders…">
        {(d) => (
          <>
            <h4>
              Top holders{d.holdersCount !== null ? <span className="ws-muted"> · {num(d.holdersCount, 0)} in total</span> : ''}
            </h4>
            {d.token.reputation && d.token.reputation !== 'ok' && <p style={{ color: 'var(--bad)' }}>The explorer marks this token as {d.token.reputation}.</p>}
            <HolderList holders={d.holders} symbol={d.token.symbol} limit={15} />
            <NotFinancial />
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

/** The Royal Mint workshop: market panels plus the chain tools, with Check wiring. */
export function MintWorkshop() {
  const [preset, setPreset] = useState<{ address: string; n: number } | null>(null);
  const check = (address: string) => setPreset((p) => ({ address, n: (p?.n ?? 0) + 1 }));
  return (
    <>
      <AgentdomVaultTool />
      <Markets.EconomyTool />
      <Markets.LaunchesTool onCheck={check} />
      <Markets.MarketsTool onCheck={check} />
      <ContractTool preset={preset} />
      <MovesTool />
      <TxTool />
      <AddressTool />
      <ChainPulseTool />
    </>
  );
}
