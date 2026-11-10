// "New in the realm": the latest update. Four guild cards with the free sources they gained,
// their agents and a link to try the tools in the workshop.
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { PROVINCE, type ProvinceId } from '../../shared/realm';
import { ProvinceIcon } from '../components/ProvinceIcon';

const NEW: { id: ProvinceId; agents: string[]; line: string; sources: string[] }[] = [
  { id: 'observatory', agents: ['Orion', 'Selene', 'Tamsin'], line: 'Space weather, the next rocket launches, space news and sunrise times', sources: ['NOAA SWPC', 'Launch Library 2', 'Spaceflight News', 'Sunrise-Sunset'] },
  { id: 'arena', agents: ['Brennus', 'Sorrel', 'Pippa'], line: 'Formula 1, chess, TV, anime, the music chart and trivia', sources: ['Jolpica F1', 'Lichess', 'TVmaze', 'AniList', 'Deezer', 'Open Trivia DB'] },
  { id: 'archive', agents: ['Thea', 'Alder', 'Nell', 'Lucian'], line: 'Scholarly records, structured facts and the web’s memory', sources: ['Crossref', 'Wikidata', 'Internet Archive', 'Wayback Machine'] },
  { id: 'forge', agents: ['Rowan', 'Mira', 'Bram', 'Quinn'], line: 'Package health, exploited vulnerabilities, CVEs and domain records', sources: ['npm', 'PyPI', 'CISA KEV', 'NVD', 'RDAP'] },
];

// Sources added to the other guilds in the same update.
export const NEW_ELSEWHERE = 'Project Gutenberg books, PoetryDB and the MyMemory translation memory for the Scriptorium, most-read Wikipedia and developer trends for the Heralds, Open Food Facts and MedlinePlus for the Apothecary, and US Treasury debt and rates for the Treasury. 28 new sources in all, none of them needs a key.';

export function NewInRealm() {
  return (
    <section className="ld-new" id="new">
      <div className="wrap">
        <div className="ld-head">
          <span className="kicker">New in the realm</span>
          <h2 className="display d-lg">
            Space weather, rocket launches, F1, chess, <em>research and more.</em>
          </h2>
          <p className="lede">28 free public sources joined the guilds, with no key and no signup. Agents use them on decrees, and you can try every one in the workshops. Every answer still comes with its source.</p>
        </div>
        <div className="ld-new-grid">
          {NEW.map(({ id, agents, line, sources }) => {
            const p = PROVINCE[id];
            return (
              <Link key={id} to={`/workshop?guild=${id}`} className="ld-new-card" style={{ ['--gc' as string]: p.color }}>
                <div className="ld-new-top">
                  <ProvinceIcon id={id} size={44} />
                  <span className="num ld-new-no">{p.no}</span>
                </div>
                <h3>{p.name}</h3>
                <p className="ld-new-craft">{p.craft}</p>
                <p className="ld-new-line">{line}.</p>
                <p className="ld-new-agents">
                  <span>Agents</span> {agents.join(' · ')}
                </p>
                <ul className="ld-new-src">
                  {sources.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
                <span className="ld-new-go">
                  Try the tools <ArrowRight size={14} />
                </span>
              </Link>
            );
          })}
        </div>
        <p className="ld-new-more">Also new: {NEW_ELSEWHERE}</p>
      </div>
    </section>
  );
}
