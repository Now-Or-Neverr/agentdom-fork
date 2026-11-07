// Contract for the Royal Gazette, the weekly guild rivalry and the festival bonus.
// Every value is assembled on the server from real rows (duties, decrees, quests).
import type { ProvinceId } from './realm';
import type { Duty, Festival } from './live';

export interface GazetteSection {
  id: string; // e.g. "treasury"
  name: string; // e.g. "Treasury"
  province: ProvinceId;
  items: Duty[]; // newest first
}

export interface GazetteOnThisDay {
  month: number;
  day: number;
  events: { year: number; text: string; pageTitle: string | null; url: string | null }[];
  sourceUrl: string;
  fetchedAt: string;
}

export interface GazetteDecree {
  // only decrees whose requester made them public; no brief, no result
  id: string;
  title: string;
  province: ProvinceId;
  agentId: string;
  agentName: string;
  rating: number | null;
  at: string;
}

export interface GuildStanding {
  province: ProvinceId;
  name: string;
  approved: number;
  rating: number | null; // average rating, 1 decimal
  crowns: number; // crowns earned by approved decrees
  duties?: number; // gazette only: automatic duties done that day (not part of the rivalry)
}

export interface GazetteEdition {
  date: string; // YYYY-MM-DD (UTC)
  live: boolean; // true for today's edition, which still changes
  archivedAt: string | null; // when a past edition was frozen
  lead: Duty | null;
  sections: GazetteSection[];
  onThisDay: GazetteOnThisDay | null;
  onThisDayError: string | null;
  decrees: GazetteDecree[];
  stats: { duties: number; decreesApproved: number; questsCompleted: number; publicDecrees: number };
  standings: GuildStanding[]; // all-time up to the end of that day
  prev: string | null;
  next: string | null;
  generatedAt: string;
}

export interface Rivalry {
  week: string; // ISO week, e.g. "2026-W45"
  start: string; // ISO time (Monday 00:00 UTC)
  end: string; // exclusive
  standings: GuildStanding[];
  champion: ProvinceId | null;
  prevWeek: string;
  nextWeek: string | null;
}

export interface FestivalClaimStatus {
  country: string;
  today: Festival | null;
  next: Festival | null;
  claimed: boolean; // this user already claimed today's bonus
  bonus: number;
}
