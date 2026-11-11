// Holder perks: prove wallet ownership with a free message signature; enough $AGENTDOM on Solana
// unlocks extra decrees per day. Balance is re-read from Solana RPC.
import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { TOKEN } from '../shared/brand';
import { db, now } from './db';
import { HttpError, currentUser, h, text } from './core';
import * as I from './integrations';

const BASE = Number(process.env.DAILY_DECREES_PER_USER) || 5;
export const HOLDER_MIN = Number(process.env.HOLDER_MIN_TOKENS) || 1_000_000;
export const HOLDER_BONUS = Number(process.env.HOLDER_BONUS_DECREES) || 5;
const STALE_MS = 30 * 60_000;
const CTX: I.CallContext = { context: 'realm', ref: 'holder' };
const DECIMALS = Number(process.env.TOKEN_DECIMALS) || TOKEN.decimals;

db.exec(`
CREATE TABLE IF NOT EXISTS user_wallets (
  user_id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  balance TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  checked_at TEXT NOT NULL
);
`);

interface WalletRow {
  user_id: string;
  address: string;
  balance: string;
  verified_at: string;
  checked_at: string;
}
const row = (userId: string) => db.prepare('SELECT * FROM user_wallets WHERE user_id = ?').get(userId) as WalletRow | undefined;
const minRaw = () => BigInt(HOLDER_MIN) * 10n ** BigInt(DECIMALS);
const isHolder = (r: WalletRow | undefined) => !!r && BigInt(r.balance) >= minRaw();

async function refresh(r: WalletRow): Promise<WalletRow> {
  const bal = await I.tokenBalance(I.AGENTDOM_CA, r.address, CTX);
  const next = { ...r, balance: bal.toString(), checked_at: now() };
  db.prepare('UPDATE user_wallets SET balance = ?, checked_at = ? WHERE user_id = ?').run(next.balance, next.checked_at, r.user_id);
  return next;
}
const refreshing = new Set<string>();
function refreshSoon(r: WalletRow) {
  if (refreshing.has(r.user_id) || Date.now() - Date.parse(r.checked_at) < STALE_MS) return;
  refreshing.add(r.user_id);
  refresh(r)
    .catch(() => {})
    .finally(() => refreshing.delete(r.user_id));
}

/** Decrees per day for this user: the base limit, plus the holder bonus while they hold enough. */
export function decreeLimit(userId: string): number {
  const r = row(userId);
  if (r) refreshSoon(r);
  return BASE + (isHolder(r) ? HOLDER_BONUS : 0);
}

function status(r: WalletRow | undefined) {
  return {
    min: HOLDER_MIN,
    bonus: HOLDER_BONUS,
    base: BASE,
    wallet: r ? { address: r.address, balance: I.formatTokens(r.balance), checkedAt: r.checked_at } : null,
    holder: isHolder(r),
    limit: BASE + (isHolder(r) ? HOLDER_BONUS : 0),
    token: I.AGENTDOM_CA,
  };
}

const challenges = new Map<string, { address: string; message: string; exp: number }>();

export const router = Router();

router.get(
  '/me/holder',
  h(async (req, res) => {
    const u = currentUser(req);
    let r = row(u.id as string);
    if (r && Date.now() - Date.parse(r.checked_at) > 60_000) r = await refresh(r).catch(() => r);
    res.json(status(r));
  }),
);

router.post(
  '/me/holder/challenge',
  h((req, res) => {
    const u = currentUser(req);
    const address = I.checkAddress(text(req.body?.address, 60, 'address'));
    const message = [
      'Agentdom holder check',
      '',
      `Wallet: ${address}`,
      `Nonce: ${randomBytes(12).toString('hex')}`,
      `Issued: ${now()}`,
      '',
      'Signing is free. It proves you own this wallet; it does not send a transaction or give anyone access to your funds.',
    ].join('\n');
    challenges.set(u.id as string, { address, message, exp: Date.now() + 10 * 60_000 });
    if (challenges.size > 5000) for (const [k, v] of challenges) if (v.exp < Date.now()) challenges.delete(k);
    res.json({ message });
  }),
);

router.post(
  '/me/holder',
  h(async (req, res) => {
    const u = currentUser(req);
    const c = challenges.get(u.id as string);
    if (!c || c.exp < Date.now()) throw new HttpError(400, 'The signing request expired. Please try again.');
    const signature = text(req.body?.signature, 300, 'signature');
    const ok = I.verifySolanaMessage(c.message, signature, c.address);
    if (!ok) throw new HttpError(400, 'The signature does not match this wallet.');
    challenges.delete(u.id as string);
    const t = now();
    db.prepare('INSERT INTO user_wallets (user_id, address, balance, verified_at, checked_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET address = excluded.address, balance = excluded.balance, verified_at = excluded.verified_at, checked_at = excluded.checked_at').run(u.id, c.address, '0', t, t);
    const r = await refresh(row(u.id as string)!).catch(() => {
      throw new HttpError(502, 'Wallet linked, but Solana RPC did not answer. Try again in a minute.');
    });
    res.json(status(r));
  }),
);

router.delete(
  '/me/holder',
  h((req, res) => {
    const u = currentUser(req);
    db.prepare('DELETE FROM user_wallets WHERE user_id = ?').run(u.id);
    res.json(status(undefined));
  }),
);
