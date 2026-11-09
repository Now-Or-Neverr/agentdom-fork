// Barrel for credentialed data & research clients (Tavily, Exa, Jina, Firecrawl, GNews, YouTube, Finnhub, FRED, Wolfram, CourtListener, Geoapify, PageSpeed, GitHub read).
// Every function throws a clear Error when its key is missing from .env, and every result carries
// `sourceUrl` (a public page a human can open) and `fetchedAt`. Keys never appear in results or logs.

// Grand Archive
export { tavilySearch, type WebSearch, type WebHit } from './tavily';
export { readUrl, READ_MAX_CHARS, type PageText } from './jina';
// Forge
export { scrapeUrl, crawlSite, CRAWL_MAX_PAGES, type ScrapedPage, type Crawl } from './firecrawl';
export { auditSite, pagespeedPage, type SiteAudit } from './pagespeed';
export {
  parseGithubRepo,
  repoInfo,
  repoTree,
  repoFile,
  repoReadme,
  repoCommits,
  FILE_MAX_BYTES,
  TREE_MAX_ENTRIES,
  type GithubRepoRef,
  type RepoInfo,
  type RepoTree,
  type RepoFile,
  type RepoCommits,
} from './github-read';
// Grand Bazaar
export { exaSearch, exaFindSimilar, EXA_CATEGORIES, type ExaCategory, type ExaResults, type ExaHit } from './exa';
export { geoapifyGeocode, localBusinesses, isPlaceCategory, normalizePlaceCategory, PLACE_CATEGORIES, osmPoint, type GeoPlace, type LocalBusiness, type LocalBusinesses } from './geoapify';
// Heralds' Tower
export { newsTop, newsSearch, GNEWS_CATEGORIES, type GnewsCategory, type NewsArticle, type NewsList } from './gnews';
export { youtubeTrending, youtubeSearch, type YtVideo, type YtVideoList } from './youtube';
// Royal Treasury
export { stockQuote, companyProfile, companyNews, isTicker, type StockQuote, type CompanyProfile, type CompanyNews } from './finnhub';
export { fredSearch, fredSeries, isSeriesId, FRED_POPULAR, type FredSearch, type FredObservations, type FredSeriesInfo } from './fred';
export { askWolfram, wolframPage, WOLFRAM_MAX_INPUT, type WolframAnswer } from './wolfram';
// High Court
export { caseLawSearch, type CaseSearch, type CaseHit } from './courtlistener';
// Scriptorium (jobs)
export { jobSearch, ADZUNA_COUNTRIES, type AdzunaCountry, type JobListing, type JobSearch } from './adzuna';
// Treasury / Archive (OCR)
export { ocrRead, OCR_MAX_BYTES, type OcrText } from './ocrspace';
// Forge / Court (link scans)
export { scanUrl, urlscanScreenshot, type UrlScan } from './urlscan';
// Bazaar / Treasury (UK company register)
export { ukCompanySearch, ukCompanyProfile, isCompanyNumber, type UkCompanySearch, type UkCompanyHit, type UkCompanyProfile } from './companieshouse';
// Archive (nutrition)
export { nutritionLookup, type FoodSearch, type FoodHit, type FoodNutrient } from './usda';
// Atelier / Bazaar (brand assets, permanent cache)
export { brandLookup, normalizeDomain, brandCallsUsed, brandMaxCalls, type Brand, type BrandLogo } from './brandfetch';
// Observatory
export { nasaApod, nasaAsteroids, type Apod, type Asteroid, type AsteroidFeed } from './nasa';
export { airQuality, type AirQuality, type AirReading } from './openaq';
// Arena
export { footballStandings, footballMatches, isCompetition, FOOTBALL_COMPETITIONS, tmdbSearch, tmdbTrending, TMDB_ATTRIBUTION, musicChart, artistInfo, type Standings, type TableRow, type Match, type Matches, type Title, type TitleList, type ChartEntry, type MusicChart, type ArtistInfo } from './arena';
// Atelier (Unsplash photos)
export { unsplashSearch, unsplashTrackDownload, type UnsplashPhoto, type UnsplashSearch } from './unsplash';
// Heralds / Archive (newspapers: headline + summary + link only)
export { guardianSearch, nytTopStories, nytSearch, nytMostPopular, nytBestsellers, NYT_SECTIONS, type NytSection, type PressArticle, type PressList, type Bestseller, type Bestsellers } from './press';
