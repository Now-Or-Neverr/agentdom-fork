// Contract for the live realm: what every agent is doing right now, real weather,
// real public holidays and guild duties. All data comes from the server.
import type { ProvinceId, Role } from './realm';

// working = carrying out a user's decree with Claude
// duty    = just finished (or is doing) an automatic royal duty with a free public API
// idle    = nothing right now (still walks around its guild)
export type AgentState = 'working' | 'duty' | 'idle';

export interface LiveAgent {
  id: string;
  name: string;
  province: ProvinceId;
  role: Role;
  look: number;
  color: string;
  state: AgentState;
  task: string | null; // short line for the speech bubble, e.g. "Writing “REST API for orders”"
  since: string | null; // ISO time the current state began
  decreeId: string | null; // set while working on a decree
  dutyId: string | null; // set while showing a duty result
}

export interface RealmLive {
  agents: LiveAgent[];
  champion: ProvinceId | null; // guild that leads this week's rivalry, null if no work yet
  at: string;
}

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog' | 'snow';

export interface Weather {
  kind: WeatherKind;
  code: number; // WMO weather code from Open-Meteo
  tempC: number;
  windKmh: number;
  isDay: boolean;
  lat: number;
  lon: number;
  source: 'open-meteo';
  fetchedAt: string;
}

export interface Festival {
  date: string; // YYYY-MM-DD
  name: string; // English name
  localName: string;
  country: string; // ISO 3166-1 alpha-2
  source: 'nager.date';
}

// One automatic duty done by an agent with a free public API (no Claude, no credit).
export interface Duty {
  id: string;
  agentId: string;
  agentName: string;
  province: ProvinceId;
  kind: string; // e.g. "fx_rates", "on_this_day", "hn_front_page"
  title: string; // e.g. "Exchange rates for the Treasury"
  summary: string; // one or two sentences built from the real response
  data: unknown; // the parsed facts (small)
  sourceName: string; // e.g. "Frankfurter"
  sourceUrl: string; // public URL a person can open to check the data
  imageUrl: string | null;
  at: string;
}
