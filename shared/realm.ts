// Provinces (guilds) of Agentdom. Shared by server (seed, routing) and client (map, UI).

export type ProvinceId =
  | 'throne'
  | 'forge'
  | 'scriptorium'
  | 'atelier'
  | 'theatre'
  | 'archive'
  | 'heralds'
  | 'bazaar'
  | 'treasury'
  | 'court';

// Character archetypes. Every agent is drawn as one of these.
export type Role =
  | 'vizier'
  | 'smith'
  | 'scribe'
  | 'painter'
  | 'bard'
  | 'archivist'
  | 'herald'
  | 'merchant'
  | 'steward'
  | 'magistrate';

export interface Province {
  id: ProvinceId;
  no: string; // "01".."10"
  name: string; // province name, e.g. "The Forge"
  craft: string; // work category, e.g. "Engineering & Code"
  hall: string; // landmark building
  hallLine: string; // one line about the landmark
  tagline: string; // marketing line
  color: string; // accent (hex)
  icon: string; // lucide icon name
  role: Role; // default archetype of its agents
  pos: [number, number]; // map coordinates (x, z)
}

export const PROVINCES: Province[] = [
  {
    id: 'throne',
    no: '01',
    name: 'Imperial Throne',
    craft: 'The Crown',
    hall: "Grand Vizier's Hall",
    hallLine: 'Reads every decree and sends it to the right agent',
    tagline: 'The heart of the realm. Every road leads here.',
    color: '#D4A54A',
    icon: 'Crown',
    role: 'vizier',
    pos: [0, 0],
  },
  {
    id: 'forge',
    no: '02',
    name: 'The Forge',
    craft: 'Engineering & Code',
    hall: 'Codeforge',
    hallLine: 'Where APIs, scripts and web pages are hammered into shape',
    tagline: 'Software, forged and tempered.',
    color: '#3FA58C',
    icon: 'Hammer',
    role: 'smith',
    pos: [-13, -15],
  },
  {
    id: 'scriptorium',
    no: '03',
    name: 'Scriptorium',
    craft: 'Writing & Language',
    hall: 'Hall of Quills',
    hallLine: 'Articles, scripts and translations, edited by hand',
    tagline: 'Words that carry weight.',
    color: '#D9A441',
    icon: 'Feather',
    role: 'scribe',
    pos: [0, -20],
  },
  {
    id: 'atelier',
    no: '04',
    name: 'The Atelier',
    craft: 'Design & Visuals',
    hall: 'House of Pigments',
    hallLine: 'Logos, palettes and visual identities',
    tagline: 'Every idea deserves a face.',
    color: '#C9476B',
    icon: 'Palette',
    role: 'painter',
    pos: [13, -15],
  },
  {
    id: 'theatre',
    no: '05',
    name: 'Lantern Theatre',
    craft: 'Video & Motion',
    hall: 'Shadow Stage',
    hallLine: 'Video scripts, storyboards and voice-overs',
    tagline: 'Stories told in light and motion.',
    color: '#D2553A',
    icon: 'Clapperboard',
    role: 'bard',
    pos: [20, -3],
  },
  {
    id: 'archive',
    no: '06',
    name: 'Grand Archive',
    craft: 'Data & Research',
    hall: 'Tower of Scrolls',
    hallLine: 'Analysis, research and summaries',
    tagline: 'Knowledge, catalogued and understood.',
    color: '#4A6FB5',
    icon: 'Library',
    role: 'archivist',
    pos: [-20, -3],
  },
  {
    id: 'heralds',
    no: '07',
    name: "Heralds' Tower",
    craft: 'Marketing & Growth',
    hall: 'Drum Tower',
    hallLine: 'Campaigns, social posts and announcements',
    tagline: 'Let the whole realm hear it.',
    color: '#4E9F5C',
    icon: 'Megaphone',
    role: 'herald',
    pos: [-7, 19],
  },
  {
    id: 'bazaar',
    no: '08',
    name: 'Grand Bazaar',
    craft: 'Sales & Outreach',
    hall: "Merchants' Guild",
    hallLine: 'Offers, proposals and outreach letters',
    tagline: 'Where deals are made.',
    color: '#8B5EBF',
    icon: 'Store',
    role: 'merchant',
    pos: [7, 19],
  },
  {
    id: 'treasury',
    no: '09',
    name: 'Royal Treasury',
    craft: 'Business & Operations',
    hall: 'Counting House',
    hallLine: 'Business plans, SOPs and workflows',
    tagline: 'Order, ledgers and steady growth.',
    color: '#C7832B',
    icon: 'Landmark',
    role: 'steward',
    pos: [17, 10],
  },
  {
    id: 'court',
    no: '10',
    name: 'High Court',
    craft: 'Law & Policy',
    hall: 'Hall of Scales',
    hallLine: 'Policy drafts, terms and contract reviews',
    tagline: 'Rules, weighed with care.',
    color: '#7D8796',
    icon: 'Scale',
    role: 'magistrate',
    pos: [-17, 10],
  },
];

export const PROVINCE: Record<ProvinceId, Province> = Object.fromEntries(PROVINCES.map((p) => [p.id, p])) as Record<
  ProvinceId,
  Province
>;

// Provinces where work happens (everything except the Throne).
export const GUILDS = PROVINCES.filter((p) => p.id !== 'throne');

export const isProvince = (x: unknown): x is ProvinceId => typeof x === 'string' && x in PROVINCE;

// Agent ranks, earned from approved decrees.
export const RANKS = [
  { id: 'squire', name: 'Squire', min: 0 },
  { id: 'knight', name: 'Knight', min: 3 },
  { id: 'baron', name: 'Baron', min: 10 },
  { id: 'duke', name: 'Duke', min: 25 },
] as const;

export type RankName = (typeof RANKS)[number]['name'];

export function rankFor(approved: number) {
  let r: (typeof RANKS)[number] = RANKS[0];
  for (const x of RANKS) if (approved >= x.min) r = x;
  return r;
}

export function nextRank(approved: number) {
  return RANKS.find((r) => r.min > approved) ?? null;
}

// Keyword router used when the Grand Vizier (AI) is offline, and for the live
// routing demo on the landing page.
export const ROUTE_KEYWORDS: Record<Exclude<ProvinceId, 'throne'>, string[]> = {
  forge: ['code', 'api', 'bug', 'website', 'app', 'sql', 'regex', 'python', 'script', 'react', 'database', 'formula', 'excel', 'spreadsheet', 'endpoint', 'function', 'deploy', 'phishing', 'scam link', 'suspicious link', 'repo', 'github', 'lighthouse'],
  scriptorium: ['article', 'write', 'blog', 'translate', 'essay', 'copy', 'caption', 'edit', 'proofread', 'text', 'story', 'newsletter', 'resume', 'résumé', ' cv', 'cover letter', 'job opening', 'job search', 'job ad'],
  atelier: ['logo', 'design', 'color', 'palette', 'brand', 'ui', 'wireframe', 'icon', 'svg', 'layout', 'font', 'brand teardown', 'product shot'],
  theatre: ['video', 'reel', 'tiktok', 'shorts', 'storyboard', 'animation', 'podcast', 'voice', 'script for', 'transcrib', 'subtitle', 'voice-over', 'voiceover', 'film', 'promo'],
  archive: ['data', 'analy', 'csv', 'summar', 'research', 'survey', 'report', 'insight', 'nutrition', 'calorie', 'research paper', 'papers on', 'citation', 'fact-check', 'fact check'],
  heralds: ['marketing', 'instagram', 'content', 'campaign', 'email', 'ads', 'social', 'launch', 'seo', 'growth', 'youtube', 'trend', 'trending'],
  bazaar: ['sell', 'sales', 'offer', 'proposal', 'prospect', 'client', 'pitch', 'outreach', 'lead', 'cold', 'companies house', 'uk company', 'leads'],
  treasury: ['business', 'sop', 'operation', 'automat', 'forecast', 'budget', 'plan', 'workflow', 'pricing', 'process', 'invoice', 'receipt', 'stock price', 'share price', 'ticker', 'price'],
  court: ['contract', 'policy', 'privacy', 'terms', 'legal', 'law', 'compliance', 'agreement', 'nda', 'case law', 'regulation'],
};

export function routeByKeywords(text: string): { province: Exclude<ProvinceId, 'throne'>; hits: string[] } {
  const s = text.toLowerCase();
  let best: Exclude<ProvinceId, 'throne'> = 'scriptorium';
  let bestHits: string[] = [];
  for (const [p, keys] of Object.entries(ROUTE_KEYWORDS) as [Exclude<ProvinceId, 'throne'>, string[]][]) {
    const hits = keys.filter((k) => s.includes(k));
    if (hits.length > bestHits.length) {
      best = p;
      bestHits = hits;
    }
  }
  return { province: best, hits: bestHits };
}
