// Agentdom characters: chibi court people of an imperial dynasty, drawn as flat 2D vector illustration.
// Figure = full body, Portrait = head-and-shoulders bust of the same person.
// Every agent belongs to one of ten royal court roles.
import { useId, useMemo, type CSSProperties } from "react";
import type { Role } from "../../shared/realm";
import { Pen, drawPerson } from "./character/chibi";
import { accent, lighten, vivid } from "./character/color";
import "./character/character.css";

export interface CharacterProps {
  role: Role;
  look?: number; // 0..3 variant
  color?: string; // agent / province colour
  size?: number;
  style?: CSSProperties;
  className?: string;
}

export const ROLE_TITLE: Record<Role, string> = {
  vizier: "Grand Vizier",
  smith: "Smith",
  scribe: "Scribe",
  painter: "Painter",
  bard: "Bard",
  archivist: "Archivist",
  herald: "Herald",
  merchant: "Merchant",
  steward: "Steward",
  magistrate: "Magistrate",
};

const ALL_ROLES = Object.keys(ROLE_TITLE) as Role[];

const useSvgId = () => "c" + useId().replace(/[^a-zA-Z0-9_-]/g, "");

// Head-and-shoulders bust for lists and cards (square).
export function Portrait({
  role,
  look = 0,
  color = accent(),
  size = 56,
  style,
  className,
  framed = true,
}: CharacterProps & { framed?: boolean }) {
  const id = useSvgId();
  const detail = size >= 40;
  const art = useMemo(() => {
    const pen = new Pen(id);
    const body = drawPerson(pen, role, look, color, { detail });
    return { pen, body };
  }, [id, role, look, color, detail]);
  const tint = vivid(color, 0, 0.55);
  const bgA = lighten(tint, 0.88);
  const bgB = lighten(tint, 0.7);
  // Small avatars zoom in so the face fills the tile.
  const zoom = detail ? 0.84 : 1;
  const bust = `translate(50 ${detail ? 54 : 55}) scale(${zoom}) translate(-60 ${detail ? -74 : -77})`;
  return (
    <svg
      className={"chr-portrait " + (className ?? "")}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={style}
      role="img"
      aria-label={ROLE_TITLE[role]}
    >
      <defs>
        {art.pen.defs}
        <clipPath id={`${id}clip`}>
          {framed ? (
            <rect width="100" height="100" rx="26" />
          ) : (
            <rect x="-30" y="-30" width="160" height="130" />
          )}
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}clip)`}>
        {framed && (
          <>
            <rect width="100" height="100" fill={bgB} />
            <circle cx="50" cy="47" r="38" fill={bgA} />
          </>
        )}
        <g transform={bust}>{art.body}</g>
      </g>
      {framed && (
        <rect
          x="1"
          y="1"
          width="98"
          height="98"
          rx="25"
          fill="none"
          stroke="#fff"
          strokeWidth={detail ? 2 : 3}
          opacity="0.85"
        />
      )}
    </svg>
  );
}

// Full-body chibi figure (height = size, width ≈ size × 0.57).
export function Figure({
  role,
  look = 0,
  color = accent(),
  size = 220,
  style,
  className,
  pose = "stand",
  idle = true,
}: CharacterProps & { pose?: "stand" | "work"; idle?: boolean }) {
  const id = useSvgId();
  const art = useMemo(() => {
    const pen = new Pen(id);
    const body = drawPerson(pen, role, look, color, {
      pose,
      eyeClass: idle ? "chr-eye" : undefined,
    });
    return { pen, body };
  }, [id, role, look, color, pose, idle]);
  const delay = `${((look * 7 + role.length * 3) % 10) * 0.37}s`;
  return (
    <svg
      className={"chr-figure " + (idle ? "chr-idle " : "") + (className ?? "")}
      width={(size * 120) / 212}
      height={size}
      viewBox="0 -12 120 212"
      style={{ ["--chr-delay" as string]: delay, ...style }}
      role="img"
      aria-label={ROLE_TITLE[role]}
    >
      <defs>
        {art.pen.defs}
        <radialGradient id={`${id}sh`}>
          <stop offset="0" stopColor="#1B1530" stopOpacity="0.38" />
          <stop offset="0.6" stopColor="#1B1530" stopOpacity="0.16" />
          <stop offset="1" stopColor="#1B1530" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse
        className="chr-shadow"
        cx="60"
        cy="188"
        rx="48"
        ry="8"
        fill={`url(#${id}sh)`}
      />
      <g transform="translate(60 188) scale(1.1) translate(-60 -188)">
        <g className="chr-body">{art.body}</g>
      </g>
    </svg>
  );
}

// All ten roles side by side. Handy for previews and QA.
export function CharacterSheet({
  color,
  look = 0,
  size = 220,
  pose = "stand",
}: {
  color?: string;
  look?: number;
  size?: number;
  pose?: "stand" | "work";
}) {
  return (
    <div className="chr-sheet">
      {ALL_ROLES.map((r, i) => (
        <div key={r} className="chr-sheet-cell">
          <Figure
            role={r}
            look={(look + i) % 4}
            color={color ?? accent()}
            size={size}
            pose={pose}
          />
          <Portrait
            role={r}
            look={(look + i) % 4}
            color={color ?? accent()}
            size={64}
          />
          <span>{ROLE_TITLE[r]}</span>
        </div>
      ))}
    </div>
  );
}
