#!/usr/bin/env node
// agentdom-cli: read-only command-line view of Agentdom and Robinhood Chain.
// Zero dependencies. Never asks for keys, never signs anything.

import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';

const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
})();

const DEFAULT_API = 'https://agentdom.world';

// ---------- colors ----------
const useColor = Boolean(process.stdout.isTTY) && !('NO_COLOR' in process.env);
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const c = {
  bold: paint('1'),
  dim: paint('2'),
  red: paint('31'),
  green: paint('32'),
  yellow: paint('33'),
  cyan: paint('36'),
};
const visibleLen = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '').length;
const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - visibleLen(s)));
const padLeft = (s, n) => ' '.repeat(Math.max(0, n - visibleLen(s))) + String(s);

// ---------- formatting helpers ----------
const NA = '-';
const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

function num(v, maxFrac = 2) {
  if (!isNum(v)) return NA;
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: maxFrac });
}

function amount(v) {
  // Token/ETH amounts arrive as decimal strings; keep them readable.
  if (!isNum(v)) return v == null ? NA : String(v);
  const n = Number(v);
  if (n === 0) return '0';
  if (Math.abs(n) < 0.0001) {
    const digits = Math.min(20, 3 - Math.floor(Math.log10(Math.abs(n))));
    return n.toFixed(digits).replace(/\.?0+$/, '');
  }
  if (Math.abs(n) < 1) return n.toLocaleString('en-US', { maximumSignificantDigits: 6 });
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function usd(v) {
  if (!isNum(v)) return NA;
  const n = Number(v);
  if (n !== 0 && Math.abs(n) < 0.01) return '$' + n.toPrecision(4);
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pct(v, signed = false) {
  if (!isNum(v)) return NA;
  const n = Number(v);
  const s = (signed && n > 0 ? '+' : '') + n.toFixed(2) + '%';
  if (!signed) return s;
  return n > 0 ? c.green(s) : n < 0 ? c.red(s) : s;
}

function when(v) {
  if (!v) return NA;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC').replace(/Z$/, ' UTC');
}

function usdBig(v) {
  // Large dollar figures (TVL, volume) in compact form: $1.06B, $387.4M.
  if (!isNum(v)) return NA;
  const n = Number(v);
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `$${(n / 1e3).toFixed(1)}K`;
  return usd(n);
}

function ago(v) {
  if (!v) return NA;
  const t = new Date(v).getTime();
  if (Number.isNaN(t)) return String(v);
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

const SPARK = '▁▂▃▄▅▆▇█';
function sparkline(values, width = 60) {
  let v = values.filter((x) => Number.isFinite(x));
  if (!v.length) return '';
  if (v.length > width) {
    // Downsample by taking the last value of each bucket.
    const step = v.length / width;
    v = Array.from({ length: width }, (_, i) => v[Math.min(v.length - 1, Math.floor((i + 1) * step) - 1)]);
  }
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  if (hi === lo) return SPARK[3].repeat(v.length);
  return v.map((x) => SPARK[Math.round(((x - lo) / (hi - lo)) * (SPARK.length - 1))]).join('');
}

function changeOf(candles) {
  const first = candles?.[0]?.o;
  const last = candles?.at?.(-1)?.c;
  return isNum(first) && isNum(last) && Number(first) > 0 ? ((last - first) / first) * 100 : null;
}

const short = (a) => (typeof a === 'string' && a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a ?? NA);
const who = (addr, name) => (name ? name : short(addr));
const yesNo = (v) => (v === true ? 'yes' : v === false ? 'no' : 'unknown');
// For risk questions: "yes" is the bad answer, so color it.
const risk = (v) => (v === true ? c.red('yes') : v === false ? c.green('no') : 'unknown');

function holdersTable(list) {
  table(
    ['#', 'Holder', 'Share', 'Balance', ''],
    list.map((h, i) => [String(i + 1), who(h.address, h.name), pct(h.pct), amount(h.balance), h.isContract ? c.dim('contract') : '']),
    [0, 2, 3],
  );
}

function rows(pairs) {
  const list = pairs.filter(Boolean);
  const w = Math.max(...list.map(([k]) => k.length));
  for (const [k, v] of list) console.log(`  ${c.dim(pad(k, w))}  ${v}`);
}

function table(headers, data, rightAlign = []) {
  const widths = headers.map((h, i) => Math.max(visibleLen(h), ...data.map((r) => visibleLen(r[i]))));
  const fmt = (r) =>
    ('  ' + r.map((cell, i) => (rightAlign.includes(i) ? padLeft(cell, widths[i]) : pad(cell, widths[i]))).join('  ')).trimEnd();
  console.log(c.dim(fmt(headers)));
  for (const r of data) console.log(fmt(r));
}

function title(s) {
  console.log(c.bold(s));
  console.log('');
}

function section(s) {
  console.log('');
  console.log(c.bold(s));
}

function source(d) {
  const parts = [d.name || 'Agentdom', d.sourceUrl, d.fetchedAt ? `fetched ${when(d.fetchedAt)}` : null].filter(Boolean);
  console.log('');
  console.log(c.dim(`Source: ${parts.join(' · ')}`));
}

function notAdvice() {
  console.log(c.dim('Not financial advice.'));
}

// ---------- errors ----------
class CliError extends Error {}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

function needAddress(v, cmd) {
  if (!v) throw new CliError(`Missing address. Usage: agentdom ${cmd} <address>`);
  if (!ADDRESS_RE.test(v)) throw new CliError(`"${v}" is not a valid address (0x followed by 40 hex characters).`);
  return v;
}

function needToken(v, cmd, extra = '') {
  if (!v) throw new CliError(`Missing token address. Usage: agentdom ${cmd} <token>${extra}`);
  if (!ADDRESS_RE.test(v)) throw new CliError(`"${v}" is not a valid token address (0x followed by 40 hex characters).`);
  return v;
}

function needHash(v) {
  if (!v) throw new CliError('Missing transaction hash. Usage: agentdom tx <hash>');
  if (!HASH_RE.test(v)) throw new CliError(`"${v}" is not a valid transaction hash (0x followed by 64 hex characters).`);
  return v;
}

// ---------- http ----------
async function get(base, path) {
  const url = base.replace(/\/+$/, '') + '/api' + path;
  let res;
  try {
    res = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': `agentdom-cli/${VERSION}` },
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    const why = e?.name === 'TimeoutError' ? 'timed out after 60 s' : e?.cause?.code || e?.cause?.errors?.[0]?.code || e?.cause?.message || e?.message || 'network error';
    throw new CliError(`Could not reach ${base} (${why}).`);
  }
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new CliError(`Unexpected response from ${url} (HTTP ${res.status}, not JSON).`);
  }
  if (!res.ok) throw new CliError(body?.error || `Request failed with HTTP ${res.status}.`);
  return body;
}

// ---------- commands ----------
const commands = {
  async pulse(api) {
    const d = await get(api, '/tools/chain/pulse');
    if (this.json) return d;
    title('Robinhood Chain pulse');
    rows([
      ['Latest block', `${num(d.latestBlock, 0)}  ${c.dim(when(d.blockTime))}`],
      ['Txs in latest', num(d.txInLatest, 0)],
      ['Avg txs/block', num(d.avgTxPerBlock)],
      ['Avg block time', isNum(d.avgBlockSeconds) ? `${num(d.avgBlockSeconds, 3)} s` : NA],
      ['Gas price', isNum(d.gasPriceGwei) ? `${num(d.gasPriceGwei, 6)} gwei` : NA],
      ['Base fee', isNum(d.baseFeeGwei) ? `${num(d.baseFeeGwei, 6)} gwei` : NA],
    ]);
    const st = d.stats;
    if (st) {
      section('Chain stats');
      const g = st.gas;
      rows([
        ['Txs today', num(st.transactionsToday, 0)],
        ['Total txs', num(st.totalTransactions, 0)],
        ['Total addresses', num(st.totalAddresses, 0)],
        isNum(st.avgBlockMs) ? ['Avg block time', `${num(st.avgBlockMs, 0)} ms (explorer)`] : null,
        g ? ['Gas slow/avg/fast', `${num(g.slow, 6)} / ${num(g.average, 6)} / ${num(g.fast, 6)} gwei`] : null,
      ]);
    }
    const blocks = Array.isArray(d.blocks) ? d.blocks : [];
    if (blocks.length) {
      section('Recent blocks');
      table(
        ['Block', 'Time', 'Txs', 'Gas used'],
        blocks.map((b) => [num(b.number, 0), when(b.time), num(b.txs, 0), num(b.gasUsed, 0)]),
        [0, 2, 3],
      );
    }
    source(d);
  },

  async tx(api, [hash]) {
    needHash(hash);
    const d = await get(api, `/tools/chain/tx?hash=${encodeURIComponent(hash)}`);
    if (this.json) return d;
    title('Transaction');
    const ok = d.status === 'success';
    const statusText = ok ? c.green('success') : d.status === 'failed' || d.status === 'reverted' ? c.red(d.status) : d.status || NA;

    // Plain-words summary.
    const lines = [];
    const sent = isNum(d.valueEth) && Number(d.valueEth) > 0;
    if (d.contractCreated) {
      lines.push(`${short(d.from)} created a new contract at ${d.contractCreated}.`);
    } else {
      // method is a decoded function name when known (e.g. "multicall"),
      // "unknown (0x12345678)" when no name was found, or "plain ETH transfer".
      const m = d.method || '';
      const call = !m
        ? 'sent a transaction to'
        : m === 'plain ETH transfer'
          ? 'sent ETH to'
          : /^unknown\b/.test(m)
            ? `called an unknown function ${m.replace(/^unknown\s*\(?|\)$/g, '')} on`
            : `called "${m}" on`;
      lines.push(`${short(d.from)} ${call} ${short(d.to)}${sent ? `, sending ${amount(d.valueEth)} ETH` : ''}.`);
    }
    for (const t of d.tokenTransfers || []) {
      const sym = t.symbol || t.name || short(t.token);
      if (t.burn) lines.push(`${short(t.from)} burned ${amount(t.amount)} ${sym} (sent to ${short(t.to)}).`);
      else lines.push(`${short(t.from)} moved ${amount(t.amount)} ${sym} to ${short(t.to)}.`);
    }
    lines.push(`Fee paid: ${amount(d.feeEth)} ETH. Status: ${statusText}.`);
    for (const l of lines) console.log(`  ${l}`);

    section('Details');
    rows([
      ['Hash', d.hash || hash],
      ['Status', statusText],
      ['Block', `${num(d.block, 0)}  ${c.dim(when(d.time))}`],
      ['From', d.from || NA],
      ['To', d.to || NA],
      d.contractCreated ? ['Created', d.contractCreated] : null,
      ['Method', d.method || NA],
      ['Value', `${amount(d.valueEth)} ETH`],
      ['Fee', `${amount(d.feeEth)} ETH`],
      ['Logs', num(d.logCount, 0)],
    ]);

    const transfers = d.tokenTransfers || [];
    if (transfers.length) {
      section('Token transfers');
      table(
        ['Token', 'Amount', 'From', 'To', ''],
        transfers.map((t) => [
          t.symbol || short(t.token),
          amount(t.amount),
          short(t.from),
          short(t.to),
          t.burn ? c.yellow('burn') : '',
        ]),
        [1],
      );
    }
    console.log('');
    console.log(`  Explorer: ${d.sourceUrl || NA}`);
    source(d);
  },

  async wallet(api, [address]) {
    needAddress(address, 'wallet');
    const d = await get(api, `/tools/chain/address?address=${encodeURIComponent(address)}`);
    if (this.json) return d;
    title(d.kind === 'contract' ? 'Contract address' : 'Wallet');
    rows([
      ['Address', d.address || address],
      ['Kind', d.kind || NA],
      ['ETH balance', `${amount(d.ethBalance)} ETH`],
      ['Tx count', num(d.txCount, 0)],
      [d.allTokens ? 'Tokens held' : 'Tokens checked', num(d.allTokens ? (d.tokens || []).length : d.checkedTokens, 0)],
      d.nfts ? ['NFTs', num(d.nfts.total, 0)] : null,
      d.portfolio && isNum(d.portfolio.totalUsd) ? ['Portfolio', `${usd(d.portfolio.totalUsd)}  ${c.dim('(Zerion)')}`] : null,
    ]);

    const pos = (d.portfolio?.positions || []).filter((p) => !isNum(p.valueUsd) || Number(p.valueUsd) >= 0.01);
    if (pos.length) {
      section('Portfolio positions');
      table(
        ['Asset', 'Quantity', 'Value', '1d'],
        pos.map((p) => [p.symbol || p.name || NA, amount(p.quantity), usd(p.valueUsd), pct(p.change1dPct, true)]),
        [1, 2, 3],
      );
    }

    const tokens = d.tokens || [];
    const flagged = tokens.filter((t) => t.flagged);
    section('Token balances');
    if (tokens.length) {
      table(
        ['Symbol', 'Balance', 'Value', 'Name', 'Token', ''],
        tokens.map((t) => [
          t.symbol || NA,
          amount(t.balance),
          usd(t.valueUsd),
          t.name || '',
          short(t.address),
          t.flagged ? c.yellow('flagged') : '',
        ]),
        [1, 2],
      );
    } else {
      console.log(d.allTokens ? '  No tokens held.' : '  None of the checked tokens are held.');
    }
    if (flagged.length) {
      console.log('');
      console.log(c.yellow(`  ${flagged.length} flagged token(s): ${flagged.map((t) => t.symbol || short(t.address)).join(', ')}.`));
      console.log(c.dim('  The explorer marks these as possible spam or scam tokens. Do not interact with them before a check: agentdom check <address>'));
    }

    const transfers = d.transfers || [];
    if (transfers.length) {
      section('Recent transfers');
      table(
        ['Time', 'Dir', 'Amount', 'Asset', 'Counterparty', ''],
        transfers.map((t) => [
          when(t.time),
          t.direction === 'in' ? c.green('in') : t.direction === 'out' ? c.red('out') : t.direction || NA,
          /^erc(721|1155)$/i.test(t.category) && !isNum(t.amount) ? '1' : amount(t.amount),
          t.asset || (/^erc(721|1155)$/i.test(t.category) ? `NFT ${short(t.token)}` : short(t.token)),
          t.direction === 'in' && /^0x0{40}$/i.test(t.from || '') ? c.dim('mint') : short(t.direction === 'in' ? t.from : t.to),
          t.burn ? c.yellow('burn') : '',
        ]),
        [2],
      );
    }

    const recent = d.recent || [];
    if (recent.length) {
      section('Recent transactions');
      table(
        ['Time', 'Method', 'To', 'Value', 'OK'],
        recent.map((t) => [when(t.time), t.method || NA, who(t.to, t.toName), `${amount(t.valueEth)} ETH`, t.ok ? c.green('yes') : c.red('no')]),
        [3],
      );
    }

    const nfts = d.nfts?.items || [];
    if (nfts.length) {
      section(`NFTs (${num(d.nfts.total, 0)})`);
      for (const n of nfts) console.log(`  ${n.name || `#${n.tokenId}`}${n.collection ? c.dim(`  ${n.collection}`) : ''}`);
    }
    if (d.note) {
      console.log('');
      console.log(c.dim(`  ${d.note}`));
    }
    source(d);
  },

  async check(api, [address]) {
    needAddress(address, 'check');
    const d = await get(api, `/tools/chain/contract?address=${encodeURIComponent(address)}`);
    if (this.json) return d;
    const tk = d.token;
    title(tk ? `Contract check: ${tk.name || ''} (${tk.symbol || '?'})` : 'Contract check');
    if (!d.isContract) {
      console.log(c.yellow('  This address is not a contract (no code deployed).'));
    }
    let ownerText = NA;
    if (d.ownerRenounced === true) ownerText = c.green('renounced');
    else if (d.owner) ownerText = d.owner;
    else if (d.ownerRenounced === false) ownerText = 'not renounced';
    else ownerText = 'none found';
    const honeypot =
      d.honeypot === true ? c.red('yes, selling looks blocked') : d.honeypot === false ? c.green('no') : 'unknown';
    rows([
      ['Address', d.address || address],
      ['Contract', yesNo(d.isContract)],
      tk ? ['Token', `${tk.name || NA} (${tk.symbol || NA}), ${num(tk.decimals, 0)} decimals`] : ['Token', 'not an ERC-20 token'],
      isNum(d.totalSupply) ? ['Total supply', amount(d.totalSupply)] : null,
      isNum(d.burned) ? ['Burned', amount(d.burned)] : null,
      ['Owner', ownerText],
      ['Proxy', d.proxy ? `yes, implementation ${d.proxy.implementation || 'unknown'}` : 'no'],
      d.stockToken ? ['Stock token', `yes, multiplier ${num(d.stockToken.multiplier, 6)}`] : null,
      ['Honeypot', honeypot],
    ]);

    const flags = d.flags || [];
    section(`Red flags (${flags.length})`);
    if (flags.length) {
      for (const f of flags) {
        console.log(`  ${c.yellow('!')} ${c.bold(f.label || 'flag')}`);
        if (f.why) console.log(`    ${f.why}`);
        if (Array.isArray(f.found) && f.found.length) console.log(c.dim(`    found: ${f.found.join(', ')}`));
      }
    } else {
      console.log(`  ${c.green('None found')} in the contract code.`);
    }

    const m = d.market;
    section('Market');
    if (m) {
      const tx = m.txns24h;
      const txText =
        tx && typeof tx === 'object' ? `${num(tx.buys, 0)} buys / ${num(tx.sells, 0)} sells` : num(tx, 0);
      rows([
        ['Price', usd(m.priceUsd)],
        ['24h change', pct(m.change24h, true)],
        ['Liquidity', usd(m.liquidityUsd)],
        ['Volume 24h', usd(m.volume24h)],
        ['Txns 24h', txText],
        ['FDV', usd(m.fdv)],
        ['Pairs', `${num(m.pairs, 0)}${m.dex ? ` on ${m.dex}` : ''}`],
        m.pairCreatedAt ? ['Pair created', when(m.pairCreatedAt)] : null,
        m.url ? ['Chart', m.url] : null,
      ]);
    } else {
      console.log('  No trading pair found.');
    }
    const g = d.goplus;
    section('GoPlus security scan');
    if (g) {
      const tax = (v) => (isNum(v) ? (Number(v) > 10 ? c.red(pct(v)) : Number(v) > 0 ? c.yellow(pct(v)) : c.green(pct(v))) : 'unknown');
      rows([
        ['Buy / sell tax', `${tax(g.buyTax)} / ${tax(g.sellTax)}`],
        ['Honeypot', risk(g.honeypot)],
        g.cannotSellAll !== null && g.cannotSellAll !== undefined ? ['Cannot sell all', risk(g.cannotSellAll)] : null,
        ['Mintable', risk(g.mintable)],
        ['Owner can change balance', risk(g.ownerCanChangeBalance)],
        ['Hidden owner', risk(g.hiddenOwner)],
        ['Can take back ownership', risk(g.canTakeBackOwnership)],
        ['Transfers pausable', risk(g.transferPausable)],
        ['Blacklist', risk(g.blacklist)],
        ['Open source', yesNo(g.openSource)],
        ['LP locked', isNum(g.lpLockedPct) ? pct(g.lpLockedPct) : 'unknown'],
        g.creator ? ['Creator', g.creator] : null,
        g.sourceUrl ? ['Report', g.sourceUrl] : null,
      ]);
    } else {
      console.log('  No GoPlus report for this address.');
    }

    const v = d.verified;
    const sf = d.sourcify;
    section('Verification');
    rows([
      [
        'Blockscout',
        v?.verified
          ? `${c.green('verified')}${v.name ? ` as ${v.name}` : ''}`
          : v
            ? c.yellow('not verified')
            : 'unknown',
      ],
      v?.verified && v.compiler ? ['Compiler', `${v.compiler}${v.language ? ` (${v.language})` : ''}`] : null,
      v?.verified && v.license ? ['License', v.license] : null,
      v?.verifiedAt ? ['Verified at', when(v.verifiedAt)] : null,
      v?.proxyType ? ['Proxy type', v.proxyType] : null,
      ...(v?.implementations || []).map((im) => ['Implementation', `${im.address}${im.name ? `  ${im.name}` : ''}`]),
      ['Sourcify', sf ? `${c.green(sf.match)} match${sf.verifiedAt ? `  ${c.dim(when(sf.verifiedAt))}` : ''}` : 'no match found'],
      sf?.url ? ['Sourcify files', sf.url] : null,
      d.reputation ? ['Explorer reputation', d.reputation === 'ok' ? d.reputation : c.yellow(d.reputation)] : null,
    ]);

    if (d.holders || d.topHolders?.length) {
      section('Holders');
      if (d.holders) {
        rows([
          ['Holders', num(d.holders.count, 0)],
          ['Top 10 hold', pct(d.holders.top10Pct)],
        ]);
      }
      if (d.topHolders?.length) {
        console.log('');
        holdersTable(d.topHolders.slice(0, 10));
      }
    }
    console.log('');
    console.log(c.dim(`  ${d.note || 'A function being present is not proof of abuse: it shows what the controller could do.'}`));
    source(d);
    notAdvice();
  },

  async stocks(api, symbols) {
    const want = symbols.map((s) => s.toUpperCase()).filter((s) => /^[A-Z.]{1,8}$/.test(s));
    const d = await get(api, '/tools/chain/stocks' + (want.length ? `?symbols=${encodeURIComponent(want.join(','))}` : ''));
    if (this.json) return d;
    title('Stock tokens vs Wall Street');
    const list = d.tokens || [];
    if (list.length) {
      table(
        ['Ticker', 'Wall St x mult', 'Robinhood', 'Chainlink', 'DEX', 'DEX gap', 'DEX liquidity'],
        list.map((t) => [
          c.bold(t.ticker || NA) + (t.halted ? c.yellow(' halted') : ''),
          usd(t.fairTokenPrice),
          usd(t.robinhoodTokenBid),
          usd(t.oraclePrice),
          usd(t.tokenPriceUsd),
          pct(t.gapPct, true),
          usd(t.liquidityUsd),
        ]),
        [1, 2, 3, 4, 5, 6],
      );
      console.log('');
      console.log(c.dim(`  ${num(d.listed, 0)} official stock tokens listed. Pick any: agentdom stocks NVDA TSLA, or agentdom stock AAPL.`));
    } else {
      console.log('  No stock tokens found.');
    }
    if (d.note) console.log(c.dim(`  ${d.note}`));
    source(d);
    notAdvice();
  },

  async stock(api, [symbol]) {
    if (!symbol) throw new CliError('Missing ticker. Usage: agentdom stock <TICKER or address>');
    const d = await get(api, `/tools/chain/stock?symbol=${encodeURIComponent(symbol)}`);
    if (this.json) return d;
    title(`${d.ticker} stock token: ${d.name}`);
    rows([
      ['Contract', d.address],
      ['Wall Street', `${usd(d.wallStreetBid)} / ${usd(d.wallStreetAsk)}  ${c.dim(`day ${usd(d.dailyLow)} to ${usd(d.dailyHigh)}`)}`],
      ['Multiplier', `${num(d.multiplier, 6)}${isNum(d.pendingMultiplier) ? `  ${c.yellow(`changing to ${num(d.pendingMultiplier, 6)}`)}` : ''}`],
      ['Fair price', usd(d.fairTokenPrice)],
      ['Robinhood', `${usd(d.robinhoodTokenBid)} / ${usd(d.robinhoodTokenAsk)}`],
      ['Chainlink', `${usd(d.oraclePrice)}  ${c.dim(when(d.oracleUpdatedAt))}`],
      ['DEX', `${usd(d.tokenPriceUsd)}  gap ${pct(d.gapPct, true)}  liquidity ${usd(d.liquidityUsd)}`],
      ['Supply', amount(d.supply)],
      ['Minted/burned', `${usd(d.mintBurnUsd)} today`],
      d.halted ? ['Trading', c.yellow('halted')] : null,
    ]);
    const acts = d.actions || [];
    if (acts.length) {
      section('Dividends and splits');
      table(['Type', 'Detail', 'Date', 'Status'], acts.map((a) => [a.type, a.detail, a.date, a.status]));
    }
    source(d);
    notAdvice();
  },

  async actions(api, [symbol]) {
    const d = await get(api, '/tools/chain/actions' + (symbol ? `?symbol=${encodeURIComponent(symbol)}` : ''));
    if (this.json) return d;
    title('Dividends and splits');
    const acts = d.actions || [];
    if (acts.length) table(['Ticker', 'Type', 'Detail', 'Date', 'Status'], acts.map((a) => [c.bold(a.symbol), a.type, a.detail, a.date, a.status]));
    else console.log('  None found.');
    source(d);
  },

  async oracles(api, [kind]) {
    const k = kind === 'stock' || kind === 'stocks' ? 'stock' : 'crypto';
    const d = await get(api, `/tools/chain/oracles?kind=${k}`);
    if (this.json) return d;
    title(`Chainlink prices onchain (${k})`);
    table(
      ['Feed', 'Price', 'Updated'],
      (d.feeds || []).filter((f) => isNum(f.price)).map((f) => [f.name.replace(/^Robinhood\s+/, ''), usd(f.price), when(f.updatedAt)]),
      [1],
    );
    if (d.note) console.log(c.dim(`\n  ${d.note}`));
    source(d);
  },

  async markets(api) {
    const d = await get(api, '/tools/chain/markets');
    if (this.json) return d;
    title('What is trading on Robinhood Chain');
    const show = (rows, fresh) =>
      table(
        ['Pool', 'DEX', 'Price', fresh ? 'Created' : '24h', 'Liquidity', 'Volume 24h', 'Token'],
        rows.map((p) => [p.name, p.dex, usd(p.priceUsd), fresh ? when(p.createdAt) : pct(p.change24h, true), usd(p.liquidityUsd), usd(p.volume24h), p.token ? short(p.token) : NA]),
        [2, 4, 5],
      );
    section('Trending');
    show(d.trending || [], false);
    section('Just launched');
    show(d.newest || [], true);
    console.log(c.dim(`\n  ${d.dexCount ? `${d.dexCount} DEXes active. ` : ''}Check any token first: agentdom check <address>`));
    if (d.note) console.log(c.dim(`  ${d.note}`));
    source(d);
    notAdvice();
  },

  async token(api) {
    const d = await get(api, '/tools/chain/agentdom');
    if (this.json) return d;
    title('$AGENTDOM ledger');
    const tx = d.txns24h;
    rows([
      ['Contract', d.address || NA],
      ['Price', usd(d.priceUsd)],
      ['24h change', pct(d.change24h, true)],
      ['Liquidity', usd(d.liquidityUsd)],
      ['Volume 24h', usd(d.volume24h)],
      ['Txns 24h', tx ? `${num(tx.buys, 0)} buys / ${num(tx.sells, 0)} sells` : NA],
      ['FDV', usd(d.fdv)],
      ['Holders', num(d.holders, 0)],
      ['Top 10 hold', pct(d.top10Pct)],
      ['Total supply', amount(d.totalSupply)],
      ['Burned', `${amount(d.burned)}${isNum(d.burnedPct) ? ` (${pct(d.burnedPct)})` : ''}`],
      d.pairUrl ? ['Chart', d.pairUrl] : null,
    ]);
    const candles = d.chart || [];
    if (candles.length) {
      section('Price, last 24 h (Codex candles)');
      console.log(`  ${sparkline(candles.map((k) => k.c))}`);
      rows([['Change', `${pct(changeOf(candles), true)}  ${c.dim(`${candles.length} candles, ${usd(candles[0].o)} to ${usd(candles.at(-1).c)}`)}`]]);
    }
    if (d.topHolders?.length) {
      section('Top holders');
      holdersTable(d.topHolders.slice(0, 10));
    }
    source(d);
    notAdvice();
  },

  async economy(api) {
    const d = await get(api, '/tools/chain/economy');
    if (this.json) return d;
    title('Robinhood Chain economy');
    rows([
      ['TVL', usdBig(d.tvl)],
      ['DEX volume 24h', `${usdBig(d.dexVolume24h)}  ${isNum(d.dexVolumeChange1d) ? `${pct(d.dexVolumeChange1d, true)} vs day before` : ''}`.trimEnd()],
      ['Fees 24h', usdBig(d.fees24h)],
      ['Stablecoins', usdBig(d.stablecoins)],
    ]);
    if (d.topDexes?.length) {
      section('Top DEXes by volume (24h)');
      table(['DEX', 'Volume 24h'], d.topDexes.map((x) => [x.name, usdBig(x.volume24h)]), [1]);
    }
    if (d.topFees?.length) {
      section('Top fee earners (24h)');
      table(['Protocol', 'Fees 24h'], d.topFees.map((x) => [x.name, usdBig(x.fees24h)]), [1]);
    }
    source(d);
    notAdvice();
  },

  async holders(api, [address]) {
    needToken(address, 'holders');
    const d = await get(api, `/tools/chain/holders?address=${encodeURIComponent(address)}`);
    if (this.json) return d;
    const tk = d.token || {};
    title(`Top holders: ${tk.name || short(address)}${tk.symbol ? ` (${tk.symbol})` : ''}`);
    rows([
      ['Token', tk.address || address],
      ['Holders', num(d.holdersCount, 0)],
      ['Total supply', amount(d.totalSupply)],
      tk.reputation && tk.reputation !== 'ok' ? ['Reputation', c.yellow(tk.reputation)] : null,
    ]);
    const list = d.holders || [];
    console.log('');
    if (list.length) holdersTable(list);
    else console.log('  No holders found.');
    console.log(c.dim('\n  Pools, lockers and contracts are named where the explorer knows them.'));
    source(d);
  },

  async moves(api, [address, hoursArg]) {
    needToken(address, 'moves', ' [hours 1-24]');
    let hours = 6;
    if (hoursArg !== undefined) {
      hours = Number(String(hoursArg).replace(/h$/i, ''));
      if (!Number.isInteger(hours) || hours < 1 || hours > 24) throw new CliError('Hours must be a whole number from 1 to 24. Usage: agentdom moves <token> [hours]');
    }
    const d = await get(api, `/tools/chain/moves?address=${encodeURIComponent(address)}&hours=${hours}`);
    if (this.json) return d;
    const tk = d.token || {};
    const sym = tk.symbol || short(address);
    title(`Big moves: ${tk.name || sym}${tk.symbol ? ` (${tk.symbol})` : ''}, last ${num(d.hours, 0)} h`);
    rows([
      ['Transfers', `${num(d.transfers, 0)}${Number(d.transfers) >= 1000 ? c.dim(' (capped at 1,000)') : ''}`],
      ['Burned', `${amount(d.burned)} ${sym}`],
    ]);
    const big = d.biggest || [];
    section('Biggest transfers');
    if (big.length) {
      table(
        ['Time', 'Amount', 'From', 'To', ''],
        big.map((t) => [when(t.time), amount(t.amount), who(t.from, t.fromName), who(t.to, t.toName), t.burn ? c.yellow('burn') : '']),
        [1],
      );
    } else {
      console.log('  No transfers in this window.');
    }
    if (d.note) console.log(c.dim(`\n  ${d.note}`));
    source(d);
  },

  async chart(api, [address, rangeArg]) {
    needToken(address, 'chart', ' [24h|7d|30d]');
    const ranges = { '24h': 24, '1d': 24, '7d': 168, '30d': 720 };
    const range = (rangeArg || '24h').toLowerCase();
    const hours = ranges[range];
    if (!hours) throw new CliError(`Unknown range "${rangeArg}". Use 24h, 7d or 30d.`);
    const d = await get(api, `/tools/chain/chart?address=${encodeURIComponent(address)}&hours=${hours}`);
    if (this.json) return d;
    const candles = d.candles || [];
    title(`Price chart: ${d.symbol || short(address)}, last ${range === '1d' ? '24h' : range} (${d.resolution || '?'} candles)`);
    if (!candles.length) {
      console.log('  No price data for this token in this range.');
      source(d);
      return;
    }
    const closes = candles.map((k) => k.c);
    const lo = Math.min(...candles.map((k) => k.l));
    const hi = Math.max(...candles.map((k) => k.h));
    console.log(c.dim(`  ${usd(Math.max(...closes))} highest close`));
    console.log(`  ${sparkline(closes)}`);
    console.log(c.dim(`  ${usd(Math.min(...closes))} lowest close`));
    console.log('');
    rows([
      ['First', `${usd(candles[0].o)}  ${c.dim(when(candles[0].t))}`],
      ['Last', `${usd(closes.at(-1))}  ${c.dim(when(candles.at(-1).t))}`],
      ['Min close', usd(Math.min(...closes))],
      ['Max close', usd(Math.max(...closes))],
      ['Low / high', `${usd(lo)} / ${usd(hi)}  ${c.dim('(wicks)')}`],
      ['Change', pct(isNum(d.changePct) ? d.changePct : changeOf(candles), true)],
      ['Candles', num(candles.length, 0)],
    ]);
    source(d);
    notAdvice();
  },

  async launches(api) {
    const d = await get(api, '/tools/chain/launches');
    if (this.json) return d;
    title('New launches on Robinhood Chain');
    const list = d.launches || [];
    if (list.length) {
      table(
        ['Token', 'Name', 'Age', 'Liquidity', 'Market cap', 'Volume 24h', 'Holders', 'Address'],
        list.map((x) => [c.bold(x.symbol || NA), x.name || '', ago(x.createdAt), usdBig(x.liquidityUsd), usdBig(x.marketCapUsd), usdBig(x.volume24h), num(x.holders, 0), x.address]),
        [2, 3, 4, 5, 6],
      );
    } else {
      console.log('  No new launches found.');
    }
    console.log(c.yellow('\n  A listing is not an endorsement. Check any token before touching it: agentdom check <address>'));
    source(d);
    notAdvice();
  },

  async status(api) {
    const d = await get(api, '/status');
    if (this.json) return d;
    title('Realm status');
    rows([
      ['AI', d.aiEnabled ? c.green('online') : c.yellow('offline')],
      ['Agents', num(d.agents, 0)],
      ['Working now', num(d.working, 0)],
      ['Decrees issued', num(d.issued, 0)],
      ['Approved', num(d.approved, 0)],
    ]);
    source({ name: 'Agentdom', sourceUrl: `${api.replace(/\/+$/, '')}/api/status`, fetchedAt: new Date().toISOString(), ...d });
  },
};

const HELP = `agentdom ${VERSION}: read-only command line for Agentdom and Robinhood Chain

Usage
  agentdom <command> [args] [--json] [--api <url>]

Commands
  pulse               Chain pulse: latest block, gas, txs today, recent blocks
  economy             Chain economy: TVL, DEX volume, fees, stablecoins, top DEXes
  tx <hash>           Explain a transaction in plain words
  wallet <address>    Balances, portfolio value, recent transfers, NFTs
  check <address>     Token safety: red flags, GoPlus scan, verification, holders
  holders <token>     Top holders of a token, with known names and share
  moves <token> [h]   Biggest transfers and burns in the last 1-24 h (default 6)
  chart <token> [r]   Price sparkline for 24h, 7d or 30d (default 24h)
  launches            Newest tokens with liquidity, market cap and holders
  stocks [TICKERS]    Stock tokens vs Wall Street, Chainlink and the DEX
  stock <TICKER>      One stock token in depth (any of the 200+ official ones)
  actions [TICKER]    Dividends and splits for stock tokens
  oracles [stock]     Chainlink prices onchain (crypto by default)
  markets             Trending and newly launched pools on Robinhood Chain
  token               $AGENTDOM ledger: price, 24h chart, holders, supply, burned
  status              Realm status: agents, work, decrees
  help                Show this help

Options
  --json              Print the raw JSON from the API
  --api <url>         API base URL (default ${DEFAULT_API}, or env AGENTDOM_API)
  -h, --help          Show this help
  -v, --version       Show the version

Examples
  agentdom pulse
  agentdom economy
  agentdom tx 0xae4e3fc27cb9f0c870a4787c1384a3eb503bc6910a21daef6af2b9b178a16404
  agentdom wallet 0x8C1A87C0Bc4D3545D4475916C42A60D3c51a68B3
  agentdom check 0x688d8c004af3c292330fea8af8a594adc8c3b0c8
  agentdom holders 0x688d8c004af3c292330fea8af8a594adc8c3b0c8
  agentdom moves 0x688d8c004af3c292330fea8af8a594adc8c3b0c8 12
  agentdom chart 0x688d8c004af3c292330fea8af8a594adc8c3b0c8 7d
  agentdom launches
  agentdom stock NVDA
  AGENTDOM_API=http://localhost:8790 agentdom status --json

This tool is read-only. It never asks for keys and never signs anything.
Issue decrees at https://agentdom.world/hall
Docs: https://agentdom.world/docs`;

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      strict: true,
      options: {
        json: { type: 'boolean' },
        api: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (e) {
    const first = e.message.split('\n')[0].split('. To specify')[0].replace(/\.?$/, '.');
    throw new CliError(`${first} Run "agentdom help" for usage.`);
  }
  const { values, positionals } = parsed;
  if (values.version) {
    console.log(VERSION);
    return;
  }
  const [cmd, ...rest] = positionals;
  if (values.help || !cmd || cmd === 'help') {
    console.log(HELP);
    return;
  }
  const run = Object.hasOwn(commands, cmd) ? commands[cmd] : null;
  if (!run) throw new CliError(`Unknown command "${cmd}". Run "agentdom help" for the list of commands.`);

  const api = values.api || process.env.AGENTDOM_API || DEFAULT_API;
  if (!/^https?:\/\/\S+$/i.test(api)) throw new CliError(`Invalid API URL "${api}". Use something like https://agentdom.world`);

  const out = await run.call({ json: Boolean(values.json) }, api, rest);
  if (values.json) console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  const msg = e instanceof CliError ? e.message : `Unexpected error: ${e?.stack || e}`;
  console.error(`${c.red('Error:')} ${msg}`);
  process.exitCode = 1;
});
