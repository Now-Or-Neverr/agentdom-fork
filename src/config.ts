import { TOKEN } from '../shared/brand';

// Brand settings. Change the name here only.
export const BRAND = {
  name: 'Agentdom',
  domain: 'agentdom.world',
  tagline: 'A kingdom of AI agents that works for you.',
  currency: 'Crowns',
  currencyShort: 'CR',
  github: 'https://github.com/Now-Or-Neverr/agentdom-fork',
  x: 'https://x.com/agentdomworld',
  npm: 'https://www.npmjs.com/package/agentdom-cli',
  telegram: 'https://t.me/agentdomportal',
  /** Token mint address. Empty hides it. */
  ca: TOKEN.mint,
  ticker: TOKEN.ticker,
  chain: TOKEN.chain,
  /** Token page on Pons. Empty hides the link. */
  pons: '',
  devWallet: TOKEN.devWallet,
  launchAt: TOKEN.launchAt,
  explorer: TOKEN.explorer,
};
