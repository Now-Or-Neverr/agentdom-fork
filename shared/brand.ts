/** Token + chain identity shared by the web app and API. */
export const TOKEN = {
  mint: 'DMzF5jWjXu2cEXdLCk5qe9HMj6piMqNrZHyYs1Rcpump',
  ticker: 'AGENTDOM',
  chain: 'Solana',
  /** SPL token decimals (pump.fun mints are usually 6). */
  decimals: 6,
  explorer: 'https://solscan.io',
  /** Official deployer wallet — only this mint + wallet are real. */
  devWallet: 'HZQrfo7CtqvbhKTn95ypPySXA2Pu2vVZsok4PHo5o5FC',
  /** ISO 8601 UTC when $AGENTDOM goes live on the mint above (countdown until then). */
  launchAt: '2026-11-14T20:00:00.000Z',
} as const;
