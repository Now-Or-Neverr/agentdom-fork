// Robinhood Chain (Ethereum L2, chain id 4663). Read-only: the public RPC for chain state,
// DexScreener for pairs and prices, GeckoTerminal for holder counts and token flags.
// Official stock tokens are recognised onchain: they implement uiMultiplier() (ERC-8056).
import { decodeAbiParameters, formatUnits, getAddress, hexToBigInt, isAddress, isHash, toFunctionSelector, type Hex } from 'viem';
import { fetchJson, qs, UpstreamError, type CallContext } from './http';
import { stockQuote } from './finnhub';

export const CHAIN = { id: 4663, name: 'Robinhood Chain', rpc: 'https://rpc.mainnet.chain.robinhood.com', explorer: 'https://robin.etherscan.io' };
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
  const r = await fetchJson<any>(CHAIN.rpc, {
    provider: RPC,
    ctx,
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId % 1000, method, params }),
    headers: { 'content-type': 'application/json' },
    ttlMs,
    timeoutMs: 15_000,
    logEndpoint: `robinhood-rpc:${method}`,
  });
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
  sourceUrl: string;
  fetchedAt: string;
}
export async function chainPulse(ctx: CallContext): Promise<ChainPulse> {
  const head = await rpc<Hex>('eth_blockNumber', [], ctx, 5_000);
  const n = Number(hexToBigInt(head.data));
  const nums = Array.from({ length: 8 }, (_, i) => n - i);
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

// ---------------- stock tokens ----------------
// Tickers to look for. Each candidate is checked onchain (uiMultiplier) before it is trusted.
export const STOCK_TICKERS = ['TSLA', 'NVDA', 'AAPL', 'AMZN', 'MSFT', 'GOOGL', 'META', 'COIN', 'HOOD', 'NFLX', 'AMD', 'PLTR', 'SPY', 'QQQ'];
const ROBINHOOD_SUFFIX = '• Robinhood Token';

export interface StockToken {
  ticker: string;
  name: string;
  address: string;
  multiplier: number;
  url: string;
}
let stockList: { at: number; list: StockToken[] } | null = null;
async function dexSearch(q: string, ctx: CallContext) {
  const r = await fetchJson<any>('https://api.dexscreener.com/latest/dex/search' + qs({ q }), { provider: DEX, ctx, ttlMs: 6 * 60 * 60_000 });
  return ((r.data?.pairs ?? []) as any[]).filter((p) => p.chainId === 'robinhood');
}
/** Official Robinhood stock tokens found on DexScreener and confirmed onchain. Refreshed every 6 hours. */
export async function stockTokenList(ctx: CallContext): Promise<StockToken[]> {
  if (stockList && Date.now() - stockList.at < 6 * 60 * 60_000) return stockList.list;
  const out: StockToken[] = [];
  for (const tk of STOCK_TICKERS) {
    // fakes often crowd out the real token in one query, so try a second, plainer one
    const pairs = [...(await dexSearch(`${tk} Robinhood Token`, ctx).catch(() => [])), ...(await dexSearch(`${tk} Robinhood`, ctx).catch(() => [])), ...(await dexSearch(tk, ctx).catch(() => []))];
    const cands = [...new Map(pairs.filter((p) => p.baseToken?.symbol === tk && String(p.baseToken?.name ?? '').includes(ROBINHOOD_SUFFIX)).map((p) => [p.baseToken.address.toLowerCase(), p])).values()];
    for (const p of cands) {
      const mult = await uiMultiplier(p.baseToken.address, ctx);
      if (mult !== null && mult > 0) {
        const a = getAddress(p.baseToken.address);
        out.push({ ticker: tk, name: String(p.baseToken.name).replace(ROBINHOOD_SUFFIX, '').trim(), address: a, multiplier: mult, url: tokenUrl(a) });
        break;
      }
    }
  }
  if (out.length) stockList = { at: Date.now(), list: out };
  return out;
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

export interface StockGap {
  ticker: string;
  name: string;
  address: string;
  url: string;
  multiplier: number;
  tokenPriceUsd: number | null;
  liquidityUsd: number | null;
  stockPrice: number | null;
  stockAsOf: string | null;
  fairTokenPrice: number | null;
  gapPct: number | null;
}
export interface StockBoard {
  tokens: StockGap[];
  note: string;
  sourceUrl: string;
  fetchedAt: string;
}
/** Each stock token's onchain price next to the real share price (Finnhub) times its multiplier. */
export async function stockBoard(ctx: CallContext, limit = 14): Promise<StockBoard> {
  const list = (await stockTokenList(ctx)).slice(0, limit);
  if (!list.length) throw new Error('No Robinhood stock tokens could be confirmed right now.');
  const r = await fetchJson<any>(`https://api.dexscreener.com/tokens/v1/robinhood/${list.map((t) => t.address).join(',')}`, { provider: DEX, ctx, ttlMs: 60_000 });
  const pairs: any[] = Array.isArray(r.data) ? r.data : [];
  const tokens: StockGap[] = [];
  for (const t of list) {
    const m = bestMarket(pairs.filter((p) => p.baseToken?.address?.toLowerCase() === t.address.toLowerCase()));
    const q = await stockQuote(t.ticker, ctx).catch(() => null);
    const fair = q?.price ? q.price * t.multiplier : null;
    tokens.push({
      ticker: t.ticker,
      name: t.name,
      address: t.address,
      url: t.url,
      multiplier: t.multiplier,
      tokenPriceUsd: m.priceUsd,
      liquidityUsd: m.liquidityUsd,
      stockPrice: q?.price ?? null,
      stockAsOf: q?.asOf ?? null,
      fairTokenPrice: fair,
      gapPct: fair && m.priceUsd ? Math.round(((m.priceUsd - fair) / fair) * 10000) / 100 : null,
    });
  }
  return {
    tokens,
    note: 'Token prices come from the most liquid DexScreener pair; share prices from Finnhub (may be delayed or from the last close when the market is shut). Gap = token price vs share price × multiplier. Not financial advice.',
    sourceUrl: 'https://dexscreener.com/robinhood',
    fetchedAt: r.fetchedAt,
  };
}

// ---------------- address ----------------
export interface AddressReport {
  address: string;
  kind: 'wallet' | 'contract';
  ethBalance: string;
  txCount: number;
  tokens: { symbol: string; name: string; address: string; balance: string; url: string }[];
  checkedTokens: number;
  note: string;
  sourceUrl: string;
  fetchedAt: string;
}
/** ETH balance, sent-transaction count, and balances of known tokens (no indexer: only these are checked). */
export async function inspectAddress(address: string, ctx: CallContext): Promise<AddressReport> {
  const a = checkAddress(address);
  const [bal, nonce, code, stocks] = await Promise.all([
    rpc<Hex>('eth_getBalance', [a, 'latest'], ctx, 30_000),
    rpc<Hex>('eth_getTransactionCount', [a, 'latest'], ctx, 30_000),
    rpc<Hex>('eth_getCode', [a, 'latest'], ctx, 5 * 60_000),
    stockTokenList(ctx).catch(() => [] as StockToken[]),
  ]);
  const known = [
    { symbol: 'AGENTDOM', name: 'Agentdom', address: getAddress(AGENTDOM_CA) },
    { symbol: 'WETH', name: 'Wrapped Ether', address: WETH },
    { symbol: 'USDG', name: 'Global Dollar', address: USDG },
    ...stocks.map((s) => ({ symbol: s.ticker, name: s.name, address: s.address })),
  ];
  const tokens = (
    await Promise.all(
      known.map(async (k) => {
        const [raw, meta] = await Promise.all([readUint(k.address, 'balanceOf(address)', ctx, encAddr(a), 30_000), tokenMeta(k.address, ctx).catch(() => null)]);
        if (!raw) return null;
        return { symbol: meta?.symbol ?? k.symbol, name: meta?.name ?? k.name, address: k.address, balance: formatUnits(raw, meta?.decimals ?? 18), url: tokenUrl(k.address) };
      }),
    )
  ).filter(Boolean) as AddressReport['tokens'];
  return {
    address: a,
    kind: code.data && code.data !== '0x' ? 'contract' : 'wallet',
    ethBalance: formatUnits(hexToBigInt(bal.data), 18),
    txCount: Number(hexToBigInt(nonce.data)),
    tokens,
    checkedTokens: known.length,
    note: 'Read straight from the chain. Only ETH and the listed tokens (AGENTDOM, WETH, USDG and confirmed stock tokens) are checked; other tokens are not shown.',
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
  stockToken: { multiplier: number } | null;
  flags: { label: string; why: string; found: string[] }[];
  market: Market | null;
  holders: { count: number; top10Pct: number | null } | null;
  honeypot: boolean | null;
  note: string;
  sourceUrl: string;
  fetchedAt: string;
}
export async function scanContract(address: string, ctx: CallContext): Promise<ContractReport> {
  const a = checkAddress(address);
  const code = await rpc<Hex>('eth_getCode', [a, 'latest'], ctx, 10 * 60_000);
  const isContract = !!code.data && code.data !== '0x';
  if (!isContract) {
    return { address: a, isContract, token: null, totalSupply: null, burned: null, owner: null, ownerRenounced: null, proxy: null, stockToken: null, flags: [], market: null, holders: null, honeypot: null, note: 'This address has no contract code: it is a wallet.', sourceUrl: addrUrl(a), fetchedAt: code.fetchedAt };
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
  const dec = meta?.decimals ?? 18;
  const flags = FLAGS.map((f) => ({ label: f.label, why: f.why, found: f.sigs.filter((s) => bytecode.includes(sel(s).slice(2))).map((s) => s.split('(')[0]) })).filter((f) => f.found.length);
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
    stockToken: mult !== null && mult > 0 ? { multiplier: mult } : null,
    flags,
    market: dex.length ? bestMarket(dex) : null,
    holders: g?.holders?.count ? { count: g.holders.count, top10Pct: g.holders.distribution_percentage?.top_10 ? Number(g.holders.distribution_percentage.top_10) : null } : null,
    honeypot: typeof g?.is_honeypot === 'boolean' ? g.is_honeypot : g?.is_honeypot === 'yes' ? true : g?.is_honeypot === 'no' ? false : null,
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
    holders: g?.holders?.count ?? null,
    top10Pct: g?.holders?.distribution_percentage?.top_10 ? Number(g.holders.distribution_percentage.top_10) : null,
    totalSupply: supply === null ? null : formatUnits(supply, 18),
    burned: formatUnits(burnedRaw, 18),
    burnedPct: supply ? Math.round((Number(burnedRaw * 1000000n / supply) / 10000) * 100) / 100 : null,
    pairUrl: m.url,
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
