// Workshop tools for the Royal Mint: read-only Robinhood Chain data. Every answer shows its
// source, an explorer link to verify it, and when it was fetched. Nothing here can send or sign.
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { AlertTriangle, Search } from 'lucide-react';
import { chainTools, num } from '../../lib/toolsApi';
import { Ext, Panel, Source, Status, useRun } from './shared';
import * as Markets from './MintMarkets';

const table: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const cell: CSSProperties = { padding: '5px 6px', borderBottom: '1px solid rgba(127,127,127,.2)', textAlign: 'left', whiteSpace: 'nowrap' };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const usd = (n: number | null, d = 2) => (n === null ? '—' : '$' + n.toLocaleString('en', { minimumFractionDigits: d, maximumFractionDigits: d }));
const amt = (s: string | null) => (s === null ? '—' : Number(s).toLocaleString('en', { maximumFractionDigits: Number(s) < 1 ? 8 : 2 }));
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export function NotFinancial() {
  return (
    <p className="ws-muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <AlertTriangle size={14} /> Read-only data from Robinhood Chain. Not financial advice.
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
    <Panel title="$AGENTDOM ledger" sub="The realm's own token, read live: holders from GeckoTerminal, price and liquidity from DexScreener, supply and burned amount from the chain.">
      <Status s={s} label="Reading the $AGENTDOM ledger…">
        {(d) => (
          <>
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
                    {d.priceUsd === null ? '—' : `$${d.priceUsd}`}
                    {d.change24h !== null ? ` · ${d.change24h > 0 ? '+' : ''}${d.change24h}% in 24 h` : ''}
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
    <Panel title="Robinhood Chain right now" sub="The latest blocks from the chain's public RPC: block time, transactions per block and gas.">
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
    <Panel title="Explain a transaction" sub="Paste a Robinhood Chain transaction hash. See who sent what to whom, which tokens moved, and what it cost.">
      <AddrForm value={hash} set={setHash} onGo={() => run(chainTools.tx(hash.trim()))} busy={s.loading} placeholder="0x… transaction hash" button="Explain" />
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
    <Panel title="Look up a wallet" sub="ETH balance, sent transactions, and balances of known tokens ($AGENTDOM, WETH, USDG and official stock tokens).">
      <AddrForm value={addr} set={setAddr} onGo={() => run(chainTools.address(addr.trim()))} busy={s.loading} placeholder="0x… address" button="Look up" />
      <Status s={s} label="Reading the address…">
        {(d) => (
          <>
            <p>
              <span className="tag">{d.kind}</span> <Ext href={d.sourceUrl}>{short(d.address)}</Ext> · {amt(d.ethBalance)} ETH · {num(d.txCount, 0)} sent transactions
            </p>
            {d.tokens.length ? (
              <ul className="ws-list">
                {d.tokens.map((t) => (
                  <li key={t.address}>
                    {amt(t.balance)} <Ext href={t.url}>{t.symbol}</Ext> <span className="ws-muted">{t.name}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ws-muted">None of the {d.checkedTokens} known tokens are held.</p>
            )}
            <p className="ws-muted">{d.note}</p>
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
      <AddrForm value={addr} set={setAddr} onGo={() => run(chainTools.contract(addr.trim()))} busy={s.loading} placeholder="0x… token contract" button="Check" />
      <Status s={s} label="Reading the contract…">
        {(d) =>
          !d.isContract ? (
            <p>{d.note}</p>
          ) : (
            <>
              <p>
                <Ext href={d.sourceUrl}>{d.token ? `${d.token.name ?? ''} (${d.token.symbol ?? '?'})` : short(d.address)}</Ext>
                {d.stockToken && <span className="tag">official Robinhood stock token</span>}
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
                </tbody>
              </table>
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

/** The Royal Mint workshop: market panels plus the chain tools, with Check wiring. */
export function MintWorkshop() {
  const [preset, setPreset] = useState<{ address: string; n: number } | null>(null);
  return (
    <>
      <AgentdomVaultTool />
      <Markets.StockBoardTool />
      <Markets.StockLookupTool />
      <Markets.MarketsTool onCheck={(address) => setPreset((p) => ({ address, n: (p?.n ?? 0) + 1 }))} />
      <ContractTool preset={preset} />
      <TxTool />
      <AddressTool />
      <Markets.ActionsTool />
      <Markets.OracleTool />
      <ChainPulseTool />
    </>
  );
}
