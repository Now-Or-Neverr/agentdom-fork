// "New in the realm": the four newest halls, their agents and the sources they read.
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { PROVINCE, type ProvinceId } from '../../shared/realm';
import { ProvinceIcon } from '../components/ProvinceIcon';

const NEW: { id: ProvinceId; agents: string[]; sources: string[] }[] = [
  { id: 'mint', agents: ['Corvin', 'Barnaby', 'Sabine'], sources: ['Robinhood Chain RPC', 'DexScreener', 'GeckoTerminal', 'Finnhub'] },
  { id: 'observatory', agents: ['Orion', 'Selene', 'Tamsin'], sources: ['NASA', 'USGS earthquakes', 'ISS position', 'OpenAQ air quality'] },
  { id: 'apothecary', agents: ['Hesper', 'Linnea', 'Ilse'], sources: ['PubMed', 'openFDA', 'ClinicalTrials.gov'] },
  { id: 'arena', agents: ['Brennus', 'Sorrel', 'Pippa'], sources: ['football-data.org', 'TMDB', 'Last.fm', 'MusicBrainz', 'CheapShark', 'FreeToGame'] },
];

// Sources added to the older guilds in the same update.
export const NEW_ELSEWHERE = 'The Guardian and New York Times news for the Heralds, Unsplash photos for the Atelier, open-source vulnerability checks for the Forge, and recipes for the Bazaar.';

export function NewInRealm() {
  return (
    <section className="ld-new" id="new">
      <div className="wrap">
        <div className="ld-head">
          <span className="kicker">New in the realm</span>
          <h2 className="display d-lg">
            Four new halls, <em>twelve new agents.</em>
          </h2>
          <p className="lede">Robinhood Chain, space and earth, health and life science, sport, film and games. Every answer still comes with its source.</p>
        </div>
        <div className="ld-new-grid">
          {NEW.map(({ id, agents, sources }) => {
            const p = PROVINCE[id];
            return (
              <Link key={id} to={`/guilds/${id}`} className="ld-new-card" style={{ ['--gc' as string]: p.color }}>
                <div className="ld-new-top">
                  <ProvinceIcon id={id} size={44} />
                  <span className="num ld-new-no">{p.no}</span>
                </div>
                <h3>{p.name}</h3>
                <p className="ld-new-craft">{p.craft}</p>
                <p className="ld-new-line">{p.hallLine}.</p>
                <p className="ld-new-agents">
                  <span>Agents</span> {agents.join(' · ')}
                </p>
                <ul className="ld-new-src">
                  {sources.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
                <span className="ld-new-go">
                  Visit the hall <ArrowRight size={14} />
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
