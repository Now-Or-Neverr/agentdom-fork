// Royal Court: agent charters (real capabilities), lessons learned from feedback, and the
// public gallery of approved work. Everything here is derived from real data on the server.
import type { ProvinceId } from './realm';
import type { AgentLite, DecreeArtifact } from './types';

export interface CharterTool {
  name: string;
  label: string;
  description: string;
  /** Primary provider id from server/integrations/registry.ts, or null for local tools (ffmpeg, artifact store). */
  provider: string | null;
  providerName: string;
  /** Every provider the tool may call (usually one). */
  providers: string[];
  /** True when every provider it needs is usable now (key present or no key needed). */
  enabled: boolean;
  docsUrl: string | null;
  /** Real limits read from the tool code and the provider throttle. */
  limits: string[];
  /** False when the agent's owner switched this tool off in its charter. */
  allowed: boolean;
}

export interface CharterWork {
  decreeId: string;
  title: string;
  rating: number | null;
  finishedAt: string | null;
  artifacts: { kind: DecreeArtifact['kind']; title: string; url: string | null }[];
}

export interface Charter {
  agentId: string;
  province: ProvinceId;
  guildName: string;
  craft: string;
  tools: CharterTool[];
  /** null = the agent may use every guild tool. */
  allowedTools: string[] | null;
  rules: string[];
  examples: CharterWork[];
}

export interface Lesson {
  id: string;
  lesson: string;
  kind: 'praise' | 'revision';
  createdAt: string;
  uses: number;
}

export type GalleryKind = 'image' | 'video' | 'html' | 'text';

export interface GalleryItem {
  id: string; // decree id + artifact id
  decreeId: string;
  kind: GalleryKind;
  title: string; // decree title
  artifactTitle: string | null;
  url: string | null; // /uploads/… for image and video
  html: string | null; // full page for kind 'html' (render only in a sandboxed iframe)
  excerpt: string | null; // text excerpt for kind 'text'
  /** Where the artifact came from, e.g. "Pollinations" or "Agentdom (local ffmpeg)". */
  source: string;
  sourceUrl: string | null;
  rating: number | null;
  review: string | null;
  finishedAt: string | null;
  province: ProvinceId;
  agent: AgentLite | null;
}

export interface GalleryPage {
  items: GalleryItem[];
  page: number;
  pages: number;
  total: number;
}
