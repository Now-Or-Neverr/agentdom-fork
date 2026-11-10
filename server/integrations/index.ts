// Integrations barrel: every external API the realm uses, plus local video rendering.
//
// Conventions for every client function:
// - the `ctx: CallContext` argument says what the call is for ({ context: 'decree'|'duty'|'workshop'|'realm', ref? })
//   and is written to the api_calls log. Do NOT put user ids in `ref` (the log is public);
//   use a decree id, duty kind or tool name.
// - results are small, typed and always carry `sourceUrl` (a page a human can open) and
//   `fetchedAt` (ISO time the data really left the upstream API; cache hits keep it).
// - failures throw: UpstreamError (HTTP/network/timeout, has .provider and .status) or a plain
//   Error for bad input. Nothing is ever faked.

export { fetchJson, fetchText, fetchBuffer, nextSlotIn, UpstreamError, USER_AGENT, qs, safeEndpoint, type CallContext, type CallContextKind, type Fetched, type RequestOpts } from './http';
export { PROVIDERS, PROVIDER, enabled, providerKey, type Provider } from './registry';
export { providerStatuses, recentCalls, type ProviderStatus, type ApiCallRow } from './stats';

// Grand Archive
export { wikiSearch, wikiSummary, wikiOnThisDay, type WikiSearch, type WikiHit, type WikiSummary, type OnThisDay, type OnThisDayEvent } from './wikipedia';
export { openAlexWorks, type WorksSearch, type Work } from './openalex';
export { arxivSearch, type PreprintSearch, type Preprint } from './arxiv';
export { openLibrarySearch, type BookSearch, type Book } from './openlibrary';
// Heralds' Tower
export { hnFrontPage, hnSearch, type Stories, type Story } from './hackernews';
export { mastodonTrendingTags, mastodonTrendingLinks, type TrendTags, type TrendTag, type TrendLinks, type TrendLink } from './mastodon';
// Royal Treasury / Grand Bazaar
export { fxLatest, fxConvert, fxSeries, fxCurrencies, isCurrency, type FxLatest, type FxConversion, type FxSeries, type FxCurrencies } from './frankfurter';
export { wbIndicator, WB_INDICATORS, isCountryCode, isIndicatorCode, type Indicator } from './worldbank';
export { publicHolidays, nextHolidays, holidayCountries, festival, type Holidays, type Holiday, type Countries } from './nager';
// Scriptorium
export { define, relatedWords, type Definition, type WordList, type WordRelation } from './words';
export { checkGrammar, GRAMMAR_MAX_BYTES, type GrammarCheck, type GrammarIssue } from './languagetool';
// High Court
export { federalRegister, type FrSearch, type FrDocument } from './federalregister';
// Imperial Throne (realm weather)
export { currentWeather, geocode, weatherKind, weatherText, weatherSourceUrl, realmLocation, round1, validLatLon, type Place } from './openmeteo';
// Atelier
export { generateImage, imageQueueWaitMs, ImageBusyError, IMAGE_PROMPT_MAX, type GeneratedImage, type ImageOpts } from './pollinations';
// Observatory (no key)
export { earthquakes, issPosition, QUAKE_LEVELS, QUAKE_PERIODS, type Quake, type QuakeFeed, type QuakeLevel, type QuakePeriod, type IssPosition } from './earth';
export { nasaImages, type NasaImage, type NasaImageSearch } from './nasa';
// Apothecary (no key)
export { drugLabel, fdaRecalls, pubmedSearch, trialSearch, HEALTH_NOTE, RECALL_KINDS, type RecallKind, type DrugLabel, type DrugLabels, type Recall, type Recalls, type PubmedArticle, type PubmedSearch, type Trial, type TrialSearch } from './health';
// Arena (no key)
export { musicBrainzArtist, gameDeals, freeGames, FREE_GAME_PLATFORMS, type GameDeal, type GameDeals, type FreeGame, type FreeGames } from './arena';
// Forge (vulnerabilities) / Bazaar (recipes)
export { osvQuery, OSV_ECOSYSTEMS, type OsvEcosystem, type Vuln, type VulnReport } from './osv';
export { mealSearch, type Meal, type MealSearch } from './mealdb';
// No-key update (Nov 2026)
export { spaceWeather, upcomingLaunches, spaceNews, sunTimes, type SpaceWeather, type KpReading, type NoaaScale, type SolarFlare, type RocketLaunch, type LaunchList, type SpaceArticle, type SpaceNews, type SunTimes } from './space';
export { f1Season, chessBoard, tvGuide, animeList, deezerChart, trivia, CHESS_PERFS, TRIVIA_CATEGORIES, TRIVIA_DIFFICULTIES, TVMAZE_ATTRIBUTION, type ChessPerf, type TriviaDifficulty, type F1Season, type F1Race, type F1DriverRow, type F1TeamRow, type F1Result, type ChessBoard, type ChessPlayer, type ChessPuzzle, type TvGuide, type TvShow, type TvEpisode, type Anime, type AnimeList, type MusicTop, type ChartTrack, type TriviaSet, type TriviaQuestion } from './sport';
export { gutenbergBooks, poems, memoryTranslate, memoryBudget, MEMORY_MAX_CHARS, type FreeBook, type FreeBooks, type Poem, type Poems, type MemoryTranslation, type MemoryMatch } from './letters';
export { crossref, isDoi, wikidata, archiveSearch, waybackSnapshot, ARCHIVE_MEDIA, type ArchiveMedia, type CrossrefWork, type CrossrefResult, type WikidataResult, type WikidataEntity, type WikidataFact, type WikidataHit, type ArchiveItem, type ArchiveSearch, type WaybackSnapshot } from './scholar';
export { packageInfo, isPackageName, kevCatalog, cveLookup, domainLookup, isDomain, CVE_RE, PACKAGE_ECOSYSTEMS, type PackageEcosystem, type PackageInfo, type KevEntry, type KevList, type CveRecord, type DomainRecord } from './devtools';
export { mostRead, devArticles, lobsters, WIKI_LANGS, TAG_RE, type MostRead, type ReadArticle, type DevArticle, type DevArticles, type LobsterStory, type LobsterStories } from './trending';
export { foodFacts, isBarcode, healthTopics, type FoodProduct, type FoodResult, type FoodNutrients, type HealthTopic, type HealthTopics } from './food';
export { usFiscal, type UsFiscal, type DebtDay, type TreasuryRate } from './fiscal';
export { AGENTDOM_CA, CHAIN as ROBINHOOD_CHAIN, STOCK_TICKERS, agentdomStats, chainPulse, checkAddress, checkTxHash, blockscoutOn, chainEconomy, chainStats, codexOn, corporateActions, decodeSelector, goplusCheck, newLaunches, sourcifyMatch, stockCandles, tokenChart, tokenMoves, tokenPrices, walletNfts, walletPortfolio, walletTransfers, type ChainEconomy, type GoPlusReport, type Launch, type Portfolio, type TokenChart, type TokenMoves, type TransferRow, type Candle, explainTx, tokenHolders, type HolderRow, type TokenHolders, type TxRow, formatTokens, inspectAddress, marketPulse, oraclePrices, scanContract, stockBoard, stockDetail, stockTokenList, tokenBalance, type CorporateAction, type MarketPulse, type OracleBoard, type StockDetail, type AddressReport, type AgentdomStats, type ChainPulse, type ContractReport, type StockBoard, type TxExplained } from './robinhood';
// Lantern Theatre (local ffmpeg, no external API)
export { makeSlideshow, type SlideshowInput, type Slideshow } from './video';

// Credentialed providers (keys in .env). Data & research clients:
export * from "./pro-data";
// Media & action clients (images, audio, video sources, publishing, notifications):
export * from "./pro-media";
export { designImage, orImageToday, orImageTotal, OR_ASPECTS, OR_IMAGE_MODEL, OR_IMAGE_PROMPT_MAX, type OrAspect, type DesignedImage } from "./orimage";
