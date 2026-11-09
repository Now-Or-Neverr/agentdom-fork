import { Clapperboard, Coins, Crown, Feather, FlaskConical, Hammer, Landmark, Library, Megaphone, Palette, Scale, Store, Telescope, Trophy, type LucideIcon } from 'lucide-react';
import { PROVINCE, type ProvinceId } from '../../shared/realm';

const MAP: Record<string, LucideIcon> = { Crown, Hammer, Feather, Palette, Clapperboard, Library, Megaphone, Store, Landmark, Scale, Telescope, FlaskConical, Trophy, Coins };

export function provinceIcon(id: ProvinceId): LucideIcon {
  return MAP[PROVINCE[id].icon] ?? Crown;
}

// Province icon on a solid colored squircle (soft=true gives a tinted version).
export function ProvinceIcon({ id, size = 36, soft = false }: { id: ProvinceId; size?: number; soft?: boolean }) {
  const p = PROVINCE[id];
  const I = provinceIcon(id);
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.32,
        background: soft ? p.color + '22' : `linear-gradient(160deg, ${p.color}, ${p.color}dd)`,
        color: soft ? p.color : '#fff',
        boxShadow: soft ? 'none' : `0 ${size * 0.1}px ${size * 0.3}px ${p.color}40`,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <I size={size * 0.52} strokeWidth={2.2} />
    </span>
  );
}
