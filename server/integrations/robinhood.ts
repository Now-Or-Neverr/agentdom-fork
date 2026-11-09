// Robinhood Chain (Ethereum L2, chain id 4663). Read-only: the public RPC for chain state,
// DexScreener for pairs and prices, GeckoTerminal for holder counts and token flags.
// Official stock tokens are recognised onchain: they implement uiMultiplier() (ERC-8056).
import { decodeAbiParameters, formatUnits, getAddress, hexToBigInt, isAddress, isHash, toFunctionSelector, type Hex } from 'viem';
import { fetchJson, qs, UpstreamError, type CallContext } from './http';

export const CHAIN = { id: 4663, name: 'Robinhood Chain', rpc: 'https://rpc.mainnet.chain.robinhood.com', explorer: 'https://robin.etherscan.io' };
const ALCHEMY = 'alchemy';
export const alchemyOn = () => !!process.env.ALCHEMY_API_KEY;
const alchemyRpc = () => `https://robinhood-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
/** RPC endpoints in order: Alchemy (or ROBINHOOD_RPC_URL) first when configured, the public RPC as fallback. */
function endpoints(): { url: string; provider: string }[] {
  const list: { url: string; provider: string }[] = [];
  if (alchemyOn()) list.push({ url: alchemyRpc(), provider: ALCHEMY });
  if (process.env.CHAINSTACK_RPC_URL) list.push({ url: process.env.CHAINSTACK_RPC_URL, provider: 'chainstack' });
  if (process.env.ROBINHOOD_RPC_URL) list.push({ url: process.env.ROBINHOOD_RPC_URL, provider: RPC });
  list.push({ url: CHAIN.rpc, provider: RPC });
  return list;
}
/** POST one JSON-RPC body, falling back to the next endpoint on a network error, 429 or 5xx. */
async function rpcPost<T>(body: string, ctx: CallContext, ttlMs: number, label: string): Promise<{ data: T; fetchedAt: string }> {
  let last: unknown;
  for (const e of endpoints()) {
    try {
      return await fetchJson<T>(e.url, { provider: e.provider, ctx, method: 'POST', body, headers: { 'content-type': 'application/json' }, ttlMs, timeoutMs: 15_000, logEndpoint: `robinhood-rpc:${label}` });
    } catch (err) {
      last = err;
      if (!(err instanceof UpstreamError) || (err.status !== 0 && err.status !== 429 && err.status < 500)) throw err;
    }
  }
  throw last;
}
export const AGENTDOM_CA = '0x688d8c004af3c292330fea8af8a594adc8c3b0c8';
const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const DEAD = ['0x000000000000000000000000000000000000dEaD', '0x0000000000000000000000000000000000000000'];
const RPC = 'robinhoodrpc';
const DEX = 'dexscreener';
const GECKO = 'geckoterminal';

export const txUrl = (h: string) => `${CHAIN.explorer}/tx/${h}`;
export const addrUrl = (a: string) => `${CHAIN.explorer}/address/${a}`;
export const tokenUrl = (a: string) => `${CHAIN.explorer}/token/${a}`;
const blockUrl = (n: number) => `${CHAIN.explorer}/block/${n}`;

export function checkAddress(a: string): `0x${string}` {
  const s = a.trim();
  if (!isAddress(s, { strict: false })) throw new Error('That is not a valid address (0x followed by 40 hex characters).');
  return getAddress(s);
}
export function checkTxHash(h: string): Hex {
  const s = h.trim();
  if (!isHash(s)) throw new Error('That is not a valid transaction hash (0x followed by 64 hex characters).');
  return s as Hex;
}

// ---------------- JSON-RPC ----------------
let rpcId = 0;
async function rpc<T = any>(method: string, params: unknown[], ctx: CallContext, ttlMs = 0): Promise<{ data: T; fetchedAt: string }> {
  const r = await rpcPost<any>(JSON.stringify({ jsonrpc: '2.0', id: ++rpcId % 1000, method, params }), ctx, ttlMs, method);
  if (r.data?.error) throw new UpstreamError(RPC, 200, `Robinhood Chain RPC: ${r.data.error.message ?? 'error'}`);
  return { data: r.data?.result as T, fetchedAt: r.fetchedAt };
}
const sel = (sig: string) => toFunctionSelector(sig);
async function call(to: string, data: Hex, ctx: CallContext, ttlMs = 60_000): Promise<Hex | null> {
  try {
    const r = await rpc<Hex>('eth_call', [{ to, data }, 'latest'], ctx, ttlMs);
    return r.data && r.data !== '0x' ? r.data : null;
  } catch {
    return null; // a revert or a missing function is an answer, not a failure
  }
}
const encAddr = (a: string) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
async function readString(to: string, sig: string, ctx: CallContext): Promise<string | null> {
  const h = await call(to, sel(sig), ctx, 24 * 60 * 60_000);
  if (!h) return null;
  try {
    return decodeAbiParameters([{ type: 'string' }], h)[0];
  } catch {
    // some old tokens return bytes32
    const s = Buffer.from(h.slice(2, 66), 'hex').toString('utf8').replace(/\0+$/, '');
    return s || null;
  }
}
async function readUint(to: string, sig: string, ctx: CallContext, args = '', ttlMs = 60_000): Promise<bigint | null> {
  const h = await call(to, (sel(sig) + args) as Hex, ctx, ttlMs);
  if (!h || h.length < 66) return null;
  return hexToBigInt(h.slice(0, 66) as Hex);
}
async function readAddress(to: string, sig: string, ctx: CallContext): Promise<string | null> {
  const h = await call(to, sel(sig), ctx);
  if (!h || h.length < 66) return null;
  return getAddress('0x' + h.slice(26, 66));
}

export interface TokenMeta {
  address: string;
  name: string | null;
  symbol: string | null;
  decimals: number;
}
const metaCache = new Map<string, TokenMeta>();
export async function tokenMeta(address: string, ctx: CallContext): Promise<TokenMeta> {
  const a = checkAddress(address);
  const hit = metaCache.get(a);
  if (hit) return hit;
  const [name, symbol, dec] = await Promise.all([readString(a, 'name()', ctx), readString(a, 'symbol()', ctx), readUint(a, 'decimals()', ctx, '', 24 * 60 * 60_000)]);
  const m = { address: a, name, symbol, decimals: dec === null ? 18 : Number(dec) };
  if (name || symbol) metaCache.set(a, m);
  return m;
}

/** ERC-8056 scaled UI multiplier; only official Robinhood stock tokens have it. */
async function uiMultiplier(address: string, ctx: CallContext): Promise<number | null> {
  const v = await readUint(address, 'uiMultiplier()', ctx, '', 6 * 60 * 60_000);
  return v === null ? null : Number(formatUnits(v, 18));
}

// ---------------- chain pulse ----------------
export interface ChainPulse {
  latestBlock: number;
  blockTime: string;
  txInLatest: number;
  avgTxPerBlock: number;
  avgBlockSeconds: number | null;
  gasPriceGwei: number;
  baseFeeGwei: number | null;
  blocks: { number: number; time: string; txs: number; gasUsed: number; url: string }[];
  stats: ChainStats | null;
  sourceUrl: string;
  fetchedAt: string;
}
export async function chainPulse(ctx: CallContext): Promise<ChainPulse> {
  const head = await rpc<Hex>('eth_blockNumber', [], ctx, 5_000);
  const n = Number(hexToBigInt(head.data));
  const nums = Array.from({ length: 8 }, (_, i) => n - i);
  const statsP = chainStats(ctx).catch(() => null);
  const [gas, ...blocks] = await Promise.all([
    rpc<Hex>('eth_gasPrice', [], ctx, 5_000),
    ...nums.map((k) => rpc<any>('eth_getBlockByNumber', ['0x' + k.toString(16), false], ctx, 60_000)),
  ]);
  const bs = blocks.map((b) => b.data).filter(Boolean);
  const rows = bs.map((b: any) => ({
    number: Number(hexToBigInt(b.number)),
    time: new Date(Number(hexToBigInt(b.timestamp)) * 1000).toISOString(),
    txs: (b.transactions ?? []).length,
    gasUsed: Number(hexToBigInt(b.gasUsed)),
    url: blockUrl(Number(hexToBigInt(b.number))),
  }));
  const first = bs[bs.length - 1], last = bs[0];
  const span = first && last ? Number(hexToBigInt(last.timestamp) - hexToBigInt(first.timestamp)) : 0;
  return {
    latestBlock: n,
    blockTime: rows[0]?.time ?? new Date().toISOString(),
    txInLatest: rows[0]?.txs ?? 0,
    avgTxPerBlock: rows.length ? Math.round((rows.reduce((s, r) => s + r.txs, 0) / rows.length) * 10) / 10 : 0,
    avgBlockSeconds: rows.length > 1 && span > 0 ? Math.round((span / (rows.length - 1)) * 100) / 100 : null,
    gasPriceGwei: Number(formatUnits(hexToBigInt(gas.data), 9)),
    baseFeeGwei: last?.baseFeePerGas ? Number(formatUnits(hexToBigInt(last.baseFeePerGas), 9)) : null,
    blocks: rows,
    stats: await statsP,
    sourceUrl: blockUrl(n),
    fetchedAt: head.fetchedAt,
  };
}

// ---------------- transaction ----------------
const KNOWN_METHODS: Record<string, string> = Object.fromEntries(
  [
    'transfer(address,uint256)',
    'approve(address,uint256)',
    'transferFrom(address,address,uint256)',
    'deposit()',
    'withdraw(uint256)',
    'multicall(bytes[])',
    'multicall(uint256,bytes[])',
    'execute(bytes,bytes[],uint256)',
    'execute(bytes,bytes[])',
    'exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))',
    'exactInput((bytes,address,uint256,uint256))',
    'swapExactETHForTokens(uint256,address[],address,uint256)',
    'swapExactTokensForETH(uint256,uint256,address[],address,uint256)',
    'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)',
    'mint(address,uint256)',
    'burn(uint256)',
  ].map((s) => [sel(s), s.split('(')[0]]),
);
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export interface TxExplained {
  hash: string;
  status: 'success' | 'failed' | 'pending';
  block: number | null;
  time: string | null;
  from: string;
  to: string | null;
  contractCreated: string | null;
  method: string | null;
  valueEth: string;
  feeEth: string | null;
  tokenTransfers: { token: string; symbol: string | null; name: string | null; from: string; to: string; amount: string; burn: boolean; url: string }[];
  logCount: number;
  sourceUrl: string;
  fetchedAt: string;
}
export async function explainTx(hash: string, ctx: CallContext): Promise<TxExplained> {
  const h = checkTxHash(hash);
  const [tx, rc] = await Promise.all([rpc<any>('eth_getTransactionByHash', [h], ctx, 30_000), rpc<any>('eth_getTransactionReceipt', [h], ctx, 30_000)]);
  if (!tx.data) throw new Error('Robinhood Chain has no transaction with that hash.');
  const t = tx.data, r = rc.data;
  let time: string | null = null;
  if (t.blockNumber) {
    const b = await rpc<any>('eth_getBlockByNumber', [t.blockNumber, false], ctx, 24 * 60 * 60_000);
    if (b.data?.timestamp) time = new Date(Number(hexToBigInt(b.data.timestamp)) * 1000).toISOString();
  }
  const logs: any[] = r?.logs ?? [];
  const transfers = logs.filter((l) => l.topics?.[0] === TRANSFER_TOPIC && l.topics.length === 3).slice(0, 12);
  const tokenTransfers = await Promise.all(
    transfers.map(async (l) => {
      const m = await tokenMeta(l.address, ctx).catch(() => ({ address: l.address, name: null, symbol: null, decimals: 18 }));
      const to = getAddress('0x' + l.topics[2].slice(26));
      return {
        token: getAddress(l.address),
        symbol: m.symbol,
        name: m.name,
        from: getAddress('0x' + l.topics[1].slice(26)),
        to,
        amount: formatUnits(hexToBigInt(l.data === '0x' ? '0x0' : l.data), m.decimals),
        burn: DEAD.some((d) => d.toLowerCase() === to.toLowerCase()),
        url: tokenUrl(l.address),
      };
    }),
  );
  const price = r?.effectiveGasPrice ?? t.gasPrice;
  return {
    hash: h,
    status: !r ? 'pending' : r.status === '0x1' ? 'success' : 'failed',
    block: t.blockNumber ? Number(hexToBigInt(t.blockNumber)) : null,
    time,
    from: getAddress(t.from),
    to: t.to ? getAddress(t.to) : null,
    contractCreated: r?.contractAddress ? getAddress(r.contractAddress) : null,
    method: t.input && t.input.length >= 10 ? (KNOWN_METHODS[t.input.slice(0, 10)] ?? `unknown (${t.input.slice(0, 10)})`) : t.input === '0x' ? 'plain ETH transfer' : null,
    valueEth: formatUnits(hexToBigInt(t.value), 18),
    feeEth: r && price ? formatUnits(hexToBigInt(r.gasUsed) * hexToBigInt(price), 18) : null,
    tokenTransfers,
    logCount: logs.length,
    sourceUrl: txUrl(h),
    fetchedAt: tx.fetchedAt,
  };
}

// ---------------- stock tokens: Robinhood Stock Token API + Chainlink ----------------
// The official list, multipliers, quotes and corporate actions come from Robinhood's read-only
// Stock Token API (api.robinhood.com/rhj). Onchain prices come from Chainlink data feeds,
// read through the chain's RPC. DEX prices come from DexScreener.
const RH = 'robinhoodapi';
const CL = 'chainlink';
const RH_API = 'https://api.robinhood.com/rhj';
export const STOCK_TICKERS = ['TSLA', 'NVDA', 'AAPL', 'AMZN', 'MSFT', 'GOOGL', 'META', 'COIN', 'HOOD', 'NFLX', 'AMD', 'PLTR', 'SPY', 'QQQ'];

export interface StockToken {
  ticker: string;
  name: string;
  address: string;
  multiplier: number;
  pendingMultiplier: number | null;
  pendingAt: string | null;
  logo: string | null;
  tradable: boolean;
  url: string;
}
/** Every active Robinhood stock token on Robinhood Chain, from the official API (cached 1 hour). */
export async function stockTokenList(ctx: CallContext): Promise<StockToken[]> {
  const r = await fetchJson<any>(`${RH_API}/assets`, { provider: RH, ctx, ttlMs: 60 * 60_000, timeoutMs: 20_000 });
  const out: StockToken[] = [];
  for (const a of (r.data?.assets ?? []) as any[]) {
    const dep = (a.deployments ?? []).find((d: any) => d.chainId === CHAIN.id);
    if (!dep || a.status !== 'ASSET_STATUS_ACTIVE') continue;
    const addr = getAddress(dep.contractAddress);
    out.push({
      ticker: String(a.tokenSymbol),
      name: String(a.tokenName ?? a.tokenSymbol).replace(/\s*•\s*Robinhood Token\s*$/, ''),
      address: addr,
      multiplier: Number(a.currentMultiplier) || 1,
      pendingMultiplier: a.pendingMultiplier ? Number(a.pendingMultiplier) : null,
      pendingAt: a.pendingMultiplierEffectiveTime ?? null,
      logo: a.logoUrl ?? null,
      tradable: a.tradingCapabilities?.market?.whole === 'TRADING_STATUS_TRADABLE',
      url: tokenUrl(addr),
    });
  }
  return out;
}
async function findStock(symbolOrAddress: string, ctx: CallContext): Promise<StockToken | null> {
  const s = symbolOrAddress.trim();
  const list = await stockTokenList(ctx);
  if (isAddress(s, { strict: false })) return list.find((t) => t.address.toLowerCase() === s.toLowerCase()) ?? null;
  return list.find((t) => t.ticker.toUpperCase() === s.toUpperCase()) ?? null;
}

export interface StockQuoteRh {
  bid: number;
  ask: number;
  mid: number;
  tokenBid: number | null;
  tokenAsk: number | null;
  volume: number | null;
  high: number | null;
  low: number | null;
  halted: boolean;
  mintBurnUsd: number | null;
  generatedAt: string;
}
const n = (x: unknown) => (x === undefined || x === null || x === '' ? null : Number.isFinite(Number(x)) ? Number(x) : null);
/** Live underlying bid/ask (not multiplier-adjusted) and token bid/ask, cached 15 s by Robinhood. */
async function rhQuote(symbol: string, ctx: CallContext): Promise<StockQuoteRh | null> {
  const r = await fetchJson<any>(`${RH_API}/prices/${encodeURIComponent(symbol)}`, { provider: RH, ctx, ttlMs: 15_000 });
  const q = (r.data?.quotes ?? [])[0];
  if (!q || !q.bid) return null;
  const bid = Number(q.bid), ask = Number(q.ask);
  return {
    bid,
    ask,
    mid: (bid + ask) / 2,
    tokenBid: n(q.tokenBid),
    tokenAsk: n(q.tokenAsk),
    volume: n(q.dailyTradingVolume) || null,
    high: n(q.dailyHigh),
    low: n(q.dailyLow),
    halted: !!q.isTradingHalt,
    mintBurnUsd: n(q.mintBurnUsdVolume),
    generatedAt: String(q.generatedAt ?? r.fetchedAt),
  };
}

// ---- RPC batch (one HTTP request for many eth_calls) ----
async function rpcBatch(calls: { to: string; data: string }[], ctx: CallContext, ttlMs = 30_000): Promise<(Hex | null)[]> {
  const out: (Hex | null)[] = [];
  for (let i = 0; i < calls.length; i += alchemyOn() ? 100 : 30) {
    const chunk = calls.slice(i, i + (alchemyOn() ? 100 : 30));
    const r = await rpcPost<any[]>(JSON.stringify(chunk.map((c, k) => ({ jsonrpc: '2.0', id: k, method: 'eth_call', params: [{ to: c.to, data: c.data }, 'latest'] }))), ctx, ttlMs, `eth_call x${chunk.length}`);
    const byId = new Map(((Array.isArray(r.data) ? r.data : []) as any[]).map((x) => [x.id, x.result && x.result !== '0x' ? (x.result as Hex) : null]));
    chunk.forEach((_, k) => out.push(byId.get(k) ?? null));
  }
  return out;
}

// ---- Chainlink ----
interface Feed {
  name: string;
  proxy: string;
  decimals: number;
  heartbeat: number;
  kind: 'stock' | 'crypto' | 'other';
  symbol: string | null;
}
async function clFeeds(ctx: CallContext): Promise<Feed[]> {
  const r = await fetchJson<any[]>('https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json', { provider: CL, ctx, ttlMs: 6 * 60 * 60_000, timeoutMs: 20_000 });
  return ((Array.isArray(r.data) ? r.data : []) as any[])
    .filter((f) => f.proxyAddress && f.name)
    .map((f) => {
      const name = String(f.name);
      const stock = /^Robinhood\s+([A-Z.]+)/.exec(name);
      const crypto = !stock ? /^([A-Z0-9.]+)\s*\/\s*USD/.exec(name) : null;
      return {
        name,
        proxy: getAddress(f.proxyAddress),
        decimals: Number(f.decimals ?? 8),
        heartbeat: Number(f.heartbeat ?? 86400),
        kind: stock ? 'stock' : crypto ? 'crypto' : 'other',
        symbol: stock?.[1] ?? crypto?.[1] ?? null,
      } as Feed;
    });
}
/** The Chainlink feed for a stock symbol, preferring the 24/7 feed. */
function feedFor(feeds: Feed[], symbol: string): Feed | null {
  const s = symbol.toUpperCase();
  const mine = feeds.filter((f) => f.kind === 'stock' && f.symbol === s);
  return mine.find((f) => /24\/7/.test(f.name)) ?? mine[0] ?? null;
}
function decodeRound(h: Hex | null, decimals: number): { price: number; updatedAt: string } | null {
  if (!h || h.length < 2 + 64 * 4) return null;
  const word = (i: number) => ('0x' + h.slice(2 + 64 * i, 2 + 64 * (i + 1))) as Hex;
  const answer = hexToBigInt(word(1));
  const updated = Number(hexToBigInt(word(3)));
  if (answer <= 0n || !updated) return null;
  return { price: Number(formatUnits(answer, decimals)), updatedAt: new Date(updated * 1000).toISOString() };
}
const LATEST_ROUND = '0xfeaf968c';

export interface OracleRow {
  name: string;
  kind: 'stock' | 'crypto' | 'other';
  symbol: string | null;
  price: number | null;
  updatedAt: string | null;
  url: string;
}
export interface OracleBoard {
  feeds: OracleRow[];
  total: number;
  note: string;
  sourceUrl: string;
  fetchedAt: string;
}
/** Chainlink prices on Robinhood Chain, read onchain (latestRoundData). */
export async function oraclePrices(ctx: CallContext, kind: 'crypto' | 'stock' | 'all' = 'all', limit = 40): Promise<OracleBoard> {
  const all = await clFeeds(ctx);
  const feeds = all.filter((f) => kind === 'all' || f.kind === kind).slice(0, limit);
  const res = await rpcBatch(feeds.map((f) => ({ to: f.proxy, data: LATEST_ROUND })), ctx);
  return {
    feeds: feeds.map((f, i) => {
      const d = decodeRound(res[i], f.decimals);
      return { name: f.name, kind: f.kind, symbol: f.symbol, price: d?.price ?? null, updatedAt: d?.updatedAt ?? null, url: addrUrl(f.proxy) };
    }),
    total: all.length,
    note: 'Read onchain from Chainlink data feed proxies on Robinhood Chain. Stock feeds marked 24/7 keep updating outside market hours.',
    sourceUrl: 'https://docs.chain.link/data-feeds/price-feeds/addresses?network=robinhood',
    fetchedAt: new Date().toISOString(),
  };
}

export interface Market {
  priceUsd: number | null;
  liquidityUsd: number | null;
  volume24h: number | null;
  txns24h: { buys: number; sells: number } | null;
  change24h: number | null;
  fdv: number | null;
  pairs: number;
  dex: string | null;
  pairCreatedAt: string | null;
  url: string | null;
}
function bestMarket(pairs: any[]): Market {
  const sorted = [...pairs].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  const p = sorted[0];
  if (!p) return { priceUsd: null, liquidityUsd: null, volume24h: null, txns24h: null, change24h: null, fdv: null, pairs: 0, dex: null, pairCreatedAt: null, url: null };
  return {
    priceUsd: p.priceUsd ? Number(p.priceUsd) : null,
    liquidityUsd: p.liquidity?.usd ?? null,
    volume24h: pairs.reduce((s, x) => s + (x.volume?.h24 ?? 0), 0),
    txns24h: p.txns?.h24 ?? null,
    change24h: p.priceChange?.h24 ?? null,
    fdv: p.fdv ?? null,
    pairs: pairs.length,
    dex: p.dexId ?? null,
    pairCreatedAt: p.pairCreatedAt ? new Date(p.pairCreatedAt).toISOString() : null,
    url: p.url ?? null,
  };
}
async function dexToken(address: string, ctx: CallContext, ttlMs = 60_000): Promise<any[]> {
  const r = await fetchJson<any>(`https://api.dexscreener.com/tokens/v1/robinhood/${address}`, { provider: DEX, ctx, ttlMs });
  return Array.isArray(r.data) ? r.data : [];
}
async function dexTokens(addresses: string[], ctx: CallContext): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < addresses.length; i += 30) {
    const r = await fetchJson<any>(`https://api.dexscreener.com/tokens/v1/robinhood/${addresses.slice(i, i + 30).join(',')}`, { provider: DEX, ctx, ttlMs: 60_000 }).catch(() => null);
    if (Array.isArray(r?.data)) out.push(...r.data);
  }
  return out;
}

export interface StockGap {
  ticker: string;
  name: string;
  address: string;
  url: string;
  logo: string | null;
  multiplier: number;
  wallStreetBid: number | null;
  wallStreetAsk: number | null;
  fairTokenPrice: number | null;
  robinhoodTokenBid: number | null;
  robinhoodTokenAsk: number | null;
  oraclePrice: number | null;
  oracleUpdatedAt: string | null;
  tokenPriceUsd: number | null;
  liquidityUsd: number | null;
  gapPct: number | null;
  halted: boolean;
  quotedAt: string | null;
  // kept for older clients
  stockPrice: number | null;
  stockAsOf: string | null;
}
export interface StockBoard {
  tokens: StockGap[];
  listed: number;
  note: string;
  sourceUrl: string;
  fetchedAt: string;
}
const pct = (a: number | null, b: number | null) => (a !== null && b ? Math.round(((a - b) / b) * 10000) / 100 : null);

async function gapsFor(list: StockToken[], ctx: CallContext): Promise<StockGap[]> {
  const [feeds, pairs, quotes] = await Promise.all([
    clFeeds(ctx).catch(() => [] as Feed[]),
    dexTokens(list.map((t) => t.address), ctx),
    Promise.all(list.map((t) => rhQuote(t.ticker, ctx).catch(() => null))),
  ]);
  const myFeeds = list.map((t) => feedFor(feeds, t.ticker));
  const rounds = await rpcBatch(myFeeds.map((f) => ({ to: f?.proxy ?? CHAIN.explorer, data: LATEST_ROUND })).filter((_, i) => myFeeds[i]), ctx).catch(() => []);
  let k = 0;
  return list.map((t, i) => {
    const q = quotes[i];
    const f = myFeeds[i];
    const o = f ? decodeRound(rounds[k++] ?? null, f.decimals) : null;
    const m = bestMarket(pairs.filter((p) => p.baseToken?.address?.toLowerCase() === t.address.toLowerCase()));
    const fair = q ? q.mid * t.multiplier : null;
    return {
      ticker: t.ticker,
      name: t.name,
      address: t.address,
      url: t.url,
      logo: t.logo,
      multiplier: t.multiplier,
      wallStreetBid: q?.bid ?? null,
      wallStreetAsk: q?.ask ?? null,
      fairTokenPrice: fair,
      robinhoodTokenBid: q?.tokenBid ?? null,
      robinhoodTokenAsk: q?.tokenAsk ?? null,
      oraclePrice: o?.price ?? null,
      oracleUpdatedAt: o?.updatedAt ?? null,
      tokenPriceUsd: m.priceUsd,
      liquidityUsd: m.liquidityUsd,
      gapPct: pct(m.priceUsd, fair),
      halted: q?.halted ?? false,
      quotedAt: q?.generatedAt ?? null,
      stockPrice: q?.mid ?? null,
      stockAsOf: q?.generatedAt ?? null,
    };
  });
}

/** Stock tokens next to Wall Street (Robinhood quote × multiplier), the Chainlink oracle and the DEX price. */
export async function stockBoard(ctx: CallContext, symbols: string[] = STOCK_TICKERS): Promise<StockBoard> {
  const all = await stockTokenList(ctx);
  const want = symbols.map((s) => s.toUpperCase());
  const list = want.map((s) => all.find((t) => t.ticker === s)).filter(Boolean) as StockToken[];
  if (!list.length) throw new Error('None of those symbols is a Robinhood stock token.');
  return {
    tokens: await gapsFor(list, ctx),
    listed: all.length,
    note: 'Wall Street = Robinhood’s live underlying bid/ask; fair token price = mid × the token’s multiplier. Oracle = Chainlink feed onchain. DEX = most liquid DexScreener pair. Gap = DEX vs fair. Not financial advice.',
    sourceUrl: 'https://docs.robinhood.com/chain/stock-token-apis',
    fetchedAt: new Date().toISOString(),
  };
}

export interface CorporateAction {
  symbol: string;
  type: string;
  status: 'in progress' | 'completed' | string;
  date: string;
  detail: string;
  address: string | null;
  url: string | null;
}
const ACTION_NAMES: Record<string, string> = {
  CORPORATE_ACTION_TYPE_CASH_DIVIDEND: 'Cash dividend',
  CORPORATE_ACTION_TYPE_FORWARD_SPLIT: 'Stock split',
  CORPORATE_ACTION_TYPE_REVERSE_SPLIT: 'Reverse split',
  CORPORATE_ACTION_TYPE_STOCK_DIVIDEND: 'Stock dividend',
};
function actionDetail(d: any): string {
  if (!d || typeof d !== 'object') return '';
  const [k, v] = Object.entries(d)[0] ?? [];
  const x = v as any;
  if (k === 'cashDividend') return `$${x.rate} per share`;
  if (k === 'forwardSplit' || k === 'reverseSplit') return `${x.newRate}-for-${x.oldRate}`;
  if (k === 'stockDividend') return `${x.rate ?? ''} shares per share`.trim();
  return k ? k.replace(/([A-Z])/g, ' $1').toLowerCase() : '';
}
/** Dividends and splits that Robinhood processed for its stock tokens, newest first (cached 1 hour). */
export async function corporateActions(ctx: CallContext, symbol?: string, limit = 30): Promise<{ actions: CorporateAction[]; sourceUrl: string; fetchedAt: string }> {
  const r = await fetchJson<any>(`${RH_API}/corporate-actions`, { provider: RH, ctx, ttlMs: 60 * 60_000, timeoutMs: 20_000 });
  const s = symbol?.toUpperCase();
  const actions = ((r.data?.corpActions ?? []) as any[])
    .filter((a) => !s || a.tokenSymbol === s)
    .map((a) => {
      const dep = (a.deployments ?? []).find((d: any) => d.chainId === CHAIN.id);
      const p = a.processDate ?? {};
      return {
        symbol: String(a.tokenSymbol),
        type: ACTION_NAMES[a.type] ?? String(a.type).replace('CORPORATE_ACTION_TYPE_', '').replace(/_/g, ' ').toLowerCase(),
        status: a.status === 'CORPORATE_ACTION_STATUS_COMPLETED' ? 'completed' : a.status === 'CORPORATE_ACTION_STATUS_IN_PROGRESS' ? 'in progress' : String(a.status),
        date: p.year ? `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}` : '',
        detail: actionDetail(a.details),
        address: dep ? getAddress(dep.contractAddress) : null,
        url: dep ? tokenUrl(dep.contractAddress) : null,
      };
    })
    .slice(0, limit);
  return { actions, sourceUrl: 'https://docs.robinhood.com/chain/stock-token-apis', fetchedAt: r.fetchedAt };
}

export interface StockDetail extends StockGap {
  pendingMultiplier: number | null;
  pendingAt: string | null;
  tradable: boolean;
  dailyHigh: number | null;
  dailyLow: number | null;
  volume: number | null;
  mintBurnUsd: number | null;
  supply: string | null;
  actions: CorporateAction[];
  sourceUrl: string;
  fetchedAt: string;
}
/** Everything about one stock token: quote, oracle, DEX, supply onchain, pending multiplier, dividends and splits. */
export async function stockDetail(symbolOrAddress: string, ctx: CallContext): Promise<StockDetail> {
  const t = await findStock(symbolOrAddress, ctx);
  if (!t) throw new Error(`“${symbolOrAddress}” is not a Robinhood stock token on Robinhood Chain.`);
  const [[g], q, supply, acts] = await Promise.all([
    gapsFor([t], ctx),
    rhQuote(t.ticker, ctx).catch(() => null),
    readUint(t.address, 'totalSupply()', ctx),
    corporateActions(ctx, t.ticker, 10).catch(() => ({ actions: [] as CorporateAction[] })),
  ]);
  return {
    ...g,
    pendingMultiplier: t.pendingMultiplier,
    pendingAt: t.pendingAt,
    tradable: t.tradable,
    dailyHigh: q?.high ?? null,
    dailyLow: q?.low ?? null,
    volume: q?.volume ?? null,
    mintBurnUsd: q?.mintBurnUsd ?? null,
    supply: supply === null ? null : formatUnits(supply, 18),
    actions: acts.actions,
    sourceUrl: t.url,
    fetchedAt: new Date().toISOString(),
  };
}

// ---- GeckoTerminal: what is trading on Robinhood Chain ----
export interface PoolRow {
  name: string;
  dex: string;
  token: string | null;
  priceUsd: number | null;
  liquidityUsd: number | null;
  volume24h: number | null;
  change24h: number | null;
  txns24h: number | null;
  createdAt: string | null;
  url: string;
}
function pools(data: any[]): PoolRow[] {
  return data.map((p) => {
    const a = p.attributes ?? {};
    const base = String(p.relationships?.base_token?.data?.id ?? '').replace(/^robinhood_/, '');
    const tx = a.transactions?.h24;
    return {
      name: String(a.name ?? ''),
      dex: String(p.relationships?.dex?.data?.id ?? '').replace(/-robinhood$/, '').replace(/[-_]/g, ' '),
      token: base && isAddress(base, { strict: false }) ? getAddress(base) : null,
      priceUsd: n(a.base_token_price_usd),
      liquidityUsd: n(a.reserve_in_usd),
      volume24h: n(a.volume_usd?.h24),
      change24h: n(a.price_change_percentage?.h24),
      txns24h: tx ? (tx.buys ?? 0) + (tx.sells ?? 0) : null,
      createdAt: a.pool_created_at ?? null,
      url: `https://www.geckoterminal.com/robinhood/pools/${a.address}`,
    };
  });
}
export interface MarketPulse {
  trending: PoolRow[];
  newest: PoolRow[];
  dexCount: number | null;
  note: string;
  sourceUrl: string;
  fetchedAt: string;
}
export async function marketPulse(ctx: CallContext, limit = 10): Promise<MarketPulse> {
  const g = (path: string, ttlMs: number) => fetchJson<any>(`https://api.geckoterminal.com/api/v2/networks/robinhood/${path}`, { provider: GECKO, ctx, ttlMs });
  const [t, nw, dx] = await Promise.all([g('trending_pools?page=1', 5 * 60_000), g('new_pools?page=1', 2 * 60_000), g('dexes?page=1', 6 * 60 * 60_000).catch(() => null)]);
  return {
    trending: pools(t.data?.data ?? []).slice(0, limit),
    newest: pools(nw.data?.data ?? []).slice(0, limit),
    dexCount: Array.isArray(dx?.data?.data) ? dx!.data.data.length : null,
    note: 'What is trading on Robinhood Chain right now, from GeckoTerminal. Listing here is not an endorsement: check a token’s contract before you touch it. Not financial advice.',
    sourceUrl: 'https://www.geckoterminal.com/robinhood/pools',
    fetchedAt: t.fetchedAt,
  };
}

// ---------------- address ----------------
export interface AddressReport {
  address: string;
  kind: 'wallet' | 'contract';
  ethBalance: string;
  txCount: number;
  tokens: { symbol: string; name: string; address: string; balance: string; valueUsd: number | null; url: string; flagged?: boolean }[];
  checkedTokens: number;
  allTokens: boolean;
  recent: TxRow[];
  activity: { transactions: number | null; tokenTransfers: number | null } | null;
  note: string;
  sourceUrl: string;
  fetchedAt: string;
}
/** ETH balance, sent-transaction count, and balances of every official stock token plus AGENTDOM, WETH and USDG. */
export async function inspectAddress(address: string, ctx: CallContext): Promise<AddressReport> {
  const a = checkAddress(address);
  const [bal, nonce, code, stocks] = await Promise.all([
    rpc<Hex>('eth_getBalance', [a, 'latest'], ctx, 30_000),
    rpc<Hex>('eth_getTransactionCount', [a, 'latest'], ctx, 30_000),
    rpc<Hex>('eth_getCode', [a, 'latest'], ctx, 5 * 60_000),
    stockTokenList(ctx).catch(() => [] as StockToken[]),
  ]);
  const known = [
    { symbol: 'AGENTDOM', name: 'Agentdom', address: getAddress(AGENTDOM_CA), decimals: 18, stock: false },
    { symbol: 'WETH', name: 'Wrapped Ether', address: WETH, decimals: 18, stock: false },
    { symbol: 'USDG', name: 'Global Dollar', address: USDG, decimals: 6, stock: false },
    ...stocks.map((s) => ({ symbol: s.ticker, name: s.name, address: s.address, decimals: 18, stock: true })),
  ];
  const value = async (sym: string, balance: string, isStock: boolean) => {
    if (isStock) {
      const q = await rhQuote(sym, ctx).catch(() => null);
      return q?.tokenBid ? Math.round(Number(balance) * q.tokenBid * 100) / 100 : null;
    }
    return sym === 'USDG' ? Math.round(Number(balance) * 100) / 100 : null;
  };
  const stockSet = new Set(stocks.map((s) => s.address.toLowerCase()));
  const act = blockscoutOn() ? await walletActivity(a, ctx).catch(() => null) : null;
  let tokens: AddressReport['tokens'];
  let allTokens = false;
  if (act && act.balances.length) {
    // Blockscout knows every token the address holds.
    allTokens = true;
    const erc20 = act.balances.filter((b) => b.token?.type === 'ERC-20' && BigInt(b.value ?? '0') > 0n).slice(0, 40);
    tokens = await Promise.all(
      erc20.map(async (b) => {
        const addr = getAddress(b.token.address_hash);
        const isStock = stockSet.has(addr.toLowerCase());
        const balance = formatUnits(BigInt(b.value), Number(b.token.decimals ?? 18));
        return {
          symbol: String(b.token.symbol ?? '?'),
          name: String(b.token.name ?? '').replace(/\s*•\s*Robinhood Token\s*$/, ''),
          address: addr,
          balance,
          valueUsd: await value(String(b.token.symbol ?? ''), balance, isStock),
          url: tokenUrl(addr),
          flagged: b.token.reputation === 'scam' || b.token.reputation === 'spam',
        };
      }),
    );
  } else {
    const usdg = await tokenMeta(USDG, ctx).catch(() => null);
    if (usdg) known[2].decimals = usdg.decimals;
    const raws = await rpcBatch(known.map((k) => ({ to: k.address, data: sel('balanceOf(address)') + encAddr(a) })), ctx);
    const held = known.map((k, i) => ({ k, raw: raws[i] ? hexToBigInt(raws[i]!.slice(0, 66) as Hex) : 0n })).filter((x) => x.raw > 0n);
    tokens = await Promise.all(
      held.map(async ({ k, raw }) => {
        const balance = formatUnits(raw, k.decimals);
        return { symbol: k.symbol, name: k.name, address: k.address, balance, valueUsd: await value(k.symbol, balance, k.stock), url: tokenUrl(k.address) };
      }),
    );
  }
  return {
    address: a,
    kind: code.data && code.data !== '0x' ? 'contract' : 'wallet',
    ethBalance: formatUnits(hexToBigInt(bal.data), 18),
    txCount: Number(hexToBigInt(nonce.data)),
    tokens,
    checkedTokens: allTokens ? tokens.length : known.length,
    allTokens,
    recent: act?.recent ?? [],
    activity: act ? { transactions: act.transactions, tokenTransfers: act.tokenTransfers } : null,
    note: allTokens
      ? 'Balances of every ERC-20 token the address holds and its recent transactions (Blockscout), ETH and counts from the chain. Stock values use Robinhood’s live token bid.'
      : `Read straight from the chain. ETH, AGENTDOM, WETH, USDG and all ${stocks.length} official stock tokens are checked; other tokens are not shown. Stock values use Robinhood’s live token bid.`,
    sourceUrl: addrUrl(a),
    fetchedAt: bal.fetchedAt,
  };
}

// ---------------- contract check ----------------
// Function selectors whose presence in bytecode is worth flagging. A match means the
// function exists, not that it is abused; the report says so.
const FLAGS: { label: string; why: string; sigs: string[] }[] = [
  { label: 'Can mint new tokens', why: 'The supply can be increased after launch.', sigs: ['mint(address,uint256)', 'mint(uint256)', 'mintTo(address,uint256)'] },
  { label: 'Can pause transfers', why: 'Transfers can be stopped by the controller.', sigs: ['pause()', 'setPaused(bool)'] },
  { label: 'Has a blacklist', why: 'Specific wallets can be blocked from moving tokens.', sigs: ['blacklist(address)', 'addToBlacklist(address)', 'setBlacklist(address,bool)', 'blacklistAddress(address,bool)', 'setBots(address[],bool)', 'addBots(address[])'] },
  { label: 'Fees can be changed', why: 'Buy or sell taxes can be raised after launch.', sigs: ['setFee(uint256)', 'setFees(uint256,uint256)', 'setTaxFee(uint256)', 'setBuyFee(uint256)', 'setSellFee(uint256)', 'updateFees(uint256,uint256)', 'setTaxes(uint256,uint256)'] },
  { label: 'Trading switch', why: 'Trading can be turned on or off by the controller.', sigs: ['enableTrading()', 'openTrading()', 'setTradingEnabled(bool)', 'setTrading(bool)'] },
  { label: 'Limits can be changed', why: 'Max transaction or wallet size can be changed.', sigs: ['setMaxTxAmount(uint256)', 'setMaxWalletSize(uint256)', 'setMaxTx(uint256)', 'setMaxWallet(uint256)', 'removeLimits()'] },
];
const IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'; // EIP-1967

export interface ContractReport {
  address: string;
  isContract: boolean;
  token: TokenMeta | null;
  totalSupply: string | null;
  burned: string | null;
  owner: string | null;
  ownerRenounced: boolean | null;
  proxy: { implementation: string } | null;
  stockToken: { multiplier: number; symbol: string | null; listedByRobinhood: boolean } | null;
  flags: { label: string; why: string; found: string[] }[];
  market: Market | null;
  holders: { count: number; top10Pct: number | null } | null;
  honeypot: boolean | null;
  verified: VerifiedSource | null;
  reputation: string | null;
  topHolders: HolderRow[] | null;
  note: string;
  sourceUrl: string;
  fetchedAt: string;
}
export async function scanContract(address: string, ctx: CallContext): Promise<ContractReport> {
  const a = checkAddress(address);
  const code = await rpc<Hex>('eth_getCode', [a, 'latest'], ctx, 10 * 60_000);
  const isContract = !!code.data && code.data !== '0x';
  if (!isContract) {
    return { address: a, isContract, token: null, totalSupply: null, burned: null, owner: null, ownerRenounced: null, proxy: null, stockToken: null, flags: [], market: null, holders: null, honeypot: null, verified: null, reputation: null, topHolders: null, note: 'This address has no contract code: it is a wallet.', sourceUrl: addrUrl(a), fetchedAt: code.fetchedAt };
  }
  let bytecode = code.data.toLowerCase();
  const slot = await rpc<Hex>('eth_getStorageAt', [a, IMPL_SLOT, 'latest'], ctx, 10 * 60_000).catch(() => null);
  let proxy: ContractReport['proxy'] = null;
  if (slot?.data && hexToBigInt(slot.data) !== 0n) {
    const impl = getAddress('0x' + slot.data.slice(26));
    proxy = { implementation: impl };
    const ic = await rpc<Hex>('eth_getCode', [impl, 'latest'], ctx, 10 * 60_000).catch(() => null);
    if (ic?.data) bytecode += ic.data.toLowerCase();
  }
  const [meta, supply, owner, mult, deadBal, zeroBal, dex, gecko] = await Promise.all([
    tokenMeta(a, ctx).catch(() => null),
    readUint(a, 'totalSupply()', ctx),
    readAddress(a, 'owner()', ctx),
    uiMultiplier(a, ctx),
    readUint(a, 'balanceOf(address)', ctx, encAddr(DEAD[0])),
    readUint(a, 'balanceOf(address)', ctx, encAddr(DEAD[1])),
    dexToken(a, ctx).catch(() => []),
    fetchJson<any>(`https://api.geckoterminal.com/api/v2/networks/robinhood/tokens/${a}/info`, { provider: GECKO, ctx, ttlMs: 10 * 60_000, okStatuses: [404] }).catch(() => null),
  ]);
  const official = (await stockTokenList(ctx).catch(() => [] as StockToken[])).find((t) => t.address.toLowerCase() === a.toLowerCase());
  const dec = meta?.decimals ?? 18;
  const flags = FLAGS.map((f) => ({ label: f.label, why: f.why, found: f.sigs.filter((s) => bytecode.includes(sel(s).slice(2))).map((s) => s.split('(')[0]) })).filter((f) => f.found.length);
  const [vs, th] = await Promise.all([verifiedSource(a, ctx).catch(() => null), blockscoutOn() && meta && (meta.name || meta.symbol) ? tokenHolders(a, ctx, 10).catch(() => null) : Promise.resolve(null)]);
  const g = gecko?.data?.data?.attributes;
  const renounced = owner === null ? null : DEAD.some((d) => d.toLowerCase() === owner.toLowerCase());
  return {
    address: a,
    isContract,
    token: meta && (meta.name || meta.symbol) ? meta : null,
    totalSupply: supply === null ? null : formatUnits(supply, dec),
    burned: deadBal === null && zeroBal === null ? null : formatUnits((deadBal ?? 0n) + (zeroBal ?? 0n), dec),
    owner,
    ownerRenounced: renounced,
    proxy,
    stockToken: official ? { multiplier: official.multiplier, symbol: official.ticker, listedByRobinhood: true } : mult !== null && mult > 0 ? { multiplier: mult, symbol: null, listedByRobinhood: false } : null,
    flags,
    market: dex.length ? bestMarket(dex) : null,
    holders: th?.holdersCount ? { count: th.holdersCount, top10Pct: th.holders.length ? Math.round(th.holders.slice(0, 10).reduce((t, x) => t + (x.pct ?? 0), 0) * 100) / 100 : null } : g?.holders?.count ? { count: g.holders.count, top10Pct: g.holders.distribution_percentage?.top_10 ? Number(g.holders.distribution_percentage.top_10) : null } : null,
    honeypot: typeof g?.is_honeypot === 'boolean' ? g.is_honeypot : g?.is_honeypot === 'yes' ? true : g?.is_honeypot === 'no' ? false : null,
    verified: vs,
    reputation: th?.token.reputation ?? null,
    topHolders: th?.holders ?? null,
    note: 'A function being present is not proof of abuse: it shows what the controller could do. If the owner is renounced, owner-only functions can no longer be used. Read-only check, not financial advice.',
    sourceUrl: addrUrl(a),
    fetchedAt: code.fetchedAt,
  };
}

// ---------------- $AGENTDOM ----------------
export interface AgentdomStats {
  address: string;
  priceUsd: number | null;
  change24h: number | null;
  liquidityUsd: number | null;
  volume24h: number | null;
  fdv: number | null;
  txns24h: { buys: number; sells: number } | null;
  holders: number | null;
  top10Pct: number | null;
  totalSupply: string | null;
  burned: string | null;
  burnedPct: number | null;
  pairUrl: string | null;
  topHolders: HolderRow[] | null;
  sourceUrl: string;
  fetchedAt: string;
}
export async function agentdomStats(ctx: CallContext): Promise<AgentdomStats> {
  const a = getAddress(AGENTDOM_CA);
  const [dex, gecko, supply, dead, zero] = await Promise.all([
    dexToken(a, ctx, 60_000),
    fetchJson<any>(`https://api.geckoterminal.com/api/v2/networks/robinhood/tokens/${a}/info`, { provider: GECKO, ctx, ttlMs: 10 * 60_000 }).catch(() => null),
    readUint(a, 'totalSupply()', ctx),
    readUint(a, 'balanceOf(address)', ctx, encAddr(DEAD[0])),
    readUint(a, 'balanceOf(address)', ctx, encAddr(DEAD[1])),
  ]);
  const th = blockscoutOn() ? await tokenHolders(a, ctx, 10).catch(() => null) : null;
  const m = bestMarket(dex);
  const g = gecko?.data?.data?.attributes;
  const burnedRaw = (dead ?? 0n) + (zero ?? 0n);
  return {
    address: a,
    priceUsd: m.priceUsd,
    change24h: m.change24h,
    liquidityUsd: m.liquidityUsd,
    volume24h: m.volume24h,
    fdv: m.fdv,
    txns24h: m.txns24h,
    holders: th?.holdersCount ?? g?.holders?.count ?? null,
    top10Pct: g?.holders?.distribution_percentage?.top_10 ? Number(g.holders.distribution_percentage.top_10) : null,
    totalSupply: supply === null ? null : formatUnits(supply, 18),
    burned: formatUnits(burnedRaw, 18),
    burnedPct: supply ? Math.round((Number(burnedRaw * 1000000n / supply) / 10000) * 100) / 100 : null,
    pairUrl: m.url,
    topHolders: th?.holders ?? null,
    sourceUrl: tokenUrl(a),
    fetchedAt: new Date().toISOString(),
  };
}

/** A raw 18-decimal amount as a readable number string. */
export const formatTokens = (raw: string | bigint) => formatUnits(BigInt(raw), 18);

/** Raw token balance for a holder (used by holder perks). */
export async function tokenBalance(token: string, holder: string, ctx: CallContext): Promise<bigint> {
  const v = await readUint(checkAddress(token), 'balanceOf(address)', ctx, encAddr(checkAddress(holder)), 30_000);
  return v ?? 0n;
}

// ---------------- Blockscout (keyed explorer API) ----------------
// Wallet history, all token balances, token holders with names, verified contracts and chain
// stats. Optional: everything above still works without BLOCKSCOUT_API_KEY.
const BS = 'blockscout';
export const blockscoutOn = () => !!process.env.BLOCKSCOUT_API_KEY;
async function bs<T = any>(path: string, ctx: CallContext, ttlMs = 60_000): Promise<{ data: T; fetchedAt: string }> {
  const sep = path.includes('?') ? '&' : '?';
  return fetchJson<T>(`https://api.blockscout.com/${CHAIN.id}/api/v2${path}${sep}apikey=${encodeURIComponent(process.env.BLOCKSCOUT_API_KEY ?? '')}`, { provider: BS, ctx, ttlMs, timeoutMs: 15_000, okStatuses: [404] });
}

export interface TxRow {
  hash: string;
  time: string | null;
  method: string | null;
  from: string | null;
  to: string | null;
  toName: string | null;
  ok: boolean;
  valueEth: string;
  feeEth: string | null;
  url: string;
}
const txRow = (t: any): TxRow => ({
  hash: t.hash,
  time: t.timestamp ?? null,
  method: t.method ?? (t.transaction_types?.includes('coin_transfer') ? 'ETH transfer' : null),
  from: t.from?.hash ?? null,
  to: t.to?.hash ?? t.created_contract?.hash ?? null,
  toName: t.to?.name ?? null,
  ok: t.status === 'ok',
  valueEth: formatUnits(BigInt(t.value ?? '0'), 18),
  feeEth: t.fee?.value ? formatUnits(BigInt(t.fee.value), 18) : null,
  url: txUrl(t.hash),
});

export interface HolderRow {
  address: string;
  name: string | null;
  isContract: boolean;
  balance: string;
  pct: number | null;
  url: string;
}
export interface TokenHolders {
  token: { address: string; name: string | null; symbol: string | null; type: string | null; reputation: string | null };
  holdersCount: number | null;
  totalSupply: string | null;
  holders: HolderRow[];
  sourceUrl: string;
  fetchedAt: string;
}
/** Top holders of any token on Robinhood Chain, with explorer names (pools, lockers, exchanges). */
export async function tokenHolders(address: string, ctx: CallContext, limit = 15): Promise<TokenHolders> {
  if (!blockscoutOn()) throw new Error('Token holders need BLOCKSCOUT_API_KEY on this server.');
  const a = checkAddress(address);
  const [info, h] = await Promise.all([bs<any>(`/tokens/${a}`, ctx, 10 * 60_000), bs<any>(`/tokens/${a}/holders`, ctx, 5 * 60_000)]);
  if (!info.data?.address_hash) throw new Error('Blockscout knows no token at that address.');
  const dec = Number(info.data.decimals ?? 18);
  const supply = info.data.total_supply ? BigInt(info.data.total_supply) : null;
  const holders = ((h.data?.items ?? []) as any[]).slice(0, limit).map((x) => {
    const raw = BigInt(x.value ?? '0');
    return {
      address: getAddress(x.address.hash),
      name: x.address.name ?? (x.address.metadata?.tags ?? [])[0]?.name ?? null,
      isContract: !!x.address.is_contract,
      balance: formatUnits(raw, dec),
      pct: supply ? Math.round(Number((raw * 1_000_000n) / supply) / 100) / 100 : null,
      url: addrUrl(x.address.hash),
    };
  });
  return {
    token: { address: a, name: info.data.name ?? null, symbol: info.data.symbol ?? null, type: info.data.type ?? null, reputation: info.data.reputation ?? null },
    holdersCount: info.data.holders_count ? Number(info.data.holders_count) : null,
    totalSupply: supply === null ? null : formatUnits(supply, dec),
    holders,
    sourceUrl: tokenUrl(a),
    fetchedAt: h.fetchedAt,
  };
}

export interface ChainStats {
  totalTransactions: number | null;
  totalAddresses: number | null;
  transactionsToday: number | null;
  avgBlockMs: number | null;
  gas: { slow: number; average: number; fast: number } | null;
}
export async function chainStats(ctx: CallContext): Promise<ChainStats | null> {
  if (!blockscoutOn()) return null;
  const r = await bs<any>('/stats', ctx, 60_000);
  const d = r.data ?? {};
  return {
    totalTransactions: n(d.total_transactions),
    totalAddresses: n(d.total_addresses),
    transactionsToday: n(d.transactions_today),
    avgBlockMs: n(d.average_block_time),
    gas: d.gas_prices ? { slow: Number(d.gas_prices.slow), average: Number(d.gas_prices.average), fast: Number(d.gas_prices.fast) } : null,
  };
}

export interface VerifiedSource {
  verified: boolean;
  name: string | null;
  compiler: string | null;
  language: string | null;
  license: string | null;
  verifiedAt: string | null;
  proxyType: string | null;
  implementations: { address: string; name: string | null }[];
}
async function verifiedSource(address: string, ctx: CallContext): Promise<VerifiedSource | null> {
  if (!blockscoutOn()) return null;
  const r = await bs<any>(`/smart-contracts/${address}`, ctx, 30 * 60_000);
  const d = r.data;
  if (!d || d.message) return { verified: false, name: null, compiler: null, language: null, license: null, verifiedAt: null, proxyType: null, implementations: [] };
  return {
    verified: !!d.is_verified,
    name: d.name ?? null,
    compiler: d.compiler_version ?? null,
    language: d.language ?? null,
    license: d.license_type ?? null,
    verifiedAt: d.verified_at ?? null,
    proxyType: d.proxy_type ?? null,
    implementations: ((d.implementations ?? []) as any[]).map((x) => ({ address: getAddress(x.address_hash ?? x.address), name: x.name ?? null })),
  };
}

/** Recent transactions and counters of an address (Blockscout). */
async function walletActivity(address: string, ctx: CallContext) {
  const [txs, counters, balances] = await Promise.all([
    bs<any>(`/addresses/${address}/transactions`, ctx, 60_000).catch(() => null),
    bs<any>(`/addresses/${address}/counters`, ctx, 60_000).catch(() => null),
    bs<any>(`/addresses/${address}/token-balances`, ctx, 60_000).catch(() => null),
  ]);
  return {
    recent: ((txs?.data?.items ?? []) as any[]).slice(0, 12).map(txRow),
    transactions: n(counters?.data?.transactions_count),
    tokenTransfers: n(counters?.data?.token_transfers_count),
    balances: (Array.isArray(balances?.data) ? balances!.data : []) as any[],
  };
}

// ---------------- Alchemy enhanced APIs ----------------
// Transfers (in and out, with times), token prices by address and NFTs. Optional (ALCHEMY_API_KEY).
async function alchemy<T = any>(method: string, params: unknown[], ctx: CallContext, ttlMs = 30_000): Promise<T> {
  if (!alchemyOn()) throw new Error('This needs ALCHEMY_API_KEY on this server.');
  const r = await fetchJson<any>(alchemyRpc(), {
    provider: ALCHEMY,
    ctx,
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    headers: { 'content-type': 'application/json' },
    ttlMs,
    timeoutMs: 20_000,
    logEndpoint: `alchemy:${method}`,
  });
  if (r.data?.error) throw new UpstreamError(ALCHEMY, 200, `Alchemy: ${r.data.error.message ?? 'error'}`);
  return r.data?.result as T;
}

export interface TransferRow {
  hash: string;
  time: string | null;
  direction: 'in' | 'out' | 'self';
  asset: string | null;
  amount: number | null;
  token: string | null;
  from: string;
  to: string | null;
  category: string;
  burn: boolean;
  url: string;
}
const tRow = (t: any, me?: string): TransferRow => {
  const from = getAddress(t.from);
  const to = t.to ? getAddress(t.to) : null;
  const m = me?.toLowerCase();
  return {
    hash: t.hash,
    time: t.metadata?.blockTimestamp ?? null,
    direction: m && from.toLowerCase() === m && to?.toLowerCase() === m ? 'self' : m && from.toLowerCase() === m ? 'out' : 'in',
    asset: t.asset ?? null,
    amount: typeof t.value === 'number' ? t.value : null,
    token: t.rawContract?.address ? getAddress(t.rawContract.address) : null,
    from,
    to,
    category: String(t.category ?? ''),
    burn: !!to && DEAD.some((d) => d.toLowerCase() === to.toLowerCase()),
    url: txUrl(t.hash),
  };
};

/** The last transfers in and out of an address: ETH, ERC-20, NFTs (Alchemy Transfers API). */
export async function walletTransfers(address: string, ctx: CallContext, limit = 15): Promise<TransferRow[]> {
  const a = checkAddress(address);
  const base = { category: ['external', 'erc20', 'erc721', 'erc1155'], withMetadata: true, excludeZeroValue: true, order: 'desc', maxCount: '0x' + limit.toString(16) };
  const [out, inn] = await Promise.all([alchemy<any>('alchemy_getAssetTransfers', [{ ...base, fromAddress: a }], ctx), alchemy<any>('alchemy_getAssetTransfers', [{ ...base, toAddress: a }], ctx)]);
  const all = [...(out?.transfers ?? []), ...(inn?.transfers ?? [])].map((t) => tRow(t, a));
  const seen = new Set<string>();
  return all
    .filter((t) => {
      const k = `${t.hash}:${t.direction}:${t.asset}:${t.amount}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((x, y) => (y.time ?? '').localeCompare(x.time ?? ''))
    .slice(0, limit);
}

export interface TokenMoves {
  token: { address: string; symbol: string | null; name: string | null };
  hours: number;
  transfers: number;
  biggest: (TransferRow & { fromName: string | null; toName: string | null })[];
  burned: number;
  note: string;
  sourceUrl: string;
  fetchedAt: string;
}
/** The biggest transfers of one token in the last few hours (Alchemy Transfers API, names from Blockscout). */
export async function tokenMoves(address: string, ctx: CallContext, hours = 6, top = 12): Promise<TokenMoves> {
  const a = checkAddress(address);
  const head = await rpc<Hex>('eth_blockNumber', [], ctx, 5_000);
  const latest = Number(hexToBigInt(head.data));
  // ~0.1 s blocks: 36,000 blocks an hour
  const from = Math.max(0, latest - Math.round(hours * 36_000));
  const [meta, res] = await Promise.all([
    tokenMeta(a, ctx).catch(() => null),
    alchemy<any>('alchemy_getAssetTransfers', [{ contractAddresses: [a], category: ['erc20'], fromBlock: '0x' + from.toString(16), toBlock: 'latest', withMetadata: true, order: 'desc', maxCount: '0x3e8' }], ctx, 60_000),
  ]);
  const rows = ((res?.transfers ?? []) as any[]).map((t) => tRow(t));
  const biggest = [...rows].sort((x, y) => (y.amount ?? 0) - (x.amount ?? 0)).slice(0, top);
  const names = new Map<string, string | null>();
  if (blockscoutOn()) {
    const addrs = [...new Set(biggest.flatMap((t) => [t.from, t.to].filter(Boolean) as string[]))].slice(0, 16);
    await Promise.all(
      addrs.map(async (x) => {
        const r = await bs<any>(`/addresses/${x}`, ctx, 6 * 60 * 60_000).catch(() => null);
        names.set(x, r?.data?.name ?? (r?.data?.metadata?.tags ?? [])[0]?.name ?? null);
      }),
    );
  }
  return {
    token: { address: a, symbol: meta?.symbol ?? null, name: meta?.name ?? null },
    hours,
    transfers: rows.length,
    biggest: biggest.map((t) => ({ ...t, fromName: names.get(t.from) ?? null, toName: t.to ? (names.get(t.to) ?? null) : null })),
    burned: rows.filter((t) => t.burn).reduce((s, t) => s + (t.amount ?? 0), 0),
    note: `Transfers of this token in the last ${hours} h (up to 1,000), biggest first. Pools and lockers are named where the explorer knows them.`,
    sourceUrl: tokenUrl(a),
    fetchedAt: head.fetchedAt,
  };
}

/** USD prices by token address (Alchemy Prices API). Missing prices are left out. */
export async function tokenPrices(addresses: string[], ctx: CallContext): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!alchemyOn() || !addresses.length) return out;
  for (let i = 0; i < addresses.length; i += 25) {
    const r = await fetchJson<any>(`https://api.g.alchemy.com/prices/v1/${process.env.ALCHEMY_API_KEY}/tokens/by-address`, {
      provider: ALCHEMY,
      ctx,
      method: 'POST',
      body: JSON.stringify({ addresses: addresses.slice(i, i + 25).map((address) => ({ network: 'robinhood-mainnet', address })) }),
      headers: { 'content-type': 'application/json' },
      ttlMs: 60_000,
      logEndpoint: 'alchemy:prices/tokens/by-address',
    }).catch(() => null);
    for (const d of (r?.data?.data ?? []) as any[]) {
      const v = Number(d.prices?.[0]?.value);
      if (Number.isFinite(v) && v > 0) out.set(String(d.address).toLowerCase(), v);
    }
  }
  return out;
}

export interface NftRow {
  name: string;
  collection: string | null;
  contract: string;
  tokenId: string;
  image: string | null;
}
/** NFTs an address holds on Robinhood Chain (Alchemy NFT API). */
export async function walletNfts(address: string, ctx: CallContext, limit = 8): Promise<{ total: number; items: NftRow[] }> {
  const a = checkAddress(address);
  const r = await fetchJson<any>(`https://robinhood-mainnet.g.alchemy.com/nft/v3/${process.env.ALCHEMY_API_KEY}/getNFTsForOwner?owner=${a}&pageSize=${limit}&withMetadata=true`, {
    provider: ALCHEMY,
    ctx,
    ttlMs: 5 * 60_000,
    logEndpoint: 'alchemy:nft/getNFTsForOwner',
  });
  return {
    total: Number(r.data?.totalCount ?? 0),
    items: ((r.data?.ownedNfts ?? []) as any[]).map((x) => ({
      name: String(x.name ?? x.contract?.name ?? `#${x.tokenId}`),
      collection: x.contract?.name ?? x.collection?.name ?? null,
      contract: getAddress(x.contract.address),
      tokenId: String(x.tokenId),
      image: x.image?.thumbnailUrl ?? x.image?.cachedUrl ?? null,
    })),
  };
}
