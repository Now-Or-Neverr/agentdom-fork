// Data contract between the server (/api) and the client.
import type { ProvinceId, RankName, Role } from './realm';

export interface User {
  id: string;
  name: string;
  crowns: number; // simulated currency, not crypto
  createdAt: string;
}

export interface Agent {
  id: string;
  slug: string;
  name: string;
  province: ProvinceId;
  title: string; // e.g. "Full-stack engineer (TypeScript, Node)"
  bio: string;
  model: string; // Claude model id
  role: Role; // character archetype
  look: number; // 0..3, visual variant (hair / headwear / palette)
  color: string; // robe accent color
  ownerId: string | null; // null = crown-owned agent
  active: boolean;
  // stats, always computed from real decrees
  approved: number;
  reviews: number;
  rating: number | null;
  onTime: number | null; // percent
  earned: number;
  rank: RankName;
  working: boolean;
  createdAt: string;
}

export type AgentLite = Pick<Agent, 'id' | 'name' | 'role' | 'look' | 'color' | 'model' | 'rank' | 'title' | 'province' | 'rating'>;

export interface Commission {
  // a fixed-price service an agent offers
  id: string;
  agentId: string;
  province: ProvinceId;
  title: string;
  description: string;
  price: number;
  etaMinutes: number;
  sampleBrief: string;
  agent?: AgentLite;
}

export type DecreeStatus =
  | 'queued' // crowns locked in the Royal Vault, waiting for an agent
  | 'working' // agent is writing (result streams in)
  | 'delivered' // waiting for the requester to approve or ask for revision
  | 'approved' // approved, crowns released
  | 'failed' // API error, crowns refunded
  | 'cancelled'; // cancelled before work started, crowns refunded

export interface Decree {
  id: string;
  userId: string;
  agentId: string;
  commissionId: string | null;
  province: ProvinceId;
  title: string;
  brief: string;
  price: number;
  status: DecreeStatus;
  result: string; // markdown, grows while working
  revisionNote: string | null;
  revision: number;
  error: string | null;
  rating: number | null;
  review: string | null;
  isPublic: boolean; // requester allowed it to be shown in the agent's portfolio
  routedBy: 'requester' | 'vizier' | 'keywords';
  routeReason: string | null;
  tokensIn: number;
  tokensOut: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  agent?: AgentLite;
  // Real work done with tools (owner / public works only, like `result`).
  steps: DecreeStep[];
  artifacts: DecreeArtifact[];
  nowDoing: string | null; // short live line while working, e.g. "Searching OpenAlex for “solar batteries”"
}

/** One real tool call an agent made while working on a decree. */
export interface DecreeStep {
  id: string;
  revision: number;
  round: number;
  tool: string; // tool name, e.g. 'search_openalex'
  input: Record<string, unknown>;
  status: 'running' | 'ok' | 'error';
  summary: string;
  sourceName: string | null;
  sourceUrl: string | null;
  ms: number | null;
  at: string;
}

/** A file an agent really produced for a decree. */
export interface DecreeArtifact {
  id: string;
  revision: number;
  /** 'site' = GitHub Pages publish record, 'draft' = Bluesky draft awaiting the Herald, 'audit' = PageSpeed scores, 'audio' = MP3 voice-over, 'file' = downloadable text file (transcript .txt, subtitles .srt). */
  kind: 'image' | 'video' | 'audio' | 'file' | 'html' | 'site' | 'draft' | 'audit';
  url: string | null; // '/uploads/…' for image and video; the public URL for a 'site' only once it is live
  html: string | null; // full single-file page for kind 'html' (render only in a sandboxed iframe)
  title: string;
  meta: Record<string, unknown>;
  at: string;
}

export interface Banner {
  // rentable banner slot on the realm map
  id: string;
  no: number;
  province: ProvinceId;
  side: string; // "North side" etc.
  kind: 'pennant' | 'banner';
  size: string; // "800 × 450 · 16:9"
  pricePerDay: number;
  renterId: string | null;
  renterName: string | null;
  title: string | null;
  imageUrl: string | null;
  until: string | null;
}

export interface RealmStatus {
  aiEnabled: boolean;
  model: string;
  agents: number;
  working: number;
  approved: number;
  queued: number;
  issued: number; // every decree except cancelled ones
  crownsInVault: number;
  // daily limits that protect the API budget
  dailyLimitPerUser: number;
  usedToday: number | null; // for the current user, when known
}

export interface LedgerEntry {
  id: string;
  amount: number; // + in, - out
  kind: 'grant' | 'vault_lock' | 'refund' | 'banner_rent' | 'agent_earning' | 'festival_bonus';
  ref: string | null;
  createdAt: string;
}

export type ActivityKind =
  | 'decree_issued'
  | 'decree_started'
  | 'decree_delivered'
  | 'decree_approved'
  | 'agent_enlisted'
  | 'banner_raised'
  | 'tool_used' // an agent called a real API while working on a decree
  | 'duty_done' // an agent finished an automatic duty with a free public API
  | 'quest_started'
  | 'quest_step'
  | 'quest_done'
  | 'festival';

export interface Activity {
  id: string;
  kind: ActivityKind;
  province: ProvinceId;
  text: string; // ready-to-show sentence, e.g. "Rowan began “REST API for orders”"
  agent: AgentLite | null;
  at: string;
}

export interface ProvinceInfo {
  online: number; // agents able to work right now (0 when AI is offline)
  agents: (AgentLite & { working: boolean })[];
  approved: number; // decrees approved in this province
}

export interface RoutePreview {
  province: ProvinceId;
  hits: string[];
  agent: AgentLite | null;
}
