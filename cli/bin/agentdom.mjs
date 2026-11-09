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

const short = (a) => (typeof a === 'string' && a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a ?? NA);
const yesNo = (v) => (v === true ? 'yes' : v === false ? 'no' : 'unknown');

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
      const call = d.method ? `called "${d.method}" on` : 'sent a transaction to';
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
      ['Tokens checked', num(d.checkedTokens, 0)],
    ]);
    const tokens = d.tokens || [];
    section('Token balances');
    if (tokens.length) {
      table(
        ['Symbol', 'Balance', 'Name', 'Token'],
        tokens.map((t) => [t.symbol || NA, amount(t.balance), t.name || '', short(t.address)]),
        [1],
      );
    } else {
      console.log('  None of the checked tokens are held.');
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
    if (d.holders) {
      section('Holders');
      rows([
        ['Holders', num(d.holders.count, 0)],
        ['Top 10 hold', pct(d.holders.top10Pct)],
      ]);
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
  pulse               Robinhood Chain pulse: latest block, gas, recent blocks
  tx <hash>           Explain a transaction in plain words
  wallet <address>    ETH and token balances of an address
  check <address>     Red-flag check of a token contract
  stocks [TICKERS]    Stock tokens vs Wall Street, Chainlink and the DEX
  stock <TICKER>      One stock token in depth (any of the 200+ official ones)
  actions [TICKER]    Dividends and splits for stock tokens
  oracles [stock]     Chainlink prices onchain (crypto by default)
  markets             Trending and newly launched pools on Robinhood Chain
  token               $AGENTDOM ledger: price, holders, supply, burned
  status              Realm status: agents, work, decrees
  help                Show this help

Options
  --json              Print the raw JSON from the API
  --api <url>         API base URL (default ${DEFAULT_API}, or env AGENTDOM_API)
  -h, --help          Show this help
  -v, --version       Show the version

Examples
  agentdom pulse
  agentdom tx 0xb832760f469e68b4e0500d3c3c66ebde7d0cd24fa7be30f7e91f133173edfecc
  agentdom check 0x688d8c004af3c292330fea8af8a594adc8c3b0c8
  agentdom stock NVDA
  agentdom markets
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
