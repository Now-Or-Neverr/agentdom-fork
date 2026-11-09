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
  { id: 'openalex', name: 'OpenAlex', homepage: 'https://openalex.org', docsUrl: 'https://docs.openalex.org', purpose: 'Scholarly works with citation counts', guild: 'archive', needsKey: false, envKey: 'OPENALEX_API_KEY', throttle: { minIntervalMs: 150, maxConcurrent: 2 } },
  { id: 'arxiv', name: 'arXiv', homepage: 'https://arxiv.org', docsUrl: 'https://info.arxiv.org/help/api/index.html', purpose: 'Preprints in physics, maths and computer science', guild: 'archive', needsKey: false, throttle: { minIntervalMs: 3000, maxConcurrent: 1 } },
  { id: 'openlibrary', name: 'Open Library', homepage: 'https://openlibrary.org', docsUrl: 'https://openlibrary.org/developers/api', purpose: 'Book search with authors and first publish year', guild: 'archive', needsKey: false, throttle: { minIntervalMs: 300, maxConcurrent: 2 } },
  { id: 'hackernews', name: 'Hacker News (Algolia)', homepage: 'https://news.ycombinator.com', docsUrl: 'https://hn.algolia.com/api', purpose: 'Front page stories and story search', guild: 'heralds', needsKey: false },
  { id: 'mastodon', name: 'Mastodon (mastodon.social)', homepage: 'https://mastodon.social', docsUrl: 'https://docs.joinmastodon.org/methods/trends/', purpose: 'Trending hashtags and links on the fediverse', guild: 'heralds', needsKey: false, throttle: { minIntervalMs: 1000, maxConcurrent: 1 } },
  { id: 'frankfurter', name: 'Frankfurter', homepage: 'https://frankfurter.dev', docsUrl: 'https://frankfurter.dev', purpose: 'Exchange rates from the European Central Bank', guild: 'treasury', needsKey: false },
  { id: 'worldbank', name: 'World Bank Open Data', homepage: 'https://data.worldbank.org', docsUrl: 'https://datahelpdesk.worldbank.org/knowledgebase/articles/889392', purpose: 'Country economic indicators (GDP, inflation, population…)', guild: 'treasury', needsKey: false },
  { id: 'nagerdate', name: 'Nager.Date', homepage: 'https://date.nager.at', docsUrl: 'https://date.nager.at/Api', purpose: 'Public holidays for 100+ countries', guild: 'bazaar', needsKey: false },
  { id: 'dictionary', name: 'Free Dictionary API', homepage: 'https://dictionaryapi.dev', docsUrl: 'https://dictionaryapi.dev', purpose: 'English definitions, phonetics and examples', guild: 'scriptorium', needsKey: false },
  { id: 'wiktionary', name: 'Wiktionary', homepage: 'https://en.wiktionary.org', docsUrl: 'https://en.wiktionary.org/api/rest_v1/', purpose: 'Backup dictionary when the Free Dictionary API is down or has no entry', guild: 'scriptorium', needsKey: false, throttle: { minIntervalMs: 300, maxConcurrent: 2 } },
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
  // Observatory (no key)
  { id: 'usgs', name: 'USGS Earthquakes', homepage: 'https://earthquake.usgs.gov', docsUrl: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php', purpose: 'Recent earthquakes worldwide with magnitude, depth and alerts', guild: 'observatory', needsKey: false, throttle: { minIntervalMs: 500, maxConcurrent: 2 } },
  { id: 'wheretheiss', name: 'Where the ISS at?', homepage: 'https://wheretheiss.at', docsUrl: 'https://wheretheiss.at/w/developer', purpose: 'Live position, altitude and speed of the International Space Station', guild: 'observatory', needsKey: false, throttle: { minIntervalMs: 1100, maxConcurrent: 1 } },
  { id: 'nasaimages', name: 'NASA Image and Video Library', homepage: 'https://images.nasa.gov', docsUrl: 'https://images.nasa.gov/docs/images.nasa.gov_api_docs.pdf', purpose: 'Search NASA’s public image archive', guild: 'observatory', needsKey: false, throttle: { minIntervalMs: 500, maxConcurrent: 2 } },
  // Apothecary (no key)
  { id: 'openfda', name: 'openFDA', homepage: 'https://open.fda.gov', docsUrl: 'https://open.fda.gov/apis/', purpose: 'US drug labels and drug, food and device recalls', guild: 'apothecary', needsKey: false, throttle: { minIntervalMs: 300, maxConcurrent: 2 } },
  { id: 'pubmed', name: 'PubMed (NCBI E-utilities)', homepage: 'https://pubmed.ncbi.nlm.nih.gov', docsUrl: 'https://www.ncbi.nlm.nih.gov/books/NBK25501/', purpose: 'Biomedical research papers', guild: 'apothecary', needsKey: false, throttle: { minIntervalMs: 400, maxConcurrent: 1 } },
  { id: 'clinicaltrials', name: 'ClinicalTrials.gov', homepage: 'https://clinicaltrials.gov', docsUrl: 'https://clinicaltrials.gov/data-api/api', purpose: 'Registered clinical studies and their recruiting status', guild: 'apothecary', needsKey: false, throttle: { minIntervalMs: 500, maxConcurrent: 2 } },
  // Arena (no key)
  { id: 'musicbrainz', name: 'MusicBrainz', homepage: 'https://musicbrainz.org', docsUrl: 'https://musicbrainz.org/doc/MusicBrainz_API', purpose: 'Open music encyclopedia: artist identity, origin and active years', guild: 'arena', needsKey: false, throttle: { minIntervalMs: 1100, maxConcurrent: 1 } },
  { id: 'cheapshark', name: 'CheapShark', homepage: 'https://www.cheapshark.com', docsUrl: 'https://apidocs.cheapshark.com', purpose: 'PC game deals across digital stores', guild: 'arena', needsKey: false, throttle: { minIntervalMs: 1000, maxConcurrent: 1 } },
  { id: 'freetogame', name: 'FreeToGame', homepage: 'https://www.freetogame.com', docsUrl: 'https://www.freetogame.com/api-doc', purpose: 'Free-to-play PC and browser games', guild: 'arena', needsKey: false, throttle: { minIntervalMs: 1000, maxConcurrent: 1 } },
  // Enrichment for older guilds (no key)
  { id: 'osv', name: 'OSV.dev', homepage: 'https://osv.dev', docsUrl: 'https://google.github.io/osv.dev/api/', purpose: 'Known vulnerabilities in open-source package versions', guild: 'forge', needsKey: false, throttle: { minIntervalMs: 300, maxConcurrent: 2 } },
  { id: 'themealdb', name: 'TheMealDB', homepage: 'https://www.themealdb.com', docsUrl: 'https://www.themealdb.com/api.php', purpose: 'Recipes with ingredients and method', guild: 'bazaar', needsKey: false, throttle: { minIntervalMs: 500, maxConcurrent: 2 } },
  // ---- credentialed providers (keys live in .env on the server only) ----
  { id: 'nasa', name: 'NASA Open APIs', homepage: 'https://api.nasa.gov', docsUrl: 'https://api.nasa.gov', purpose: 'Astronomy Picture of the Day and near-Earth asteroids', guild: 'observatory', needsKey: true, envKey: 'NASA_API_KEY', throttle: { minIntervalMs: 500, maxConcurrent: 2 } },
  { id: 'openaq', name: 'OpenAQ', homepage: 'https://openaq.org', docsUrl: 'https://docs.openaq.org', purpose: 'Live air-quality readings from monitoring stations', guild: 'observatory', needsKey: true, envKey: 'OPENAQ_API_KEY', throttle: { minIntervalMs: 1000, maxConcurrent: 1 } },
  // Free tier: major competitions only, 10 requests a minute.
  { id: 'footballdata', name: 'football-data.org', homepage: 'https://www.football-data.org', docsUrl: 'https://docs.football-data.org', purpose: 'Football league tables and fixtures for major competitions', guild: 'arena', needsKey: true, envKey: 'FOOTBALL_DATA_TOKEN', throttle: { minIntervalMs: 6500, maxConcurrent: 1 } },
  { id: 'tmdb', name: 'TMDB', homepage: 'https://www.themoviedb.org', docsUrl: 'https://developer.themoviedb.org/docs', purpose: 'Films and TV shows: search and trending (Data: TMDB)', guild: 'arena', needsKey: true, envKey: 'TMDB_API_KEY', throttle: { minIntervalMs: 300, maxConcurrent: 2 } },
  { id: 'lastfm', name: 'Last.fm', homepage: 'https://www.last.fm', docsUrl: 'https://www.last.fm/api', purpose: 'Music charts and artist listener stats', guild: 'arena', needsKey: true, envKey: 'LASTFM_API_KEY', throttle: { minIntervalMs: 500, maxConcurrent: 1 } },
  // Demo tier: 50 requests an hour (unsplash.ts also keeps an hourly budget).
  { id: 'unsplash', name: 'Unsplash', homepage: 'https://unsplash.com', docsUrl: 'https://unsplash.com/documentation', purpose: 'Free high-quality photos, credited to the photographer', guild: 'atelier', needsKey: true, envKey: 'UNSPLASH_ACCESS_KEY', throttle: { minIntervalMs: 2000, maxConcurrent: 1 } },
  { id: 'guardian', name: 'The Guardian', homepage: 'https://www.theguardian.com', docsUrl: 'https://open-platform.theguardian.com/documentation/', purpose: 'Guardian headlines and short summaries with links back (non-commercial key)', guild: 'heralds', needsKey: true, envKey: 'GUARDIAN_API_KEY', throttle: { minIntervalMs: 1000, maxConcurrent: 1 } },
  // 5 requests a minute, 500 a day.
  { id: 'nyt', name: 'The New York Times', homepage: 'https://www.nytimes.com', docsUrl: 'https://developer.nytimes.com/apis', purpose: 'NYT top stories, most popular, article search and bestseller lists (headline + abstract + link)', guild: 'heralds', needsKey: true, envKey: 'NYT_API_KEY', throttle: { minIntervalMs: 12_500, maxConcurrent: 1 } },
  { id: 'tavily', name: 'Tavily', homepage: 'https://tavily.com', docsUrl: 'https://docs.tavily.com', purpose: 'Web search with extracted answers (1,000 credits/month free)', guild: 'archive', needsKey: true, envKey: 'TAVILY_API_KEY', throttle: { minIntervalMs: 1000, maxConcurrent: 2 } },
  { id: 'exa', name: 'Exa', homepage: 'https://exa.ai', docsUrl: 'https://exa.ai/docs', purpose: 'Meaning-based web search and find-similar companies', guild: 'bazaar', needsKey: true, envKey: 'EXA_API_KEY', throttle: { minIntervalMs: 1000, maxConcurrent: 2 } },
  { id: 'jina', name: 'Jina Reader', homepage: 'https://jina.ai/reader', docsUrl: 'https://jina.ai/reader', purpose: 'Reads any public web page as clean text', guild: 'archive', needsKey: true, envKey: 'JINA_API_KEY', throttle: { minIntervalMs: 500, maxConcurrent: 2 } },
  { id: 'firecrawl', name: 'Firecrawl', homepage: 'https://www.firecrawl.dev', docsUrl: 'https://docs.firecrawl.dev', purpose: 'Crawls a whole website into clean pages', guild: 'forge', needsKey: true, envKey: 'FIRECRAWL_API_KEY', throttle: { minIntervalMs: 2000, maxConcurrent: 1 } },
  { id: 'openrouter', name: 'OpenRouter', homepage: 'https://openrouter.ai', docsUrl: 'https://openrouter.ai/docs', purpose: 'The App Builder model and designed images with text (Gemini image)', guild: 'atelier', needsKey: true, envKey: 'OPENROUTER_API_KEY', throttle: { minIntervalMs: 500, maxConcurrent: 3 } },
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
  { id: 'adzuna', name: 'Adzuna', homepage: 'https://www.adzuna.com', docsUrl: 'https://developer.adzuna.com', purpose: 'Live job ads in 19 countries, with salaries where the ad has one', guild: 'scriptorium', needsKey: true, envKey: 'ADZUNA_APP_KEY', throttle: { minIntervalMs: 1000, maxConcurrent: 1 } },
  { id: 'groq', name: 'Groq (Whisper)', homepage: 'https://groq.com', docsUrl: 'https://console.groq.com/docs/speech-to-text', purpose: 'Transcribes audio and video into text and subtitles (Whisper large-v3 turbo, files up to 25 MB)', guild: 'theatre', needsKey: true, envKey: 'GROQ_API_KEY', throttle: { minIntervalMs: 2000, maxConcurrent: 1 } },
  { id: 'ocrspace', name: 'OCR.space', homepage: 'https://ocr.space', docsUrl: 'https://ocr.space/OCRAPI', purpose: 'Reads the text in photos, receipts and PDFs (free plan: files up to 1 MB, PDFs up to 3 pages)', guild: 'treasury', needsKey: true, envKey: 'OCRSPACE_API_KEY', throttle: { minIntervalMs: 1500, maxConcurrent: 1 } },
  { id: 'urlscan', name: 'urlscan.io', homepage: 'https://urlscan.io', docsUrl: 'https://docs.urlscan.io', purpose: 'Opens a suspicious link in a sandbox and reports what it loads (scans are unlisted, never public)', guild: 'forge', needsKey: true, envKey: 'URLSCAN_API_KEY', throttle: { minIntervalMs: 2000, maxConcurrent: 2 } },
  { id: 'companieshouse', name: 'Companies House', homepage: 'https://find-and-update.company-information.service.gov.uk', docsUrl: 'https://developer.company-information.service.gov.uk', purpose: 'Official UK company register: status, officers and filings', guild: 'bazaar', needsKey: true, envKey: 'COMPANIES_HOUSE_API_KEY', throttle: { minIntervalMs: 600, maxConcurrent: 2 } },
  { id: 'usda', name: 'USDA FoodData Central', homepage: 'https://fdc.nal.usda.gov', docsUrl: 'https://fdc.nal.usda.gov/api-guide', purpose: 'Nutrient values per 100 g for foods and ingredients', guild: 'archive', needsKey: true, envKey: 'USDA_API_KEY', throttle: { minIntervalMs: 500, maxConcurrent: 2 } },
  { id: 'elevenlabs', name: 'ElevenLabs', homepage: 'https://elevenlabs.io', docsUrl: 'https://elevenlabs.io/docs/api-reference/text-to-speech/convert', purpose: 'Recorded voice-overs as MP3 (small free monthly allowance)', guild: 'theatre', needsKey: true, envKey: 'ELEVENLABS_API_KEY', throttle: { minIntervalMs: 1500, maxConcurrent: 1 } },
  { id: 'brandfetch', name: 'Brandfetch', homepage: 'https://brandfetch.com', docsUrl: 'https://docs.brandfetch.com/reference/brand-api', purpose: 'Logos, brand colours and fonts of a company (each domain is looked up once and kept)', guild: 'atelier', needsKey: true, envKey: 'BRANDFETCH_API_KEY', throttle: { minIntervalMs: 1500, maxConcurrent: 1 } },
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
