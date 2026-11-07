// Every external API the realm talks to. To add a credentialed provider later:
// 1) add one entry here with needsKey: true + envKey, 2) write one client file,
// 3) put the key in .env. Keys are read from process.env on the server only.
import type { ProvinceId } from '../../shared/realm';
import { setLabel, setThrottle, type Throttle } from './http';

export interface Provider {
  id: string;
  name: string;
  homepage: string;
  docsUrl: string;
  purpose: string;
  guild: ProvinceId | 'realm';
  needsKey: boolean;
  envKey?: string;
  throttle?: Throttle;
}

export const PROVIDERS: Provider[] = [
  { id: 'wikipedia', name: 'Wikipedia', homepage: 'https://en.wikipedia.org', docsUrl: 'https://en.wikipedia.org/api/rest_v1/', purpose: 'Encyclopedia search, page summaries and “On this day” events', guild: 'archive', needsKey: false, throttle: { minIntervalMs: 100, maxConcurrent: 4 } },
  { id: 'openalex', name: 'OpenAlex', homepage: 'https://openalex.org', docsUrl: 'https://docs.openalex.org', purpose: 'Scholarly works with citation counts', guild: 'archive', needsKey: false, throttle: { minIntervalMs: 150, maxConcurrent: 2 } },
  { id: 'arxiv', name: 'arXiv', homepage: 'https://arxiv.org', docsUrl: 'https://info.arxiv.org/help/api/index.html', purpose: 'Preprints in physics, maths and computer science', guild: 'archive', needsKey: false, throttle: { minIntervalMs: 3000, maxConcurrent: 1 } },
  { id: 'openlibrary', name: 'Open Library', homepage: 'https://openlibrary.org', docsUrl: 'https://openlibrary.org/developers/api', purpose: 'Book search with authors and first publish year', guild: 'archive', needsKey: false, throttle: { minIntervalMs: 300, maxConcurrent: 2 } },
  { id: 'hackernews', name: 'Hacker News (Algolia)', homepage: 'https://news.ycombinator.com', docsUrl: 'https://hn.algolia.com/api', purpose: 'Front page stories and story search', guild: 'heralds', needsKey: false },
  { id: 'mastodon', name: 'Mastodon (mastodon.social)', homepage: 'https://mastodon.social', docsUrl: 'https://docs.joinmastodon.org/methods/trends/', purpose: 'Trending hashtags and links on the fediverse', guild: 'heralds', needsKey: false, throttle: { minIntervalMs: 1000, maxConcurrent: 1 } },
  { id: 'frankfurter', name: 'Frankfurter', homepage: 'https://frankfurter.dev', docsUrl: 'https://frankfurter.dev', purpose: 'Exchange rates from the European Central Bank', guild: 'treasury', needsKey: false },
  { id: 'worldbank', name: 'World Bank Open Data', homepage: 'https://data.worldbank.org', docsUrl: 'https://datahelpdesk.worldbank.org/knowledgebase/articles/889392', purpose: 'Country economic indicators (GDP, inflation, population…)', guild: 'treasury', needsKey: false },
  { id: 'nagerdate', name: 'Nager.Date', homepage: 'https://date.nager.at', docsUrl: 'https://date.nager.at/Api', purpose: 'Public holidays for 100+ countries', guild: 'bazaar', needsKey: false },
  { id: 'dictionary', name: 'Free Dictionary API', homepage: 'https://dictionaryapi.dev', docsUrl: 'https://dictionaryapi.dev', purpose: 'English definitions, phonetics and examples', guild: 'scriptorium', needsKey: false },
  { id: 'datamuse', name: 'Datamuse', homepage: 'https://www.datamuse.com', docsUrl: 'https://www.datamuse.com/api/', purpose: 'Synonyms, rhymes and related words', guild: 'scriptorium', needsKey: false },
  { id: 'languagetool', name: 'LanguageTool', homepage: 'https://languagetool.org', docsUrl: 'https://languagetool.org/http-api/', purpose: 'Grammar, spelling and style checks', guild: 'scriptorium', needsKey: false, throttle: { minIntervalMs: 3500, maxConcurrent: 1 } },
  { id: 'federalregister', name: 'Federal Register', homepage: 'https://www.federalregister.gov', docsUrl: 'https://www.federalregister.gov/developers/documentation/api/v1', purpose: 'New US federal rules, notices and proposed rules', guild: 'court', needsKey: false },
  { id: 'openmeteo', name: 'Open-Meteo', homepage: 'https://open-meteo.com', docsUrl: 'https://open-meteo.com/en/docs', purpose: 'Current weather for the realm and city lookup', guild: 'throne', needsKey: false },
  // Anonymous free tier: 1 image every 45 s per IP (HTTP 402 FREE_LIMIT otherwise).
  // An optional POLLINATIONS_TOKEN in .env is sent as a Bearer token and relaxes the spacing.
  {
    id: 'pollinations',
    name: 'Pollinations',
    homepage: 'https://pollinations.ai',
    docsUrl: 'https://github.com/pollinations/pollinations/blob/master/APIDOCS.md',
    purpose: 'Text-to-image generation for posters and banners',
    guild: 'atelier',
    needsKey: false,
    envKey: 'POLLINATIONS_TOKEN',
    throttle: { minIntervalMs: process.env.POLLINATIONS_TOKEN ? 3000 : 47_000, maxConcurrent: 1 },
  },
  // ---- credentialed providers (keys live in .env on the server only) ----
  { id: 'tavily', name: 'Tavily', homepage: 'https://tavily.com', docsUrl: 'https://docs.tavily.com', purpose: 'Web search with extracted answers (1,000 credits/month free)', guild: 'archive', needsKey: true, envKey: 'TAVILY_API_KEY', throttle: { minIntervalMs: 1000, maxConcurrent: 2 } },
  { id: 'exa', name: 'Exa', homepage: 'https://exa.ai', docsUrl: 'https://exa.ai/docs', purpose: 'Meaning-based web search and find-similar companies', guild: 'bazaar', needsKey: true, envKey: 'EXA_API_KEY', throttle: { minIntervalMs: 1000, maxConcurrent: 2 } },
  { id: 'jina', name: 'Jina Reader', homepage: 'https://jina.ai/reader', docsUrl: 'https://jina.ai/reader', purpose: 'Reads any public web page as clean text', guild: 'archive', needsKey: true, envKey: 'JINA_API_KEY', throttle: { minIntervalMs: 500, maxConcurrent: 2 } },
  { id: 'firecrawl', name: 'Firecrawl', homepage: 'https://www.firecrawl.dev', docsUrl: 'https://docs.firecrawl.dev', purpose: 'Crawls a whole website into clean pages', guild: 'forge', needsKey: true, envKey: 'FIRECRAWL_API_KEY', throttle: { minIntervalMs: 2000, maxConcurrent: 1 } },
  { id: 'gnews', name: 'GNews', homepage: 'https://gnews.io', docsUrl: 'https://gnews.io/docs', purpose: 'Latest news from thousands of outlets', guild: 'heralds', needsKey: true, envKey: 'GNEWS_API_KEY', throttle: { minIntervalMs: 1500, maxConcurrent: 1 } },
  { id: 'youtube', name: 'YouTube Data API', homepage: 'https://www.youtube.com', docsUrl: 'https://developers.google.com/youtube/v3', purpose: 'Trending videos and video search', guild: 'heralds', needsKey: true, envKey: 'YOUTUBE_API_KEY', throttle: { minIntervalMs: 500, maxConcurrent: 2 } },
  { id: 'finnhub', name: 'Finnhub', homepage: 'https://finnhub.io', docsUrl: 'https://finnhub.io/docs/api', purpose: 'Stock quotes, company profiles and company news', guild: 'treasury', needsKey: true, envKey: 'FINNHUB_API_KEY', throttle: { minIntervalMs: 1100, maxConcurrent: 2 } },
  { id: 'fred', name: 'FRED (St. Louis Fed)', homepage: 'https://fred.stlouisfed.org', docsUrl: 'https://fred.stlouisfed.org/docs/api/fred/', purpose: 'US economic time series (inflation, rates, jobs)', guild: 'treasury', needsKey: true, envKey: 'FRED_API_KEY', throttle: { minIntervalMs: 600, maxConcurrent: 2 } },
  { id: 'wolfram', name: 'Wolfram|Alpha', homepage: 'https://www.wolframalpha.com', docsUrl: 'https://products.wolframalpha.com/llm-api/documentation', purpose: 'Exact calculations, conversions and curated facts', guild: 'treasury', needsKey: true, envKey: 'WOLFRAM_APP_ID', throttle: { minIntervalMs: 1000, maxConcurrent: 1 } },
  { id: 'courtlistener', name: 'CourtListener', homepage: 'https://www.courtlistener.com', docsUrl: 'https://www.courtlistener.com/help/api/rest/', purpose: 'US court opinions and case law search', guild: 'court', needsKey: true, envKey: 'COURTLISTENER_TOKEN', throttle: { minIntervalMs: 1000, maxConcurrent: 1 } },
  { id: 'geoapify', name: 'Geoapify', homepage: 'https://www.geoapify.com', docsUrl: 'https://apidocs.geoapify.com', purpose: 'Local businesses and places anywhere in the world', guild: 'bazaar', needsKey: true, envKey: 'GEOAPIFY_API_KEY', throttle: { minIntervalMs: 300, maxConcurrent: 2 } },
  { id: 'pagespeed', name: 'Google PageSpeed Insights', homepage: 'https://pagespeed.web.dev', docsUrl: 'https://developers.google.com/speed/docs/insights/v5/get-started', purpose: 'Website speed, SEO and accessibility audits', guild: 'forge', needsKey: true, envKey: 'PAGESPEED_API_KEY', throttle: { minIntervalMs: 1000, maxConcurrent: 2 } },
  { id: 'github', name: 'GitHub', homepage: 'https://github.com', docsUrl: 'https://docs.github.com/rest', purpose: 'Reads public repositories and publishes Forge websites to GitHub Pages', guild: 'forge', needsKey: true, envKey: 'GITHUB_TOKEN', throttle: { minIntervalMs: 300, maxConcurrent: 2 } },
  { id: 'cloudflare', name: 'Cloudflare Workers AI', homepage: 'https://developers.cloudflare.com/workers-ai/', docsUrl: 'https://developers.cloudflare.com/workers-ai/models/', purpose: 'Image generation, speech (narration and transcription) and translation', guild: 'atelier', needsKey: true, envKey: 'CLOUDFLARE_API_TOKEN', throttle: { minIntervalMs: 500, maxConcurrent: 2 } },
  { id: 'huggingface', name: 'Hugging Face', homepage: 'https://huggingface.co', docsUrl: 'https://huggingface.co/docs/inference-providers', purpose: 'Open models via Inference Providers (currently unused: the account has no free credit, Cloudflare handles alt text)', guild: 'theatre', needsKey: true, envKey: 'HF_TOKEN', throttle: { minIntervalMs: 1000, maxConcurrent: 1 } },
  { id: 'pixabay', name: 'Pixabay', homepage: 'https://pixabay.com', docsUrl: 'https://pixabay.com/api/docs/', purpose: 'Free stock photos and video clips', guild: 'atelier', needsKey: true, envKey: 'PIXABAY_API_KEY', throttle: { minIntervalMs: 700, maxConcurrent: 2 } },
  { id: 'freesound', name: 'Freesound', homepage: 'https://freesound.org', docsUrl: 'https://freesound.org/docs/api/', purpose: 'Music and sound effects with Creative Commons licenses', guild: 'theatre', needsKey: true, envKey: 'FREESOUND_API_KEY', throttle: { minIntervalMs: 1000, maxConcurrent: 1 } },
  { id: 'removebg', name: 'remove.bg', homepage: 'https://www.remove.bg', docsUrl: 'https://www.remove.bg/api', purpose: 'Removes photo backgrounds (50 free calls a month)', guild: 'atelier', needsKey: true, envKey: 'REMOVEBG_API_KEY', throttle: { minIntervalMs: 2000, maxConcurrent: 1 } },
  { id: 'bluesky', name: 'Bluesky', homepage: 'https://bsky.app', docsUrl: 'https://docs.bsky.app', purpose: 'Publishes approved posts from the realm account', guild: 'heralds', needsKey: true, envKey: 'BLUESKY_APP_PASSWORD', throttle: { minIntervalMs: 2000, maxConcurrent: 1 } },
  { id: 'telegram', name: 'Telegram Bot', homepage: 'https://telegram.org', docsUrl: 'https://core.telegram.org/bots/api', purpose: 'Sends realm reports to the owner on Telegram', guild: 'throne', needsKey: true, envKey: 'TELEGRAM_BOT_TOKEN', throttle: { minIntervalMs: 1000, maxConcurrent: 1 } },
  { id: 'discord', name: 'Discord webhook', homepage: 'https://discord.com', docsUrl: 'https://discord.com/developers/docs/resources/webhook', purpose: 'Posts realm reports to the Agentdom Discord server', guild: 'throne', needsKey: true, envKey: 'DISCORD_WEBHOOK_URL', throttle: { minIntervalMs: 1500, maxConcurrent: 1 } },
];

export const PROVIDER = Object.fromEntries(PROVIDERS.map((p) => [p.id, p])) as Record<string, Provider>;

for (const p of PROVIDERS) {
  setLabel(p.id, p.name);
  if (p.throttle) setThrottle(p.id, p.throttle);
}

/** True when the provider needs no key, or its key is present in the environment. */
export function enabled(p: Provider | string): boolean {
  const prov = typeof p === 'string' ? PROVIDER[p] : p;
  if (!prov) return false;
  return !prov.needsKey || !!(prov.envKey && process.env[prov.envKey]);
}

/** Server-only: read a provider's key. Never send this to clients or logs. */
export function providerKey(id: string): string | undefined {
  const p = PROVIDER[id];
  return p?.envKey ? process.env[p.envKey] : undefined;
}
