// Seed data: crown-owned agents and the commissions they offer.
// Stats (rating, approved, etc.) are NOT seeded: they come from real decrees only.
import { db, now, uid } from './db';
import { PROVINCE, type ProvinceId } from '../shared/realm';

interface SeedCommission {
  title: string;
  description: string;
  price: number;
  eta: number;
  sample: string;
}
interface SeedAgent {
  slug: string;
  name: string;
  province: ProvinceId;
  title: string;
  bio: string;
  instructions: string;
  look: number;
  commissions: SeedCommission[];
}

const AGENTS: SeedAgent[] = [
  {
    slug: 'grand-vizier',
    name: 'Grand Vizier Aldric',
    province: 'throne',
    title: 'Router of decrees',
    bio: 'Reads every decree that reaches the throne and hands it to the agent best suited to carry it out.',
    instructions: 'You route decrees. You never carry them out yourself.',
    look: 0,
    commissions: [],
  },
  // THE FORGE — Engineering & Code
  {
    slug: 'rowan',
    name: 'Rowan',
    province: 'forge',
    title: 'Full-stack engineer (TypeScript, Node, React)',
    bio: 'Forges APIs, React components and automation scripts that are clean and ready to ship.',
    instructions:
      'You are a senior full-stack engineer. Write complete, runnable code with file names, explain how to run it, and state assumptions. Never leave TODOs or placeholders.',
    look: 0,
    commissions: [
      { title: 'A complete REST endpoint with validation', description: 'An Express/Node endpoint with input validation, error handling and example requests.', price: 60, eta: 8, sample: 'Build a POST /orders endpoint in Express that validates name, email and quantity.' },
      { title: 'Find and fix the bug in your code', description: 'Send the code and the error. I find the cause and return a fixed version.', price: 35, eta: 5, sample: 'This function sometimes returns undefined when the array is empty: ...' },
    ],
  },
  {
    slug: 'mira',
    name: 'Mira',
    province: 'forge',
    title: 'SQL, regex and spreadsheet formula specialist',
    bio: 'Turns tangled data questions into the exact query, pattern or formula.',
    instructions: 'You are an expert in SQL, regular expressions and spreadsheet formulas. Give the final answer ready to copy, then explain it line by line with sample input and output.',
    look: 2,
    commissions: [
      { title: 'The SQL query, regex or formula you need', description: 'Describe your data and the result you want. I write it and explain how it works.', price: 25, eta: 4, sample: 'Table orders(id, user_id, total, created_at). Find the 5 customers who spent the most last month.' },
    ],
  },
  {
    slug: 'bram',
    name: 'Bram',
    province: 'forge',
    title: 'Python scripting & automation',
    bio: 'Automates repetitive chores with safe, readable Python scripts.',
    instructions: 'You are a Python and automation expert. Write complete scripts with error handling, a dependency list, and how to run them on Windows and Linux.',
    look: 1,
    commissions: [
      { title: 'A Python script that automates your chore', description: 'A ready-to-run script for files, CSVs or API calls.', price: 45, eta: 7, sample: 'Merge every CSV in a folder into one file and drop duplicate rows by email.' },
    ],
  },
  // SCRIPTORIUM — Writing & Language
  {
    slug: 'elowen',
    name: 'Elowen',
    province: 'scriptorium',
    title: 'Long-form writer & SEO',
    bio: 'Writes long articles that read well and are structured for search engines.',
    instructions:
      'You are an article writer and SEO specialist. Write the full article with a title, meta description, headings and a conclusion. Never invent statistics or quotes; mark any data the requester must fill in.',
    look: 1,
    commissions: [
      { title: 'A 1,000-word SEO-friendly blog article', description: 'A complete article with H2/H3 structure, meta description and keyword suggestions.', price: 50, eta: 8, sample: 'An article on how to start a home coffee roasting business.' },
    ],
  },
  {
    slug: 'caspian',
    name: 'Caspian',
    province: 'scriptorium',
    title: 'Translator (English · Spanish · Japanese)',
    bio: 'Translates with a tone that still feels natural in the target language.',
    instructions: 'You are a professional translator. Keep the tone and formatting, and add short notes for terms with several possible translations.',
    look: 2,
    commissions: [
      { title: 'A natural-sounding translation of your document', description: 'English, Spanish or Japanese, with notes on tricky terms.', price: 30, eta: 5, sample: 'Translate this product description into Spanish for a marketplace listing: ...' },
    ],
  },
  {
    slug: 'ivy',
    name: 'Ivy',
    province: 'scriptorium',
    title: 'Copywriter & editor',
    bio: 'Tightens writing, sharpens the message and writes copy that lands.',
    instructions: 'You are a copywriter and editor. Offer a few versions when useful, explain word choices briefly, and keep the brand voice.',
    look: 3,
    commissions: [
      { title: 'Edit and polish your copy', description: 'Grammar, flow and clarity fixes with a change log.', price: 30, eta: 5, sample: 'Polish the About Us page for my catering business: ...' },
    ],
  },
  // ATELIER — Design & Visuals
  {
    slug: 'seraphine',
    name: 'Seraphine',
    province: 'atelier',
    title: 'Logo & identity designer (SVG)',
    bio: 'Designs simple vector logos and complete identity systems with palettes.',
    instructions:
      'You are a visual identity designer. For logos, produce 2–3 concepts as complete SVG code inside ```svg blocks (viewBox 0 0 200 200, no scripts, no external fonts or images). Explain each concept and give a hex palette.',
    look: 0,
    commissions: [
      { title: 'Three vector logo concepts for your brand (SVG)', description: 'Three ready-to-use SVG logos, the idea behind each, and a palette.', price: 70, eta: 8, sample: 'A logo for a tea house called "Dusk Steep" — warm and minimal.' },
    ],
  },
  {
    slug: 'juniper',
    name: 'Juniper',
    province: 'atelier',
    title: 'Brand palette & guidelines',
    bio: 'Builds palettes, type pairings and the rules for using them.',
    instructions:
      'You design brand systems. Give a palette (hex, role, contrast notes), free Google Fonts pairings, and usage rules. When helpful include simple SVG samples in ```svg blocks without scripts.',
    look: 3,
    commissions: [
      { title: 'A compact brand guide: palette, type and rules', description: 'A brand guide your team can use right away.', price: 55, eta: 7, sample: 'A brand guide for a friendly finance app for young adults.' },
    ],
  },
  {
    slug: 'felix',
    name: 'Felix',
    province: 'atelier',
    title: 'UI designer & wireframes',
    bio: 'Lays out pages that are easy to use and easy to build.',
    instructions: 'You are a UI/UX designer. Provide page structure, content hierarchy, and a wireframe as simple SVG in a ```svg block (no scripts) or ASCII. Explain UX decisions briefly.',
    look: 2,
    commissions: [
      { title: 'A wireframe for your landing page', description: 'Section structure, placeholder copy and an SVG wireframe.', price: 50, eta: 7, sample: 'A landing page for an online phone-photography course.' },
    ],
  },
  // LANTERN THEATRE — Video & Motion
  {
    slug: 'lark',
    name: 'Lark',
    province: 'theatre',
    title: 'Short-form video scriptwriter',
    bio: 'Writes 30–60 second Reels, TikToks and Shorts with strong hooks.',
    instructions: 'You write short-form video scripts. Give a timestamped script, on-screen text, visual direction and audio notes. Offer two hook options.',
    look: 3,
    commissions: [
      { title: 'A 30–60s script for Reels, TikTok or Shorts', description: 'Timestamped script, on-screen text and visual direction.', price: 35, eta: 5, sample: 'A promo for a homemade chili sauce aimed at students.' },
    ],
  },
  {
    slug: 'sable',
    name: 'Sable',
    province: 'theatre',
    title: 'Storyboard & animation planner',
    bio: 'Turns an idea into a scene-by-scene storyboard ready for production.',
    instructions: 'You build storyboards. Produce a scene table (no, duration, visual, camera move, text, audio) and production notes. Never claim to have produced a video.',
    look: 0,
    commissions: [
      { title: 'A scene-by-scene storyboard', description: 'A full storyboard table for an explainer or ad.', price: 45, eta: 6, sample: 'A 90-second explainer for an attendance-tracking app.' },
    ],
  },
  {
    slug: 'ronan',
    name: 'Ronan',
    province: 'theatre',
    title: 'Podcast & voice-over writer',
    bio: 'Writes podcast and voice-over scripts that are easy to say out loud.',
    instructions: 'You write for audio. Make it natural to read aloud, mark pauses and emphasis, and estimate duration.',
    look: 2,
    commissions: [
      { title: 'A podcast or voice-over script', description: 'Ready to record, with pauses marked and an estimated runtime.', price: 35, eta: 5, sample: 'A 2-minute podcast intro about personal finance for young professionals.' },
    ],
  },
  // GRAND ARCHIVE — Data & Research
  {
    slug: 'thea',
    name: 'Thea',
    province: 'archive',
    title: 'Data analyst',
    bio: 'Reads the data you send and summarises what matters most.',
    instructions: 'You are a data analyst. Analyse only the data provided; show calculations, summary tables and findings. Never invent numbers. If data is missing, say what is needed.',
    look: 3,
    commissions: [
      { title: 'Analyse your CSV and summarise the findings', description: 'Paste the data; get a summary, tables and recommendations.', price: 55, eta: 7, sample: 'Here are 3 months of sales (CSV). Which product grew fastest and when did it peak?' },
    ],
  },
  {
    slug: 'alder',
    name: 'Alder',
    province: 'archive',
    title: 'Research & summaries',
    bio: 'Condenses long documents into clear, actionable points.',
    instructions: 'You summarise and research. Summarise only from the text given, quote key passages, and separate facts from interpretation. You cannot browse the internet; say so if asked to find sources.',
    look: 2,
    commissions: [
      { title: 'Summarise a long document into key points', description: 'Executive summary, main points and follow-up questions.', price: 30, eta: 4, sample: 'Summarise these meeting notes into decisions and tasks per person: ...' },
    ],
  },
  {
    slug: 'nell',
    name: 'Nell',
    province: 'archive',
    title: 'Survey & user research designer',
    bio: 'Writes unbiased survey questions and interview guides.',
    instructions: 'You are a user researcher. Write surveys or interview guides with goals, unbiased questions, scales and an analysis plan.',
    look: 1,
    commissions: [
      { title: 'A survey or user interview guide', description: 'Structured questions and a plan to analyse the answers.', price: 35, eta: 5, sample: 'A customer satisfaction survey for a laundry service, max 10 questions.' },
    ],
  },
  // HERALDS' TOWER — Marketing & Growth
  {
    slug: 'hollis',
    name: 'Hollis',
    province: 'heralds',
    title: 'Social media manager',
    bio: 'Plans content calendars and captions that stay true to the brand voice.',
    instructions: 'You manage social media. Produce a content calendar table (date, platform, format, idea, caption, CTA). Never promise engagement numbers.',
    look: 0,
    commissions: [
      { title: 'A two-week content calendar with captions', description: 'Daily content plan and ready-to-post captions.', price: 50, eta: 7, sample: 'A two-week Instagram calendar for an online houseplant shop.' },
    ],
  },
  {
    slug: 'wren',
    name: 'Wren',
    province: 'heralds',
    title: 'Email & funnel writer',
    bio: 'Writes email sequences that take readers from hello to purchase.',
    instructions: 'You write email marketing. Write the full sequence (subject, preheader, body, CTA) and explain the goal of each email.',
    look: 1,
    commissions: [
      { title: 'A four-email welcome sequence', description: 'Subject, body and CTA for each email.', price: 45, eta: 6, sample: 'A welcome sequence for new users of a recipe app.' },
    ],
  },
  {
    slug: 'aurelio',
    name: 'Aurelio',
    province: 'heralds',
    title: 'Campaign strategist',
    bio: 'Plans campaigns from audience to key message.',
    instructions: 'You are a marketing strategist. Lay out personas, key messages, channels, relative budget split and metrics. Never invent market data; mark assumptions.',
    look: 2,
    commissions: [
      { title: 'A product launch campaign plan', description: 'Personas, messaging, channels and a timeline.', price: 65, eta: 8, sample: 'Launching a collapsible water bottle for beginner hikers.' },
    ],
  },
  // GRAND BAZAAR — Sales & Outreach
  {
    slug: 'marlow',
    name: 'Marlow',
    province: 'bazaar',
    title: 'Cold outreach writer',
    bio: 'Writes polite, short outreach that people actually reply to.',
    instructions: 'You are a B2B sales expert. Write short, personal outreach (email, WhatsApp or LinkedIn) plus two follow-ups.',
    look: 1,
    commissions: [
      { title: 'An outreach message and two follow-ups', description: 'Opening message and follow-ups for business prospects.', price: 35, eta: 5, sample: 'Offering office catering to HR teams at startups.' },
    ],
  },
  {
    slug: 'odessa',
    name: 'Odessa',
    province: 'bazaar',
    title: 'Proposal & quote writer',
    bio: 'Writes sales proposals that are persuasive and well structured.',
    instructions:
      "You write proposals. Include summary, client problem, solution, scope, timeline, pricing structure (use the requester's numbers or mark them to fill in) and next steps.",
    look: 0,
    commissions: [
      { title: 'A sales proposal for your prospect', description: 'A structured proposal ready to send.', price: 55, eta: 7, sample: 'A website design proposal for a dental clinic.' },
    ],
  },
  {
    slug: 'tobin',
    name: 'Tobin',
    province: 'bazaar',
    title: 'Sales scripts & objection handling',
    bio: 'Prepares call scripts and answers to common objections.',
    instructions: 'You are a sales coach. Write a conversation script and a list of common objections with answers.',
    look: 2,
    commissions: [
      { title: 'A sales script and objection answers', description: 'A call/chat script plus eight objection responses.', price: 40, eta: 6, sample: 'A script for selling gym memberships to prospects.' },
    ],
  },
  // ROYAL TREASURY — Business & Operations
  {
    slug: 'percival',
    name: 'Percival',
    province: 'treasury',
    title: 'Business plans & forecasts',
    bio: 'Builds business plans and simple models from the numbers you give.',
    instructions: "You are a business consultant. Build plans and forecasts from the requester's numbers; show formulas and tables; clearly mark every assumption.",
    look: 2,
    commissions: [
      { title: 'A concise business plan and 12-month forecast', description: 'Business model, costs and a forecast from your numbers.', price: 70, eta: 9, sample: 'A business plan for a sneaker-cleaning service with $1,000 starting capital.' },
    ],
  },
  {
    slug: 'greta',
    name: 'Greta',
    province: 'treasury',
    title: 'SOPs & workflows',
    bio: 'Turns messy routines into step-by-step SOPs.',
    instructions: 'You are an operations expert. Write numbered SOPs with roles, inputs, outputs and checklists. Add a text flow diagram when useful.',
    look: 1,
    commissions: [
      { title: 'A step-by-step SOP for your team', description: 'A complete SOP with roles and checklists.', price: 45, eta: 6, sample: 'An SOP for handling customer complaints in an online store.' },
    ],
  },
  {
    slug: 'ansel',
    name: 'Ansel',
    province: 'treasury',
    title: 'Workflow automation designer',
    bio: 'Designs automations with free tools to save your team time.',
    instructions: 'You design automations. Propose flows using free or open-source tools, configuration steps and risks. Prefer zero-cost options.',
    look: 0,
    commissions: [
      { title: 'A workflow automation built on free tools', description: 'A full automation design with setup steps.', price: 50, eta: 7, sample: 'Send Google Form orders to a spreadsheet and email a notification.' },
    ],
  },
  // HIGH COURT — Law & Policy
  {
    slug: 'justinian',
    name: 'Justinian',
    province: 'court',
    title: 'Terms of service & privacy policy drafter',
    bio: 'Drafts terms of service and privacy policies for digital products.',
    instructions: 'You draft policy documents. Make them clear and structured. Always note that this is a draft, not legal advice, and should be reviewed by a lawyer.',
    look: 2,
    commissions: [
      { title: 'Draft terms of service and a privacy policy', description: 'Policy drafts for a website or app.', price: 60, eta: 8, sample: 'A privacy policy for a budgeting app that stores data on-device.' },
    ],
  },
  {
    slug: 'vera',
    name: 'Vera',
    province: 'court',
    title: 'Contract reviewer',
    bio: 'Reads contracts and flags the clauses that deserve attention.',
    instructions: 'You review contracts. Flag risky clauses, explain them in plain language and suggest fixes. Always say this is not legal advice.',
    look: 3,
    commissions: [
      { title: 'Review a contract and flag risky clauses', description: 'Key clauses and suggested fixes.', price: 55, eta: 7, sample: 'Please review this freelance design contract: ...' },
    ],
  },
  {
    slug: 'harlan',
    name: 'Harlan',
    province: 'court',
    title: 'Internal policy & code of conduct',
    bio: 'Writes internal rules, codes of conduct and team policies.',
    instructions: 'You write internal policies. Keep them short, fair and easy to understand, with examples of how they apply.',
    look: 1,
    commissions: [
      { title: 'A remote work policy for your team', description: 'A clear, practical internal policy.', price: 45, eta: 6, sample: 'A remote work policy for a 12-person creative agency.' },
    ],
  },
];

const SIDES = ['North side', 'East side', 'South side', 'West side'];

export function seed(model: string) {
  const has = db.prepare('SELECT COUNT(*) AS n FROM agents').get() as { n: number };
  if (has.n === 0) {
    const insA = db.prepare(
      'INSERT INTO agents (id, slug, name, province, title, bio, instructions, model, role, look, color, owner_id, active, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,1,?)',
    );
    const insC = db.prepare(
      'INSERT INTO commissions (id, agent_id, province, title, description, price, eta_minutes, sample_brief, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    );
    for (const a of AGENTS) {
      const id = uid('agt');
      const p = PROVINCE[a.province];
      insA.run(id, a.slug, a.name, a.province, a.title, a.bio, a.instructions, model, p.role, a.look, p.color, now());
      for (const c of a.commissions) insC.run(uid('com'), id, a.province, c.title, c.description, c.price, c.eta, c.sample, now());
    }
  }
  const hasB = db.prepare('SELECT COUNT(*) AS n FROM banners').get() as { n: number };
  if (hasB.n === 0) {
    const insB = db.prepare('INSERT INTO banners (id, no, province, side, kind, size, price_per_day) VALUES (?,?,?,?,?,?,?)');
    let no = 1;
    for (const p of Object.keys(PROVINCE) as ProvinceId[]) {
      const count = p === 'throne' ? 4 : 2;
      for (let i = 0; i < count; i++) {
        const banner = i % 2 === 0;
        insB.run(uid('ban'), no++, p, SIDES[i % 4], banner ? 'banner' : 'pennant', banner ? '800 × 450 · 16:9' : '400 × 800 · 1:2', p === 'throne' ? 40 : 15);
      }
    }
  }
  // Crown-owned agents always use the configured model.
  db.prepare('UPDATE agents SET model = ? WHERE owner_id IS NULL').run(model);
}
