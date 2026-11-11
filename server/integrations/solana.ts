// Solana mainnet, read-only: RPC, DexScreener / GeckoTerminal, holder perks.
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN } from '../../shared/brand';
import { fetchJson, type CallContext } from './http';
import type {
  AddressReport,
  AgentdomStats,
  ChainEconomy,
  ChainPulse,
  ChainStats,
  ContractReport,
  CorporateAction,
  Launch,
  MarketPulse,
  OracleBoard,
  PoolRow,
  StockBoard,
  StockDetail,
  TokenChart,
  TokenHolders,
  TokenMoves,
  TxExplained,
} from './robinhood';

export const CHAIN = {
  id: 'solana-mainnet',
  name: 'Solana',
  rpc: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  explorer: TOKEN.explorer,
};
export const AGENTDOM_CA = TOKEN.mint;
export const STOCK_TICKERS: string[] = [];

const DEX = 'dexscreener';
const GECKO = 'geckoterminal';
const TOKEN_DECIMALS = Number(process.env.TOKEN_DECIMALS) || TOKEN.decimals;

let conn: Connection | null = null;
function connection(): Connection {
  if (!conn) conn = new Connection(CHAIN.rpc, 'confirmed');
  return conn;
}

const base58Re = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export function checkAddress(a: string): string {
  const s = a.trim();
  if (!base58Re.test(s)) throw new Error('That is not a valid Solana address (base58, 32–44 characters).');
  try {
    return new PublicKey(s).toBase58();
  } catch {
    throw new Error('That is not a valid Solana address.');
  }
}
export function checkTxHash(h: string): string {
  const s = h.trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{80,100}$/.test(s)) throw new Error('That is not a valid transaction signature (base58, typically 87–88 characters).');
  return s;
}

export const txUrl = (h: string) => `${CHAIN.explorer}/tx/${h}`;
export const addrUrl = (a: string) => `${CHAIN.explorer}/account/${a}`;
export const tokenUrl = (a: string) => `${CHAIN.explorer}/token/${a}`;

export const formatTokens = (raw: string | bigint) => {
  const v = BigInt(raw);
  const d = 10n ** BigInt(TOKEN_DECIMALS);
  const whole = v / d;
  const frac = v % d;
  if (frac === 0n) return whole.toString();
  const f = frac.toString().padStart(TOKEN_DECIMALS, '0').replace(/0+$/, '');
  return `${whole}.${f}`;
};

async function gt(path: string, ctx: CallContext, ttlMs: number) {
  return fetchJson<any>(`https://api.geckoterminal.com/api/v2/networks/solana/${path}`, { provider: GECKO, ctx, ttlMs });
}

function bestDexPair(pairs: any[] | undefined) {
  const list = (pairs ?? []).filter((p) => p.chainId === 'solana' || !p.chainId);
  list.sort((a, b) => (Number(b.liquidity?.usd) || 0) - (Number(a.liquidity?.usd) || 0));
  const p = list[0];
  if (!p) return { priceUsd: null, change24h: null, liquidityUsd: null, volume24h: null, fdv: null, txns24h: null, url: null };
  return {
    priceUsd: p.priceUsd ? Number(p.priceUsd) : null,
    change24h: p.priceChange?.h24 !== undefined ? Number(p.priceChange.h24) : null,
    liquidityUsd: p.liquidity?.usd ? Number(p.liquidity.usd) : null,
    volume24h: p.volume?.h24 ? Number(p.volume.h24) : null,
    fdv: p.fdv ? Number(p.fdv) : null,
    txns24h: p.txns?.h24 ? { buys: Number(p.txns.h24.buys ?? 0), sells: Number(p.txns.h24.sells ?? 0) } : null,
    url: p.url ?? null,
  };
}

export async function chainStats(_ctx: CallContext): Promise<ChainStats | null> {
  return null;
}

export async function chainPulse(ctx: CallContext): Promise<ChainPulse> {
  const c = connection();
  const slot = await c.getSlot('confirmed');
  const slotNum = Number(slot);
  const block = await c.getBlock(slot, { maxSupportedTransactionVersion: 0, transactionDetails: 'signatures' });
  const time = block?.blockTime ? new Date(Number(block.blockTime) * 1000).toISOString() : new Date().toISOString();
  const txs = block?.signatures?.length ?? 0;
  const blocks: ChainPulse['blocks'] = [];
  for (let i = 0; i < 6; i++) {
    const s = slotNum - i;
    try {
      const b = await c.getBlock(s, { maxSupportedTransactionVersion: 0, transactionDetails: 'signatures' });
      blocks.push({
        number: s,
        time: b?.blockTime ? new Date(Number(b.blockTime) * 1000).toISOString() : time,
        txs: b?.signatures?.length ?? 0,
        gasUsed: 0,
        url: `${CHAIN.explorer}/block/${s}`,
      });
    } catch {
      break;
    }
  }
  const fetchedAt = new Date().toISOString();
  return {
    latestBlock: slotNum,
    blockTime: time,
    txInLatest: txs,
    avgTxPerBlock: blocks.length ? Math.round(blocks.reduce((t, b) => t + b.txs, 0) / blocks.length) : txs,
    avgBlockSeconds: 0.4,
    gasPriceGwei: 0,
    baseFeeGwei: null,
    blocks,
    stats: null,
    sourceUrl: CHAIN.explorer,
    fetchedAt,
  };
}

export async function explainTx(hash: string, _ctx: CallContext): Promise<TxExplained> {
  const sig = checkTxHash(hash);
  const c = connection();
  const tx = await c.getParsedTransaction(sig, { maxSupportedTransactionVersion: 0 });
  if (!tx) throw new Error('Solana has no confirmed transaction with that signature.');
  const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58());
  const err = tx.meta?.err;
  const feeLamports = Number(tx.meta?.fee ?? 0);
  return {
    hash: sig,
    status: err ? 'failed' : 'success',
    block: tx.slot != null ? Number(tx.slot) : null,
    time: tx.blockTime ? new Date(Number(tx.blockTime) * 1000).toISOString() : null,
    from: keys[0] ?? '',
    to: keys[1] ?? null,
    contractCreated: null,
    method: tx.meta?.logMessages?.[0]?.slice(0, 120) ?? 'Solana transaction',
    valueEth: '0',
    feeEth: feeLamports ? `${feeLamports / LAMPORTS_PER_SOL} SOL` : null,
    tokenTransfers: [],
    logCount: tx.meta?.logMessages?.length ?? 0,
    sourceUrl: txUrl(sig),
    fetchedAt: new Date().toISOString(),
  };
}

export async function inspectAddress(address: string, _ctx: CallContext): Promise<AddressReport> {
  const a = checkAddress(address);
  const c = connection();
  const [lamports, accounts] = await Promise.all([
    c.getBalance(new PublicKey(a)),
    c.getParsedTokenAccountsByOwner(new PublicKey(a), { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }),
  ]);
  const tokens = accounts.value.map((acc) => {
    const info = acc.account.data.parsed?.info;
    const amount = info?.tokenAmount;
    const mint = String(info?.mint ?? '');
    return {
      symbol: mint === AGENTDOM_CA ? TOKEN.ticker : mint.slice(0, 4),
      name: mint === AGENTDOM_CA ? 'Agentdom' : 'SPL token',
      address: mint,
      balance: amount?.uiAmountString ?? '0',
      valueUsd: null,
      url: tokenUrl(mint),
    };
  });
  const fetchedAt = new Date().toISOString();
  return {
    address: a,
    kind: 'wallet',
    ethBalance: `${Number(lamports) / LAMPORTS_PER_SOL} SOL`,
    txCount: 0,
    tokens,
    checkedTokens: tokens.length,
    allTokens: false,
    recent: [],
    activity: null,
    transfers: [],
    nfts: null,
    portfolio: null,
    note: 'SOL balance and SPL token accounts from Solana RPC.',
    sourceUrl: addrUrl(a),
    fetchedAt,
  };
}

export async function scanContract(address: string, _ctx: CallContext): Promise<ContractReport> {
  const a = checkAddress(address);
  const supply = await connection().getTokenSupply(new PublicKey(a));
  const fetchedAt = new Date().toISOString();
  return {
    address: a,
    isContract: true,
    token: { address: a, name: null, symbol: null, decimals: supply.value.decimals },
    totalSupply: supply.value.uiAmountString,
    burned: null,
    owner: null,
    ownerRenounced: null,
    proxy: null,
    stockToken: null,
    flags: [],
    market: null,
    holders: null,
    honeypot: null,
    verified: null,
    reputation: null,
    topHolders: null,
    goplus: null,
    sourcify: null,
    note: 'SPL mint supply from Solana RPC. For trading stats use DexScreener or the $AGENTDOM ledger tool.',
    sourceUrl: tokenUrl(a),
    fetchedAt,
  };
}

export async function agentdomStats(ctx: CallContext): Promise<AgentdomStats> {
  const mint = AGENTDOM_CA;
  const [dexR, supplyR, geckoR] = await Promise.all([
    fetchJson<any>(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, { provider: DEX, ctx, ttlMs: 60_000 }),
    connection().getTokenSupply(new PublicKey(mint)).catch(() => null),
    gt(`tokens/${mint}/info`, ctx, 10 * 60_000).catch(() => null),
  ]);
  const m = bestDexPair(dexR.data?.pairs);
  const g = geckoR?.data?.data?.attributes;
  const fetchedAt = new Date().toISOString();
  return {
    address: mint,
    priceUsd: m.priceUsd,
    change24h: m.change24h,
    liquidityUsd: m.liquidityUsd,
    volume24h: m.volume24h,
    fdv: m.fdv,
    txns24h: m.txns24h,
    holders: g?.holders?.count ? Number(g.holders.count) : null,
    top10Pct: g?.holders?.distribution_percentage?.top_10 ? Number(g.holders.distribution_percentage.top_10) : null,
    totalSupply: supplyR?.value.uiAmountString ?? null,
    burned: null,
    burnedPct: null,
    pairUrl: m.url,
    topHolders: null,
    chart: null,
    sourceUrl: tokenUrl(mint),
    fetchedAt,
  };
}

export async function tokenBalance(token: string, holder: string, _ctx: CallContext): Promise<bigint> {
  const owner = new PublicKey(checkAddress(holder));
  const mint = new PublicKey(checkAddress(token));
  const resp = await connection().getParsedTokenAccountsByOwner(owner, { mint });
  let sum = 0n;
  for (const acc of resp.value) {
    const amt = acc.account.data.parsed?.info?.tokenAmount?.amount;
    if (amt) sum += BigInt(amt);
  }
  return sum;
}

export function verifySolanaMessage(message: string, signatureB58: string, address: string): boolean {
  try {
    const msg = new TextEncoder().encode(message);
    const sig = bs58.decode(signatureB58);
    const pk = new PublicKey(checkAddress(address)).toBytes();
    return nacl.sign.detached.verify(msg, sig, pk);
  } catch {
    return false;
  }
}

export const blockscoutOn = () => false;
export const codexOn = () => false;
export const alchemyOn = () => !!process.env.HELIUS_API_KEY;

export async function tokenHolders(address: string, ctx: CallContext, _limit = 20): Promise<TokenHolders> {
  const a = checkAddress(address);
  const gecko = await gt(`tokens/${a}/info`, ctx, 5 * 60_000).catch(() => null);
  const g = gecko?.data?.data?.attributes;
  const fetchedAt = new Date().toISOString();
  return {
    token: { address: a, symbol: g?.symbol ?? null, name: g?.name ?? null, type: 'SPL', reputation: null },
    holdersCount: g?.holders?.count ? Number(g.holders.count) : null,
    totalSupply: null,
    holders: [],
    sourceUrl: tokenUrl(a),
    fetchedAt,
  };
}

export async function tokenMoves(address: string, ctx: CallContext, hours = 6, _top = 12): Promise<TokenMoves> {
  const a = checkAddress(address);
  const meta = await gt(`tokens/${a}/info`, ctx, 5 * 60_000).catch(() => null);
  const sym = meta?.data?.data?.attributes?.symbol ?? (a === AGENTDOM_CA ? TOKEN.ticker : null);
  const fetchedAt = new Date().toISOString();
  return {
    token: { address: a, symbol: sym, name: meta?.data?.data?.attributes?.name ?? null },
    hours,
    transfers: 0,
    biggest: [],
    burned: 0,
    note: 'Large transfer feeds for Solana need HELIUS_API_KEY. Use Solscan for full history.',
    sourceUrl: tokenUrl(a),
    fetchedAt,
  };
}

export async function tokenChart(address: string, _ctx: CallContext, hours: 24 | 168 | 720 = 24): Promise<TokenChart> {
  const a = checkAddress(address);
  const res = hours <= 24 ? '60' : hours <= 168 ? '240' : '1D';
  return {
    address: a,
    symbol: a === AGENTDOM_CA ? TOKEN.ticker : null,
    resolution: res,
    candles: [],
    changePct: null,
    sourceUrl: tokenUrl(a),
    fetchedAt: new Date().toISOString(),
  };
}

export async function newLaunches(ctx: CallContext, limit = 12): Promise<{ launches: Launch[]; note: string; sourceUrl: string; fetchedAt: string }> {
  const r = await gt('new_pools?page=1', ctx, 60_000);
  const items = ((r.data?.data ?? []) as any[]).slice(0, limit);
  const launches: Launch[] = items.map((x) => {
    const a = x.attributes ?? {};
    const base = String(x.relationships?.base_token?.data?.id ?? '').replace(/^solana_/, '');
    return {
      address: base,
      name: String(a.name ?? ''),
      symbol: String(a.symbol ?? ''),
      createdAt: String(a.pool_created_at ?? a.created_at ?? ''),
      liquidityUsd: a.reserve_in_usd ? Number(a.reserve_in_usd) : null,
      marketCapUsd: a.market_cap_usd ? Number(a.market_cap_usd) : null,
      volume24h: a.volume_usd?.h24 ? Number(a.volume_usd.h24) : null,
      holders: null,
      url: a.coingecko_url ?? tokenUrl(base),
    };
  });
  return {
    launches,
    note: 'New pools on Solana from GeckoTerminal. A listing is not an endorsement.',
    sourceUrl: 'https://www.geckoterminal.com/solana/pools',
    fetchedAt: r.fetchedAt,
  };
}

function mapPool(x: any): PoolRow {
  const a = x.attributes ?? {};
  const base = String(x.relationships?.base_token?.data?.id ?? '').replace(/^solana_/, '');
  return {
    name: String(a.name ?? x.id ?? '—'),
    dex: String(x.relationships?.dex?.data?.id ?? '—'),
    token: base || null,
    priceUsd: a.base_token_price_usd ? Number(a.base_token_price_usd) : null,
    liquidityUsd: a.reserve_in_usd ? Number(a.reserve_in_usd) : null,
    volume24h: a.volume_usd?.h24 ? Number(a.volume_usd.h24) : null,
    change24h: a.price_change_percentage?.h24 ? Number(a.price_change_percentage.h24) : null,
    txns24h: a.transactions?.h24 ? Number(a.transactions.h24) : null,
    createdAt: a.pool_created_at ?? null,
    url: a.coingecko_url ?? 'https://www.geckoterminal.com/solana/pools',
  };
}

export async function marketPulse(ctx: CallContext, limit = 12): Promise<MarketPulse> {
  const [trend, fresh, dx] = await Promise.all([
    gt('trending_pools?page=1', ctx, 60_000).catch(() => null),
    gt('new_pools?page=1', ctx, 60_000).catch(() => null),
    gt('dexes?page=1', ctx, 60 * 60_000).catch(() => null),
  ]);
  return {
    trending: ((trend?.data?.data ?? []) as any[]).slice(0, limit).map(mapPool),
    newest: ((fresh?.data?.data ?? []) as any[]).slice(0, limit).map(mapPool),
    dexCount: Array.isArray(dx?.data?.data) ? dx!.data.data.length : null,
    note: 'Trending and new pools on Solana (GeckoTerminal).',
    sourceUrl: 'https://www.geckoterminal.com/solana/pools',
    fetchedAt: trend?.fetchedAt ?? new Date().toISOString(),
  };
}

export async function chainEconomy(ctx: CallContext): Promise<ChainEconomy> {
  const chains = await fetchJson<any[]>('https://api.llama.fi/v2/chains', { provider: 'defillama', ctx, ttlMs: 30 * 60_000 });
  const sol = ((Array.isArray(chains.data) ? chains.data : []) as any[]).find((c) => c.name === 'Solana' || c.gecko_id === 'solana');
  return {
    tvl: sol?.tvl ? Number(sol.tvl) : null,
    dexVolume24h: null,
    dexVolumeChange1d: null,
    fees24h: null,
    stablecoins: null,
    topDexes: [],
    topFees: [],
    sourceUrl: 'https://defillama.com/chain/solana',
    fetchedAt: chains.fetchedAt,
  };
}

const solOnly = (name: string): never => {
  throw new Error(`${name} is not available on Solana. Use Solana market tools, wallet lookup, or the $AGENTDOM ledger instead.`);
};

export async function corporateActions(_ctx: CallContext, _symbol?: string, _limit?: number): Promise<{ actions: CorporateAction[]; sourceUrl: string; fetchedAt: string }> {
  return solOnly('Corporate actions');
}
export async function stockBoard(_ctx: CallContext, _symbols?: string[]): Promise<StockBoard> {
  return solOnly('Stock tokens');
}
export async function stockDetail(_symbol: string, _ctx: CallContext): Promise<StockDetail> {
  return solOnly('Stock token lookup');
}
export async function stockTokenList(_ctx: CallContext): Promise<unknown[]> {
  return solOnly('Stock token list');
}
export async function oraclePrices(_ctx: CallContext, _kind?: string, _limit?: number): Promise<OracleBoard> {
  return solOnly('Chainlink oracles');
}
export async function decodeSelector(_selector: string, _ctx: CallContext): Promise<string | null> {
  return null;
}
export async function goplusCheck(_address: string, _ctx: CallContext) {
  return null;
}
export async function sourcifyMatch(_address: string, _ctx: CallContext) {
  return null;
}
export async function stockCandles(_ctx: CallContext) {
  return solOnly('Stock candles');
}
export async function tokenPrices(_ctx: CallContext) {
  return solOnly('Token prices');
}
export async function walletNfts(_address: string, _ctx: CallContext) {
  return solOnly('NFT portfolio');
}
export async function walletPortfolio(_address: string, _ctx: CallContext) {
  return solOnly('Portfolio');
}
export async function walletTransfers(_address: string, _ctx: CallContext, _limit?: number) {
  return solOnly('Wallet history');
}
