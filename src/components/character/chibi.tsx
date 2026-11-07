// Agentdom characters: chibi court people of an East-Asian imperial dynasty, drawn as flat 2D
// vector illustration — thin dark outlines, flat fills with a single shade tone, semi-realistic
// faces (almond eyes, defined brows, small nose and mouth) and detailed period costumes.
//
// One drawing (drawPerson) serves both components:
// · Figure: full body.  Coordinate space x 0..120, y -12..200, feet on y ≈ 188.
// · Portrait: the same person cropped to head + shoulders (bust).
//
// Every helper below is called as a plain function (never as a <Component/>) so that each
// clip path / pattern is registered in the Pen before <defs> renders.
import type { ReactNode } from "react";
import type { Role } from "../../../shared/realm";
import { darken, lighten, mix, tone } from "./color";

export type Pose = "stand" | "work";
type P = [number, number];

// Collects <defs> (clip paths, patterns, glows), deduplicated per instance.
export class Pen {
  defs: ReactNode[] = [];
  private cache = new Map<string, string>();
  private n = 0;
  constructor(public id: string) {}

  private key(k: string, make: (gid: string) => ReactNode) {
    let v = this.cache.get(k);
    if (!v) {
      const gid = `${this.id}g${this.n++}`;
      this.defs.push(make(gid));
      v = `url(#${gid})`;
      this.cache.set(k, v);
    }
    return v;
  }
  clip(d: string) {
    return this.key(`cl${d}`, (g) => (
      <clipPath key={g} id={g}>
        <path d={d} />
      </clipPath>
    ));
  }
  pattern(name: string, w: number, h: number, body: ReactNode) {
    return this.key(`pt${name}`, (g) => (
      <pattern
        key={g}
        id={g}
        width={w}
        height={h}
        patternUnits="userSpaceOnUse"
      >
        {body}
      </pattern>
    ));
  }
  // Soft glow (colour → transparent) — only for hot metal / magic.
  glow(c: string, a = 0.55) {
    return this.key(`gl${c}${a}`, (g) => (
      <radialGradient key={g} id={g}>
        <stop offset="0" stopColor={c} stopOpacity={a} />
        <stop offset="1" stopColor={c} stopOpacity={0} />
      </radialGradient>
    ));
  }
}

// ───────────────────────────── palette ─────────────────────────────

const OUT = "#2B1D1C"; // outline ink
const SKIN = ["#F7DAC2", "#F3CDB0", "#E5B690", "#F9E2CF"];
const HAIR = "#221B21";
const HAIR_HL = "#4E4553";
const WHITE_HAIR = "#EEEAE4";
const WHITE_SH = "#C9C1B8";
const SEC = ["#2F3E63", "#8A2F39", "#2E6A5D", "#E6DCC6"]; // navy, burgundy, pine, cream
const INNER = "#F5EFE3";
const GOLD = "#DDA93E";
const GOLD_SH = "#B07C24";
const GOLD_HL = "#F5D884";
const RED = "#B8352F";
const JADE = "#6DB596";
const WOOD = "#9C6337";
const STEEL = "#A3ABB6";
const PAPER = "#F6EEDA";
const BAMBOO = "#D7B36B";
const BLACK = "#2A2430";
const BOOT = "#2E2730";
const IRIS = "#3B2620";

const shade = (c: string, t = 0.2) => mix(c, "#2B2140", t);

// ───────────────────────────── kit ─────────────────────────────

type Expr = "cheer" | "gentle" | "stern" | "smirk";

interface Kit {
  pen: Pen;
  c: string; // main costume colour (from agent colour)
  acc: string; // trim / accent (agent colour, darker)
  sec: string; // secondary costume colour (varies by look)
  skin: string;
  skinSh: string;
  hair: string;
  hairHl: string;
  look: number;
  fem: boolean;
  beard: boolean;
  elder: boolean;
  expr: Expr;
  work: boolean;
  detail: boolean;
  sw: number; // outline width
}

const ol = (k: Kit, m = 1) => ({
  stroke: OUT,
  strokeWidth: k.sw * m,
  strokeLinejoin: "round" as const,
  strokeLinecap: "round" as const,
});

// A stroked rod with an ink outline (shafts, poles, handles, ribbons).
function rod(
  k: Kit,
  d: string,
  c: string,
  w: number,
  key?: string | number,
): ReactNode {
  return (
    <g key={key} fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} stroke={OUT} strokeWidth={w + k.sw * 2} />
      <path d={d} stroke={c} strokeWidth={w} />
    </g>
  );
}

const star = (x: number, y: number, r: number, fill: string, key?: number) => (
  <path
    key={key}
    d={`M${x} ${y - r} Q${x + r * 0.2} ${y - r * 0.2} ${x + r} ${y} Q${x + r * 0.2} ${y + r * 0.2} ${x} ${y + r} Q${x - r * 0.2} ${y + r * 0.2} ${x - r} ${y} Q${x - r * 0.2} ${y - r * 0.2} ${x} ${y - r}Z`}
    fill={fill}
  />
);

function flower(
  k: Kit,
  x: number,
  y: number,
  r: number,
  c: string,
  key?: string | number,
): ReactNode {
  const petals = [0, 72, 144, 216, 288].map((a) => {
    const t = ((a - 90) * Math.PI) / 180;
    return (
      <circle
        key={a}
        cx={x + Math.cos(t) * r * 0.62}
        cy={y + Math.sin(t) * r * 0.62}
        r={r * 0.5}
        fill={c}
        {...ol(k, 0.7)}
      />
    );
  });
  return (
    <g key={key}>
      {petals}
      <circle cx={x} cy={y} r={r * 0.32} fill={GOLD_HL} {...ol(k, 0.6)} />
    </g>
  );
}

// ───────────────────────────── body ─────────────────────────────

const robePath = (h: number, f: number) =>
  `M47 102 L73 102 C79 103 83.5 106 85 111 L87 140 L${90 + f} ${h} Q60 ${h + 5} ${30 - f} ${h} L33 140 L35 111 C36.5 106 41 103 47 102Z`;

type Collar = "cross" | "round" | "none";

interface RobeOpts {
  c: string;
  trim: string;
  hem: number;
  flare: number;
  collar: Collar;
  belt?: ReactNode | "none";
  cloth?: ReactNode;
  front?: boolean; // front opening trim
}

function robeBody(k: Kit, o: RobeOpts): ReactNode {
  const { pen, detail } = k;
  const d = robePath(o.hem, o.flare);
  const h = o.hem;
  const sh = shade(o.c, 0.2);
  return (
    <g>
      <path d={d} fill={o.c} />
      <g clipPath={pen.clip(d)}>
        {o.cloth}
        <path
          d={`M76 100 C81 128 79 156 81 ${h + 8} L130 ${h + 8} L130 100Z`}
          fill={sh}
        />
        <path d={`M0 108 Q60 116 120 108 L120 100 L0 100Z`} fill={sh} />
        {detail && (
          <g stroke={sh} strokeWidth="1" fill="none" strokeLinecap="round">
            <path d={`M43 142 L40.5 ${h - 2}`} />
            <path d={`M70 144 L72 ${h - 3}`} />
          </g>
        )}
        <path
          d={`M0 ${h - 6} Q60 ${h} 120 ${h - 6} L120 210 L0 210Z`}
          fill={o.trim}
          {...ol(k)}
        />
        {o.front !== false && (
          <path
            d={`M49 134 L53.5 134 L51 ${h + 8} L46 ${h + 8}Z`}
            fill={o.trim}
            {...ol(k)}
          />
        )}
      </g>
      <path d={d} fill="none" {...ol(k)} />
      {o.collar === "cross" && (
        <g>
          <path d="M46.6 101.6 L73.4 101.6 L60 120.4Z" fill={k.sec === SEC[3] ? lighten(o.trim, 0.25) : k.sec} {...ol(k)} />
          <path d="M50 101.5 L70 101.5 L60 115Z" fill={INNER} {...ol(k)} />
          <path
            d="M45.6 102.4 L50.4 100.8 L62.2 115.6 L59 119.4Z"
            fill={o.trim}
            {...ol(k)}
          />
          <path
            d="M69.6 100.8 L74.4 102.4 L51 132 L46.6 129Z"
            fill={o.trim}
            {...ol(k)}
          />
          {detail && (
            <path
              d="M71.2 102.8 L48.6 130.2"
              stroke={lighten(o.trim, 0.35)}
              strokeWidth="0.8"
              fill="none"
            />
          )}
        </g>
      )}
      {o.collar === "round" && (
        <g>
          <path
            d="M44.5 103.5 Q60 118 75.5 103.5 L72.5 101.6 Q60 112 47.5 101.6Z"
            fill={o.trim}
            {...ol(k)}
          />
          <path
            d="M47.5 101.6 Q60 112 72.5 101.6 Q60 105 47.5 101.6Z"
            fill={INNER}
            {...ol(k, 0.8)}
          />
        </g>
      )}
      {o.belt !== "none" && (o.belt ?? belt(k, k.sec))}
    </g>
  );
}

function belt(k: Kit, c: string, pendant = true): ReactNode {
  const { detail } = k;
  return (
    <g>
      <path
        d="M33.6 127 Q60 131.5 86.4 127 L86.9 135.5 Q60 140 33.1 135.5Z"
        fill={c}
        {...ol(k)}
      />
      {detail && (
        <path
          d="M34 129.6 Q60 134 86 129.6"
          stroke={lighten(c, 0.3)}
          strokeWidth="0.7"
          fill="none"
        />
      )}
      <rect
        x="56"
        y="128.6"
        width="8"
        height="8.6"
        rx="1.6"
        fill={GOLD}
        {...ol(k)}
      />
      {detail && <rect x="58.4" y="131" width="3.2" height="3.8" fill={JADE} />}
      {pendant && detail && (
        <g>
          <path d="M67 137 L67.4 145" stroke={RED} strokeWidth="0.9" />
          <circle cx="67.4" cy="147.4" r="2.8" fill={JADE} {...ol(k, 0.8)} />
          <circle cx="67.4" cy="147.4" r="0.9" fill={shade(JADE, 0.3)} />
          <path
            d="M66.4 150 L65.6 157 M67.4 150 L67.4 157.6 M68.4 150 L69.2 157"
            stroke={RED}
            strokeWidth="0.9"
            strokeLinecap="round"
          />
        </g>
      )}
    </g>
  );
}

function boots(k: Kit, tall = false): ReactNode {
  const top = tall ? 166 : 177;
  const one = (x: number, s: number) => (
    <g key={x}>
      <path
        d={`M${x - 6} ${top} L${x - 6.4} 186.2 Q${x - 6.4} 189.2 ${x - 3} 189.2 L${x + 5 + s * 1.5} 189.2 Q${x + 7.5 + s * 1.5} 189.2 ${x + 6.4} 186.6 L${x + 6} ${top}Z`}
        fill={BOOT}
        {...ol(k)}
      />
      {k.detail && (
        <path
          d={`M${x - 3.8} ${top + 2} L${x - 4} 185`}
          stroke="#5A5060"
          strokeWidth="1"
          strokeLinecap="round"
        />
      )}
    </g>
  );
  return [one(50, -1), one(70, 1)];
}

function trousers(k: Kit, c: string, wraps: string): ReactNode {
  return (
    <g>
      <path d="M42 148 L58 148 L57 176 L44 176Z" fill={c} {...ol(k)} />
      <path d="M62 148 L78 148 L76 176 L63 176Z" fill={c} {...ol(k)} />
      <rect x="43.4" y="164" width="13.4" height="6" fill={wraps} {...ol(k, 0.8)} />
      <rect x="63.2" y="164" width="13.4" height="6" fill={wraps} {...ol(k, 0.8)} />
    </g>
  );
}

type SleeveKind = "wide" | "narrow" | "short";

function sleeve(
  k: Kit,
  S: P,
  H: P,
  side: -1 | 1,
  c: string,
  trim: string,
  kind: SleeveKind,
  w2 = 11,
): ReactNode {
  const dx = H[0] - S[0];
  const dy = H[1] - S[1];
  const len = Math.hypot(dx, dy) || 1;
  const u: P = [dx / len, dy / len];
  const n: P = [-u[1], u[0]];
  const ang = (Math.atan2(u[1], u[0]) * 180) / Math.PI;
  const f = (p: P, a: number, b: number) =>
    `${(p[0] + n[0] * a + u[0] * b).toFixed(1)} ${(p[1] + n[1] * a + u[1] * b).toFixed(1)}`;
  // Outer side = away from the body (shade side).
  const outer = n[0] * side > 0 ? 1 : -1;
  const w1 = kind === "wide" ? 7.6 : 6.6;
  if (kind === "short") {
    const M: P = [S[0] + dx * 0.45, S[1] + dy * 0.45];
    const d = `M${f(S, w1, 0)} L${f(M, 7, 0)} L${f(M, -7, 0)} L${f(S, -w1, 0)} Q${f(S, 0, -w1 * 1.3)} ${f(S, w1, 0)}Z`;
    return (
      <g>
        <path
          d={`M${f(M, 4.2, -1)} L${f(H, 3.6, 0)} L${f(H, -3.6, 0)} L${f(M, -4.2, -1)}Z`}
          fill={k.skin}
          {...ol(k)}
        />
        <path
          d={`M${f(H, 4, -7.5)} L${f(H, 4, -2.5)} L${f(H, -4, -2.5)} L${f(H, -4, -7.5)}Z`}
          fill={trim}
          {...ol(k, 0.9)}
        />
        <path d={d} fill={c} {...ol(k)} />
        <path
          d={`M${f(M, 7.2, -3)} L${f(M, 7.2, 0)} L${f(M, -7.2, 0)} L${f(M, -7.2, -3)}Z`}
          fill={shade(c, 0.25)}
          {...ol(k, 0.9)}
        />
      </g>
    );
  }
  const W = kind === "wide" ? w2 : 6.4;
  const C: P = [H[0] - u[0] * 3.2, H[1] - u[1] * 3.2];
  const d = `M${f(S, w1, 0)} L${f(C, W, 0)} L${f(C, -W, 0)} L${f(S, -w1, 0)} Q${f(S, 0, -w1 * 1.3)} ${f(S, w1, 0)}Z`;
  const cuff = kind === "wide" ? 3.6 : 2.6;
  return (
    <g>
      <path d={d} fill={c} {...ol(k)} />
      <path
        d={`M${f(S, outer * w1 * 0.25, 2)} L${f(C, outer * W * 0.3, -cuff)} L${f(C, outer * W, -cuff)} L${f(S, outer * w1, 0)}Z`}
        fill={shade(c, 0.2)}
      />
      <path d={d} fill="none" {...ol(k)} />
      <path
        d={`M${f(C, W, -cuff)} L${f(C, W, 0)} L${f(C, -W, 0)} L${f(C, -W, -cuff)}Z`}
        fill={trim}
        {...ol(k)}
      />
      <ellipse
        cx={C[0] + u[0] * 0.4}
        cy={C[1] + u[1] * 0.4}
        rx="2.2"
        ry={W - 1}
        transform={`rotate(${ang} ${C[0] + u[0] * 0.4} ${C[1] + u[1] * 0.4})`}
        fill={shade(c, 0.6)}
        {...ol(k, 0.8)}
      />
    </g>
  );
}

function hand(k: Kit, at: P, key?: string | number): ReactNode {
  const r = k.fem ? 3.7 : 4.2;
  return (
    <g key={key}>
      <ellipse
        cx={at[0]}
        cy={at[1]}
        rx={r}
        ry={r * 1.05}
        fill={k.skin}
        {...ol(k)}
      />
      {k.detail && (
        <path
          d={`M${at[0] - r * 0.5} ${at[1] + r * 0.2} Q${at[0]} ${at[1] + r * 0.7} ${at[0] + r * 0.5} ${at[1] + r * 0.2}`}
          stroke={k.skinSh}
          strokeWidth="0.7"
          fill="none"
        />
      )}
    </g>
  );
}

// ───────────────────────────── head ─────────────────────────────

const FACE =
  "M60 42 C78 42 88.5 54 88.5 71 C88.5 86 81 96 71.5 100.5 Q65.5 103.6 60 103.6 Q54.5 103.6 48.5 100.5 C39 96 31.5 86 31.5 71 C31.5 54 42 42 60 42Z";
const HAIR_MASS =
  "M25.5 79 C20.5 48 37 31.5 60 31.5 C83 31.5 99.5 48 94.5 79 Q60 86 25.5 79Z";
const HAIR_MASS_M =
  "M29 70 C26 46 40.6 31 60 31 C79.4 31 94 46 91 70 Q60 64 29 70Z";
const FRINGE = {
  center:
    "M60 44 C55 52 46 56 36.4 61 L34.6 73.6 Q31 73.4 30.2 69 C28.4 47 41 34 60 34 C79 34 91.6 47 89.8 69 Q89 73.4 85.4 73.6 L83.6 61 C74 56 65 52 60 44Z",
  side: "M67 42 C59 52 47 57 36.2 61.6 L34.6 73.6 Q31 73.4 30.2 69 C28.4 47 41 34 60 34 C79 34 91.6 47 89.8 69 Q89 73.4 85.4 73.6 L84 59 C80 51 73 46 67 42Z",
  fem: "M60 42 C53 50 43 55 37 64 C33.6 74 34.4 90 36.6 104 Q30.6 104.6 27.4 98 C24 86 25 76 26 68 C26 46 40 34 60 34 C80 34 94 46 94 68 C95 76 96 86 92.6 98 Q89.4 104.6 83.4 104 C85.6 90 86.4 74 83 64 C77 55 67 50 60 42Z",
  femUp:
    "M60 42 C53 50 44 55 37.6 62 C35 68 35 76 35.4 84 Q31 84 29.6 78 C27 50 41 34 60 34 C79 34 93 50 90.4 78 Q89 84 84.6 84 C85 76 85 68 82.4 62 C76 55 67 50 60 42Z",
};
const LONG_HAIR =
  "M26 70 C22 100 21 126 24.5 148 Q42 154 60 152 Q78 154 95.5 148 C99 126 98 100 94 70Z";

type Top =
  | "knot"
  | "knotPin"
  | "guan"
  | "femBun"
  | "femFlower"
  | "twin"
  | "pony"
  | "none";

interface HeadOpts {
  top?: Top;
  topColor?: string; // crown colour for guan
  hat?: ReactNode;
  behind?: ReactNode; // behind the hair mass (ponytail, hat backs)
  mouth?: "o";
}

const EY = 75;
const EXS = [47.5, 72.5];

function eyes(k: Kit, eyeClass?: string): ReactNode {
  const { pen, detail, fem, elder } = k;
  const one = (x: number, s: -1 | 1) => {
    const ix = x - s * 5;
    const iy = EY + 1;
    const ox = x + s * 5.7;
    const oy = EY - (fem ? 0.4 : 0.1);
    const ux = x - s * 0.5;
    const uy = EY - (elder ? 4.2 : fem ? 5.8 : 5.2);
    const almond = `M${ix} ${iy} Q${ux} ${uy} ${ox} ${oy} Q${x + s * 0.5} ${EY + (elder ? 3.6 : 4.6)} ${ix} ${iy}Z`;
    if (!detail)
      return (
        <g key={s}>
          <ellipse cx={x} cy={EY + 0.4} rx="3.6" ry="3.9" fill={IRIS} />
          <path
            d={`M${ix} ${iy - 0.4} Q${ux} ${uy} ${ox + s * 0.8} ${oy - 0.6}`}
            stroke={OUT}
            strokeWidth={k.sw * 1.5}
            fill="none"
            strokeLinecap="round"
          />
          <circle cx={x - 1.1} cy={EY - 0.8} r="1.2" fill="#fff" />
        </g>
      );
    return (
      <g key={s}>
        <path d={almond} fill="#FFFDF8" />
        <g clipPath={pen.clip(almond)}>
          <circle cx={x - s * 0.2} cy={EY + 0.7} r="3.5" fill={IRIS} />
          <circle cx={x - s * 0.2} cy={EY + 0.7} r="1.8" fill="#140C0C" />
          <circle cx={x - s * 0.2 - 1.2} cy={EY - 0.7} r="1.05" fill="#fff" />
          <circle
            cx={x - s * 0.2 + 1.2}
            cy={EY + 2.1}
            r="0.5"
            fill="#fff"
            opacity="0.8"
          />
        </g>
        <path
          d={`M${ix} ${iy} Q${ux} ${uy} ${ox} ${oy} l${s * 1.6} -0.9`}
          stroke={OUT}
          strokeWidth={k.sw * 1.55}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {fem && (
          <path
            d={`M${ox - s * 0.6} ${oy - 1} l${s * 1.8} -1.8 M${ox - s * 2.4} ${oy - 2.2} l${s * 1.2} -1.8`}
            stroke={OUT}
            strokeWidth={k.sw * 0.7}
            strokeLinecap="round"
          />
        )}
        <path
          d={`M${x + s * 0.4} ${EY + 3.6} Q${x + s * 3.6} ${EY + 3.2} ${ox - s * 0.4} ${oy + 0.6}`}
          stroke={k.skinSh}
          strokeWidth="0.8"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d={`M${ix + s * 1.2} ${EY - 3.4} Q${x} ${EY - (fem ? 7.2 : 6.6)} ${ox - s * 0.6} ${EY - 2.6}`}
          stroke={k.skinSh}
          strokeWidth="0.7"
          fill="none"
          strokeLinecap="round"
        />
      </g>
    );
  };
  return <g className={eyeClass}>{[one(EXS[0], -1), one(EXS[1], 1)]}</g>;
}

function brows(k: Kit): ReactNode {
  const { fem, elder, expr } = k;
  const out = EXS.map((x, i) => {
    const s = i === 0 ? -1 : 1;
    const stern = expr === "stern" || (expr === "smirk" && s === 1);
    const iy = stern ? EY - 7.6 : expr === "cheer" ? EY - 10 : EY - 9;
    const oy = fem ? EY - 9.4 : EY - 10.6;
    const cy = fem ? EY - 12.6 : stern ? EY - 11 : EY - 12.2;
    const d = `M${x - s * 4.8} ${iy} Q${x + s * 0.6} ${cy} ${x + s * (fem ? 6.6 : 6)} ${oy}`;
    if (elder)
      return (
        <g key={i}>
          <path
            d={d}
            stroke={OUT}
            strokeWidth={3.4 + k.sw}
            strokeLinecap="round"
            fill="none"
          />
          <path
            d={d}
            stroke={WHITE_HAIR}
            strokeWidth={3.4}
            strokeLinecap="round"
            fill="none"
          />
        </g>
      );
    return (
      <path
        key={i}
        d={d}
        stroke={fem ? "#3A2C2E" : HAIR}
        strokeWidth={fem ? 1.25 : k.detail ? 2 : 2.4}
        strokeLinecap="round"
        fill="none"
      />
    );
  });
  return <g>{out}</g>;
}

function mouth(k: Kit, o?: "o"): ReactNode {
  const { fem, expr, detail } = k;
  if (o === "o")
    return <ellipse cx="60" cy="92.4" rx="2.4" ry="2.2" fill="#9E3638" {...ol(k, 0.7)} />;
  if (expr === "cheer")
    return (
      <g>
        <path
          d="M54.6 90.4 Q60 92 65.4 90.4 Q64 97 60 97 Q56 97 54.6 90.4Z"
          fill="#A8393A"
          {...ol(k, 0.8)}
        />
        {detail && (
          <>
            <path
              d="M55.4 91 Q60 92.5 64.6 91 L64.3 92.3 Q60 93.5 55.7 92.3Z"
              fill="#fff"
            />
            <path
              d="M56.9 95.2 Q60 93.8 63.1 95.2 Q61.8 96.8 60 96.8 Q58.2 96.8 56.9 95.2Z"
              fill="#E46F6C"
            />
          </>
        )}
      </g>
    );
  if (fem && expr !== "stern")
    return (
      <g>
        <path
          d="M56.4 91.6 Q58.4 90.4 60 91.2 Q61.6 90.4 63.6 91.6 Q60 92.6 56.4 91.6Z"
          fill="#C24B4A"
        />
        <path
          d="M57 92 Q60 95.2 63 92 Q60 92.9 57 92Z"
          fill="#D8605B"
        />
        {expr === "smirk" && (
          <path d="M63.4 91.4 l1.2 -0.8" stroke="#8E3A36" strokeWidth="0.8" />
        )}
      </g>
    );
  const d =
    expr === "stern"
      ? "M56 92.4 Q60 91.2 64 92.4"
      : expr === "smirk"
        ? "M55.8 92.2 Q59.6 93.6 64.2 90.6 l0.9 -0.4"
        : "M56.2 91.4 Q60 93.8 63.8 91.4";
  return (
    <path
      d={d}
      stroke={fem ? "#B4454A" : "#6E3530"}
      strokeWidth={detail ? 1.25 : 1.6}
      strokeLinecap="round"
      fill="none"
    />
  );
}

function facialHair(k: Kit): ReactNode {
  if (k.elder)
    return (
      <g>
        <path
          d="M41 90 C42 104 50 114 53 128 Q57 137 60 142 Q63 137 67 128 C70 114 78 104 79 90 Q73 99 60 99.5 Q47 99 41 90Z"
          fill={WHITE_HAIR}
          {...ol(k)}
        />
        {k.detail && (
          <path
            d="M53 106 Q56 120 58.4 132 M60 104 L60 136 M67 106 Q64 120 61.6 132 M47 100 Q50 108 52 116 M73 100 Q70 108 68 116"
            stroke={WHITE_SH}
            strokeWidth="0.8"
            fill="none"
            strokeLinecap="round"
          />
        )}
        <path
          d="M60 87.4 C56 86.4 51 88 47.4 95 C51.6 91.6 56 91 60 90.6 C64 91 68.4 91.6 72.6 95 C69 88 64 86.4 60 87.4Z"
          fill={WHITE_HAIR}
          {...ol(k, 0.9)}
        />
      </g>
    );
  if (!k.beard) return null;
  return (
    <g fill={k.hair}>
      <path d="M60 87.6 C57 87 54 88.4 52.4 92.2 C55 90 57.6 89.6 60 89.4 C62.4 89.6 65 90 67.6 92.2 C66 88.4 63 87 60 87.6Z" />
      <path d="M57.4 97.4 Q60 104.4 62.6 97.4 Q60 98.6 57.4 97.4Z" />
    </g>
  );
}

function hairTop(k: Kit, top: Top, col?: string): ReactNode {
  const { hair, detail, hairHl } = k;
  const bun = (cx: number, cy: number, r: number, key?: string) => (
    <g key={key}>
      <circle cx={cx} cy={cy} r={r} fill={hair} {...ol(k)} />
      {detail && (
        <path
          d={`M${cx - r * 0.55} ${cy - r * 0.35} Q${cx} ${cy - r * 0.85} ${cx + r * 0.5} ${cy - r * 0.45}`}
          stroke={hairHl}
          strokeWidth="1.1"
          fill="none"
          strokeLinecap="round"
        />
      )}
    </g>
  );
  switch (top) {
    case "knot":
    case "knotPin":
      return (
        <g>
          {bun(60, 27, 8.4)}
          <rect x="53.4" y="32" width="13.2" height="4" rx="1.4" fill={col ?? k.acc} {...ol(k)} />
          {top === "knotPin" && rod(k, "M45 24.6 L76 21", GOLD, 1.6)}
          {top === "knotPin" && (
            <circle cx="44.6" cy="24.8" r="1.9" fill={RED} {...ol(k, 0.8)} />
          )}
        </g>
      );
    case "guan": {
      const g = col ?? GOLD;
      return (
        <g>
          {bun(60, 28, 7.6)}
          <path d="M51.4 36 L52.6 22.6 Q60 17.4 67.4 22.6 L68.6 36Z" fill={g} {...ol(k)} />
          <path d="M60 18.6 Q67 19.6 67.4 22.6 L68.6 36 L62.4 36Z" fill={shade(g, 0.18)} />
          <path d="M51.4 36 L52.6 22.6 Q60 17.4 67.4 22.6 L68.6 36Z" fill="none" {...ol(k)} />
          {rod(k, "M44.6 30.6 L75.4 28.4", g === GOLD ? GOLD_HL : GOLD, 1.5)}
          {detail && <circle cx="60" cy="28" r="1.8" fill={g === JADE ? RED : JADE} {...ol(k, 0.6)} />}
        </g>
      );
    }
    case "femBun":
    case "femFlower":
      return (
        <g>
          <path
            d="M38 40 C33 26 44 15 56 20 C60 12 76 12 81 22 C88 28 86 40 82 42Z"
            fill={hair}
            {...ol(k)}
          />
          {detail && (
            <path
              d="M43 28 Q48 20 55 22 M63 18 Q72 16 78 23"
              stroke={hairHl}
              strokeWidth="1.1"
              fill="none"
              strokeLinecap="round"
            />
          )}
          {top === "femBun" ? (
            <g>
              {rod(k, "M76 30 L92 20", GOLD, 1.5)}
              <circle cx="92.4" cy="19.6" r="2.4" fill={col ?? JADE} {...ol(k, 0.8)} />
              {detail && (
                <g stroke={GOLD_SH} strokeWidth="0.7">
                  <path d="M88 23 L88.6 31 M90.4 21.8 L91.4 29" />
                  <circle cx="88.6" cy="32" r="1.1" fill={RED} />
                  <circle cx="91.4" cy="30" r="1.1" fill={RED} />
                </g>
              )}
              {flower(k, 41, 30, 4.6, col ?? "#F2A7B4")}
            </g>
          ) : (
            <g>
              {flower(k, 36.6, 36, 5.2, col ?? "#F3B3C0")}
              {flower(k, 44.4, 26.4, 4, "#FFFFFF")}
              {flower(k, 82, 31, 4.4, col ?? "#F3B3C0")}
              {detail && (
                <path
                  d="M36 41 Q35 48 37 54 M38 41 Q39 47 41 52"
                  stroke={GOLD}
                  strokeWidth="0.9"
                  fill="none"
                />
              )}
            </g>
          )}
        </g>
      );
    case "twin":
      return (
        <g>
          {bun(39, 37, 8, "a")}
          {bun(81, 37, 8, "b")}
          <path d="M33 42 Q39 46 45.6 41" stroke={col ?? k.acc} strokeWidth="2.6" fill="none" />
          <path d="M74.4 41 Q81 46 87 42" stroke={col ?? k.acc} strokeWidth="2.6" fill="none" />
          {flower(k, 85.4, 30.8, 3.4, col ?? "#F2A7B4")}
        </g>
      );
    case "pony":
      return (
        <g>
          {bun(60, 27, 7.4)}
          <path d="M53 31 L54 22.6 Q60 19 66 22.6 L67 31 Q60 33 53 31Z" fill={GOLD} {...ol(k)} />
          {detail && <circle cx="60" cy="25.6" r="1.7" fill={RED} />}
        </g>
      );
    default:
      return null;
  }
}

function head(k: Kit, o: HeadOpts, eyeClass?: string, long = false): ReactNode {
  const { pen, skin, skinSh, hair, hairHl, detail, fem, elder, look } = k;
  const fr = fem ? (long ? FRINGE.fem : FRINGE.femUp) : look === 2 || look === 3 ? FRINGE.side : FRINGE.center;
  const top = o.top ?? "knot";
  const blushA = fem ? 0.5 : 0.32;
  return (
    <g>
      {o.behind}
      {top !== "none" && hairTop(k, top, o.topColor)}
      <path d={fem && long ? HAIR_MASS : HAIR_MASS_M} fill={hair} {...ol(k)} />
      {[30.6, 89.4].map((x, i) => (
        <g key={i}>
          <ellipse cx={x} cy="78" rx="3.8" ry="5.6" fill={skin} {...ol(k)} />
          {detail && (
            <path
              d={`M${x + (i ? -0.6 : 0.6)} 74.6 Q${x + (i ? 1.6 : -1.6)} 78 ${x + (i ? -0.2 : 0.2)} 81`}
              stroke={skinSh}
              strokeWidth="0.9"
              fill="none"
            />
          )}
        </g>
      ))}
      <path d={FACE} fill={skin} />
      <g clipPath={pen.clip(FACE)}>
        <path d={fr} transform="translate(0 2.6)" fill={skinSh} opacity="0.55" />
      </g>
      <path d={FACE} fill="none" {...ol(k)} />
      <ellipse cx="39.6" cy="87.4" rx="5.2" ry="2.6" fill="#F1958A" opacity={blushA} />
      <ellipse cx="80.4" cy="87.4" rx="5.2" ry="2.6" fill="#F1958A" opacity={blushA} />
      {elder && detail && (
        <g stroke={skinSh} strokeWidth="0.8" fill="none" strokeLinecap="round">
          <path d="M41 80.4 Q44 82.4 47 81.8 M79 80.4 Q76 82.4 73 81.8" />
        </g>
      )}
      {eyes(k, eyeClass)}
      {brows(k)}
      {detail && (
        <path
          d="M59.4 82.6 Q61.4 85.6 59.2 86.6"
          stroke={skinSh}
          strokeWidth="1.1"
          fill="none"
          strokeLinecap="round"
        />
      )}
      {mouth(k, o.mouth)}
      {facialHair(k)}
      <path d={fr} fill={hair} {...ol(k)} />
      {detail && (
        <g stroke={hairHl} strokeWidth="1.2" fill="none" strokeLinecap="round">
          <path d="M38 48 Q46 39 56 37.4" />
          <path d="M68 37.8 Q76 40 81 45" opacity="0.7" />
          {elder && <path d="M44 52 Q52 46 58 44" stroke={WHITE_SH} />}
        </g>
      )}
      {o.hat}
    </g>
  );
}

// ───────────────────────────── headwear ─────────────────────────────

function goldCrown(k: Kit): ReactNode {
  const { detail } = k;
  const body = "M47.6 38 L46 20 Q60 11.6 74 20 L72.4 38 Q60 34.6 47.6 38Z";
  return (
    <g>
      <path d={body} fill={GOLD} {...ol(k)} />
      <path d="M60 15.4 Q68 16.4 74 20 L72.4 38 Q67 36.4 61 36Z" fill={GOLD_SH} opacity="0.5" />
      {detail && (
        <g stroke={GOLD_SH} strokeWidth="0.9" fill="none">
          <path d="M51.6 34.8 L50.6 18.6 M68.4 34.8 L69.4 18.6 M47 26 Q60 21 73 26" />
          <path d="M53.4 22 Q56 18 60 19.4 Q64 18 66.6 22" />
        </g>
      )}
      <path d={body} fill="none" {...ol(k)} />
      <path d="M45.4 41 Q60 35.4 74.6 41 L74 35.6 Q60 30.6 46 35.6Z" fill={GOLD_HL} {...ol(k)} />
      <circle cx="60" cy="27" r="3.4" fill={RED} {...ol(k, 0.8)} />
      <path d="M57 13 Q60 4.6 63 13Z" fill={GOLD} {...ol(k, 0.9)} />
      <circle cx="60" cy="10.6" r="1.8" fill={RED} {...ol(k, 0.7)} />
      {detail && (
        <>
          <circle cx="59" cy="26" r="1" fill="#fff" opacity="0.8" />
          <circle cx="51.4" cy="38.2" r="1.3" fill={JADE} {...ol(k, 0.5)} />
          <circle cx="68.6" cy="38.2" r="1.3" fill={JADE} {...ol(k, 0.5)} />
        </>
      )}
      {rod(k, "M38 31 L82 29", GOLD, 1.6)}
      <circle cx="37.6" cy="31" r="1.9" fill={JADE} {...ol(k, 0.7)} />
      <circle cx="82.4" cy="29" r="1.9" fill={JADE} {...ol(k, 0.7)} />
      {detail && (
        <g stroke={RED} strokeWidth="1" strokeLinecap="round">
          <path d="M37.4 33 L36 44 M38.4 33 L38.2 45 M82.6 31 L84 42 M81.6 31 L81.8 43" />
        </g>
      )}
    </g>
  );
}

function phoenixCrown(k: Kit): ReactNode {
  const { detail } = k;
  return (
    <g>
      <path d="M38 40 C33 26 44 15 56 20 C60 12 76 12 81 22 C88 28 86 40 82 42Z" fill={k.hair} {...ol(k)} />
      <path d="M40 34 Q42 20 52 21 L56 12.6 L60 19 L64 12.6 L68 21 Q78 20 80 34 Q60 28 40 34Z" fill={GOLD} {...ol(k)} />
      <path d="M60 19 L64 12.6 L68 21 Q78 20 80 34 Q70 30.6 61 30Z" fill={GOLD_SH} opacity="0.5" />
      <circle cx="60" cy="25" r="2.8" fill={RED} {...ol(k, 0.8)} />
      {detail && (
        <>
          <circle cx="49" cy="27" r="1.6" fill={JADE} {...ol(k, 0.6)} />
          <circle cx="71" cy="27" r="1.6" fill={JADE} {...ol(k, 0.6)} />
          <g stroke={GOLD_SH} strokeWidth="0.7">
            <path d="M41 33 L39 50 M44 31.6 L43 46 M79 33 L81 50 M76 31.6 L77 46" />
          </g>
          {[[39, 51], [43, 47], [81, 51], [77, 47]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="1.2" fill={RED} />
          ))}
        </>
      )}
    </g>
  );
}

function futou(k: Kit): ReactNode {
  return (
    <g>
      <path d="M46 33 C45 12 75 12 74 33Z" fill={BLACK} {...ol(k)} />
      <path d="M33 49 C31 31 44 23 60 23 C76 23 89 31 87 49 Q60 43 33 49Z" fill={BLACK} {...ol(k)} />
      <path d="M33 49 Q60 43 87 49 L86.6 45.4 Q60 39.6 33.4 45.4Z" fill="#433B49" {...ol(k, 0.8)} />
      {k.detail && (
        <path d="M40 35 Q50 27 60 26.6" stroke="#5B5262" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      )}
    </g>
  );
}

function wingedHat(k: Kit): ReactNode {
  const wing = (s: number) => {
    const x0 = 60 + s * 18;
    const x1 = 60 + s * 52;
    return (
      <g key={s}>
        <path
          d={`M${x0} 38 L${x1} 34.6 Q${x1 + s * 3} 36.6 ${x1} 38.6 L${x0} 42Z`}
          fill={BLACK}
          {...ol(k)}
        />
        <rect x={Math.min(x1, x1 - s * 4) } y="34.4" width="4" height="4.4" rx="1" fill={GOLD} {...ol(k, 0.7)} transform={`rotate(${s * -3} ${x1} 36.6)`} />
      </g>
    );
  };
  return (
    <g>
      {wing(-1)}
      {wing(1)}
      <path d="M46 37 C45 19 75 19 74 37Z" fill={BLACK} {...ol(k)} />
      <path d="M32 54 C30 36 43 28 60 28 C77 28 90 36 88 54 Q60 48 32 54Z" fill={BLACK} {...ol(k)} />
      <path d="M32 54 Q60 48 88 54 L87.6 50 Q60 44.6 32.4 50Z" fill={GOLD} {...ol(k, 0.8)} />
      {k.detail && (
        <>
          <path d="M41 38 Q50 31.4 60 31" stroke="#5B5262" strokeWidth="1.3" fill="none" strokeLinecap="round" />
          <rect x="57.4" y="40" width="5.2" height="5" rx="1" fill={JADE} {...ol(k, 0.7)} />
        </>
      )}
    </g>
  );
}

function strawHat(k: Kit): ReactNode {
  const { detail } = k;
  const straw = "#D9B36E";
  return (
    <g>
      <path d="M10 52 Q34 40 52 20 Q60 13 68 20 Q86 40 110 52 Q104 56.4 60 54.6 Q16 56.4 10 52Z" fill={straw} {...ol(k)} />
      <path d="M60 15.6 Q66 16 68 20 Q86 40 110 52 Q104 56.4 62 54.6Z" fill={shade(straw, 0.16)} />
      <path d="M10 52 Q34 40 52 20 Q60 13 68 20 Q86 40 110 52 Q104 56.4 60 54.6 Q16 56.4 10 52Z" fill="none" {...ol(k)} />
      {detail && (
        <g stroke={shade(straw, 0.32)} strokeWidth="0.8" fill="none">
          <path d="M60 17 L36 50 M60 17 L48 53 M60 17 L60 54 M60 17 L72 53 M60 17 L84 50" />
          <path d="M33 44 Q60 36 87 44 M45 33 Q60 26 75 33" />
        </g>
      )}
      <path d="M12.4 52.6 Q60 49 107.6 52.6" stroke={k.acc} strokeWidth="2" fill="none" />
      <circle cx="60" cy="16.4" r="2.6" fill={k.acc} {...ol(k, 0.8)} />
    </g>
  );
}

function roundCap(k: Kit): ReactNode {
  return (
    <g>
      <path d="M33 52 C31 34 44 25 60 25 C76 25 89 34 87 52 Q60 46 33 52Z" fill={BLACK} {...ol(k)} />
      <path d="M33 52 Q60 46 87 52 L87 48 Q60 42.4 33 48Z" fill={k.acc} {...ol(k, 0.8)} />
      {k.detail && <path d="M60 26 L60 46 M46 28.6 Q44 38 45 46.4 M74 28.6 Q76 38 75 46.4" stroke="#4A4250" strokeWidth="0.9" fill="none" />}
      <circle cx="60" cy="25" r="2.6" fill={RED} {...ol(k, 0.8)} />
      <rect x="57" y="39.6" width="6" height="5" rx="1.2" fill={JADE} {...ol(k, 0.7)} />
    </g>
  );
}

function smallCap(k: Kit, c = BLACK): ReactNode {
  return (
    <g>
      <path d="M38 50 C36.6 33 47 26.4 60 26.4 C73 26.4 83.4 33 82 50 Q60 45 38 50Z" fill={c} {...ol(k)} />
      <path d="M38 50 Q60 45 82 50" stroke={shade(c, 0.4)} strokeWidth="1.4" fill="none" />
      {k.detail && <path d="M45 36 Q52 30 60 29.6" stroke="#5B5262" strokeWidth="1.2" fill="none" strokeLinecap="round" />}
      <rect x="57" y="39" width="6" height="5" rx="1.2" fill={JADE} {...ol(k, 0.7)} />
    </g>
  );
}

function headband(k: Kit, c: string): ReactNode {
  return (
    <g>
      <path d="M28.6 58 Q60 44 91.4 58 L91 63.4 Q60 50 29 63.4Z" fill={c} {...ol(k)} />
      <path d="M90 58.6 Q99 60 104 70 Q98 68 94 66 M90.6 61 Q97 66 98 76" stroke={OUT} strokeWidth={4 + k.sw * 2} fill="none" strokeLinecap="round" />
      <path d="M90 58.6 Q99 60 104 70 Q98 68 94 66 M90.6 61 Q97 66 98 76" stroke={c} strokeWidth="4" fill="none" strokeLinecap="round" />
    </g>
  );
}

function helmet(k: Kit): ReactNode {
  const { detail } = k;
  const sh = shade(STEEL, 0.25);
  return (
    <g>
      <path d="M26.6 56 L25 84 Q30.4 87 35 82 L35.6 58Z" fill={STEEL} {...ol(k)} />
      <path d="M93.4 56 L95 84 Q89.6 87 85 82 L84.4 58Z" fill={sh} {...ol(k)} />
      <path d="M28.6 58 C26 34 42 22 60 22 C78 22 94 34 91.4 58 Q60 50 28.6 58Z" fill={STEEL} {...ol(k)} />
      <path d="M60 22 C78 22 94 34 91.4 58 Q76 53 62 52.6Z" fill={sh} />
      <path d="M28.6 58 C26 34 42 22 60 22 C78 22 94 34 91.4 58 Q60 50 28.6 58Z" fill="none" {...ol(k)} />
      <path d="M28.6 58 Q60 50 91.4 58 L91.6 52.6 Q60 44.6 28.4 52.6Z" fill={GOLD} {...ol(k)} />
      <path d="M60 22.4 L60 50" stroke={GOLD} strokeWidth="2.6" />
      <path d="M60 22.4 L60 50" stroke={OUT} strokeWidth="0.6" opacity="0.5" />
      {detail && (
        <g fill={GOLD_SH}>
          {[36, 44, 52, 68, 76, 84].map((x) => (
            <circle key={x} cx={x} cy={x < 60 ? 53 - (60 - x) * 0.05 : 53 - (x - 60) * 0.05} r="0.9" />
          ))}
          <path d="M37 38 Q46 28 56 26" stroke="#E2E7ED" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </g>
      )}
      <path d="M56 22.6 L58 13 L62 13 L64 22.6Z" fill={GOLD} {...ol(k)} />
      <path d="M60 13.6 C64 2 80 2 88 12 C90 16 92 22 90 30 C86 22 78 16 70 16 C66 16 62 15.4 60 13.6Z" fill="#C8372D" {...ol(k)} />
      {detail && (
        <path d="M66 10 Q78 8 86 18 M64 13 Q76 13 84 22" stroke="#E25A4E" strokeWidth="1" fill="none" />
      )}
    </g>
  );
}

// ───────────────────────────── props ─────────────────────────────

function hu(k: Kit, x: number, y: number, h = 34, rot = 0, c = "#EDE6CF"): ReactNode {
  return (
    <g transform={`rotate(${rot} ${x} ${y + h / 2})`}>
      <path d={`M${x - 3.4} ${y + 2} Q${x} ${y - 1.4} ${x + 3.4} ${y + 2} L${x + 3.6} ${y + h} L${x - 3.6} ${y + h}Z`} fill={c} {...ol(k)} />
      <path d={`M${x + 1} ${y + 1} L${x + 3.4} ${y + 2} L${x + 3.6} ${y + h} L${x + 1.2} ${y + h}Z`} fill={shade(c, 0.15)} />
    </g>
  );
}

function ruyi(k: Kit, base: P, tip: P): ReactNode {
  return (
    <g>
      {rod(k, `M${base[0]} ${base[1]} Q${(base[0] + tip[0]) / 2 + 4} ${(base[1] + tip[1]) / 2} ${tip[0]} ${tip[1]}`, GOLD, 2.6)}
      <path
        d={`M${tip[0]} ${tip[1] + 2} C${tip[0] - 8} ${tip[1] - 2} ${tip[0] - 5} ${tip[1] - 11} ${tip[0]} ${tip[1] - 7} C${tip[0] + 5} ${tip[1] - 11} ${tip[0] + 8} ${tip[1] - 2} ${tip[0]} ${tip[1] + 2}Z`}
        fill={JADE}
        {...ol(k)}
      />
      <circle cx={tip[0]} cy={tip[1] - 3.4} r="1.5" fill={RED} />
    </g>
  );
}

function hammer(k: Kit, hand: P, headAt: P): ReactNode {
  const dx = headAt[0] - hand[0];
  const dy = headAt[1] - hand[1];
  const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  const end: P = [hand[0] - dx * 0.18, hand[1] - dy * 0.18];
  return (
    <g>
      {rod(k, `M${end[0]} ${end[1]} L${headAt[0]} ${headAt[1]}`, WOOD, 3)}
      <g transform={`translate(${headAt[0]} ${headAt[1]}) rotate(${ang + 90})`}>
        <rect x="-10" y="-5" width="20" height="10" rx="1.6" fill="#7C8594" {...ol(k)} />
        <rect x="-10" y="1.4" width="20" height="3.6" rx="1" fill="#5E6676" />
        <rect x="-10" y="-5" width="20" height="10" rx="1.6" fill="none" {...ol(k)} />
        <rect x="-11.6" y="-5.6" width="3.4" height="11.2" rx="1" fill="#677080" {...ol(k, 0.8)} />
      </g>
    </g>
  );
}

function anvil(k: Kit): ReactNode {
  const { pen } = k;
  return (
    <g>
      <ellipse cx="97" cy="160" rx="16" ry="10" fill={pen.glow("#FFB347", 0.7)} />
      <path d="M86 188 L90 176 L94 176 L94 170 L82 170 Q80 165 86 164 L112 164 L112 170 L102 170 L102 176 L106 176 L110 188Z" fill="#6A7282" {...ol(k)} />
      <path d="M100 164 L112 164 L112 170 L102 170 L102 176 L106 176 L110 188 L100 188Z" fill="#535A68" />
      <path d="M86 188 L90 176 L94 176 L94 170 L82 170 Q80 165 86 164 L112 164 L112 170 L102 170 L102 176 L106 176 L110 188Z" fill="none" {...ol(k)} />
      <rect x="90" y="159" width="15" height="5.4" rx="1.6" fill="#FFB347" {...ol(k)} />
      <rect x="91.6" y="160" width="9" height="2" rx="1" fill="#FFF0B0" />
      {star(88, 152, 3, "#FFC857", 1)}
      {star(106, 150, 2.4, "#FFC857", 2)}
      {star(98, 146, 1.8, "#FFE7A0", 3)}
    </g>
  );
}

function brush(k: Kit, a: P, b: P): ReactNode {
  // a = handle end, b = tip
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const m: P = [a[0] + dx * 0.72, a[1] + dy * 0.72];
  return (
    <g>
      {rod(k, `M${a[0]} ${a[1]} L${m[0]} ${m[1]}`, "#8A5A34", 1.8)}
      {rod(k, `M${m[0]} ${m[1]} L${b[0]} ${b[1]}`, "#2A2430", 2.6)}
      <circle cx={a[0]} cy={a[1]} r="1.1" fill={RED} />
    </g>
  );
}

function bambooRoll(k: Kit, x: number, y: number, h = 30): ReactNode {
  return (
    <g>
      <rect x={x - 6} y={y} width="12" height={h} rx="5" fill={BAMBOO} {...ol(k)} />
      <rect x={x + 1.6} y={y} width="4.4" height={h} rx="2" fill={shade(BAMBOO, 0.18)} />
      <rect x={x - 6} y={y} width="12" height={h} rx="5" fill="none" {...ol(k)} />
      {k.detail && (
        <path d={`M${x - 2.4} ${y + 2} L${x - 2.4} ${y + h - 2} M${x + 1} ${y + 2} L${x + 1} ${y + h - 2}`} stroke={shade(BAMBOO, 0.3)} strokeWidth="0.7" />
      )}
      <path d={`M${x - 6} ${y + h * 0.3} L${x + 6} ${y + h * 0.3} M${x - 6} ${y + h * 0.7} L${x + 6} ${y + h * 0.7}`} stroke={RED} strokeWidth="1.4" />
    </g>
  );
}

function bambooOpen(k: Kit, x0: number, x1: number, y: number, h = 18): ReactNode {
  const n = Math.round((x1 - x0) / 4);
  const w = (x1 - x0) / n;
  return (
    <g>
      <rect x={x0} y={y} width={x1 - x0} height={h} fill={BAMBOO} {...ol(k)} />
      {Array.from({ length: n - 1 }, (_, i) => (
        <path key={i} d={`M${x0 + w * (i + 1)} ${y} L${x0 + w * (i + 1)} ${y + h}`} stroke={shade(BAMBOO, 0.35)} strokeWidth="0.7" />
      ))}
      {k.detail &&
        Array.from({ length: n }, (_, i) =>
          i % 3 === 2 ? null : (
            <path key={"c" + i} d={`M${x0 + w * (i + 0.5)} ${y + 3} L${x0 + w * (i + 0.5)} ${y + h - 4 - (i % 2) * 3}`} stroke={OUT} strokeWidth="1" strokeDasharray="1.6 1.2" />
          ),
        )}
      <path d={`M${x0} ${y + 2.6} L${x1} ${y + 2.6} M${x0} ${y + h - 2.6} L${x1} ${y + h - 2.6}`} stroke={RED} strokeWidth="0.8" />
    </g>
  );
}

function hangingScroll(k: Kit, x: number, y: number, w: number, h: number): ReactNode {
  const { detail } = k;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={PAPER} {...ol(k)} />
      <rect x={x + 2} y={y + 3} width={w - 4} height={h - 6} fill="#FBF6E8" stroke={shade(PAPER, 0.2)} strokeWidth="0.6" />
      <path
        d={`M${x + 2} ${y + h * 0.78} L${x + w * 0.3} ${y + h * 0.42} L${x + w * 0.46} ${y + h * 0.6} L${x + w * 0.66} ${y + h * 0.3} L${x + w - 2} ${y + h * 0.78}Z`}
        fill="#5D6B78"
        opacity="0.85"
      />
      {detail && (
        <path
          d={`M${x + 2} ${y + h * 0.78} L${x + w * 0.22} ${y + h * 0.6} L${x + w * 0.38} ${y + h * 0.72} L${x + w * 0.56} ${y + h * 0.56} L${x + w - 2} ${y + h * 0.78}Z`}
          fill="#8FA39A"
        />
      )}
      <circle cx={x + w * 0.74} cy={y + h * 0.2} r={w * 0.1} fill={RED} />
      {rod(k, `M${x - 3} ${y} L${x + w + 3} ${y}`, WOOD, 3)}
      {rod(k, `M${x - 3} ${y + h} L${x + w + 3} ${y + h}`, WOOD, 3.4)}
    </g>
  );
}

function pipa(k: Kit, x: number, y: number, rot: number): ReactNode {
  const { detail } = k;
  const wood = "#B9773D";
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <path d="M-2.6 -40 L-3.6 -48 Q0 -51 3.6 -48 L2.6 -40Z" fill={wood} {...ol(k)} />
      <rect x="-2.6" y="-40" width="5.2" height="26" fill="#7A4A26" {...ol(k)} />
      {detail && [-36, -31, -26, -21].map((yy) => <path key={yy} d={`M-2.6 ${yy} L2.6 ${yy}`} stroke={GOLD} strokeWidth="1" />)}
      <path d="M-4 -46 L-7 -46 M-4 -42 L-7 -42 M4 -46 L7 -46 M4 -42 L7 -42" stroke={OUT} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M0 -16 C11 -16 15 -1 14 8 C13 19 7 24 0 24 C-7 24 -13 19 -14 8 C-15 -1 -11 -16 0 -16Z" fill={wood} {...ol(k)} />
      <path d="M0 -16 C11 -16 15 -1 14 8 C13 19 7 24 0 24Z" fill={shade(wood, 0.18)} />
      <path d="M0 -16 C11 -16 15 -1 14 8 C13 19 7 24 0 24 C-7 24 -13 19 -14 8 C-15 -1 -11 -16 0 -16Z" fill="none" {...ol(k)} />
      <rect x="-6" y="14" width="12" height="3" rx="1" fill="#5A341A" {...ol(k, 0.7)} />
      {detail && (
        <path d="M-6 0 Q-4 -2 -2 0 M2 0 Q4 -2 6 0" stroke="#5A341A" strokeWidth="1" fill="none" />
      )}
      <path d="M-1.2 -40 L-1.6 15 M1.2 -40 L1.6 15" stroke="#F5E6C8" strokeWidth="0.6" />
    </g>
  );
}

function bookStack(k: Kit, x: number, y: number, n = 3): ReactNode {
  const covers = ["#3E5A86", "#8A3B3B", "#4B6B4E", "#6B4E8A"];
  return (
    <g>
      {Array.from({ length: n }, (_, i) => {
        const yy = y - i * 6.4;
        const c = covers[(i + k.look) % 4];
        const dx = (i % 2 ? 1.4 : -1.2);
        return (
          <g key={i}>
            <rect x={x - 17 + dx} y={yy} width="34" height="6.4" rx="1" fill={PAPER} {...ol(k)} />
            <rect x={x - 17 + dx} y={yy} width="34" height="2.2" rx="0.8" fill={c} {...ol(k, 0.7)} />
            {k.detail && <rect x={x + 6 + dx} y={yy + 0.4} width="5" height="1.4" fill="#fff" opacity="0.8" />}
          </g>
        );
      })}
    </g>
  );
}

function openBook(k: Kit, cx: number, cy: number, cover: string): ReactNode {
  return (
    <g>
      <path d={`M${cx - 20} ${cy - 9} L${cx} ${cy - 6} L${cx + 20} ${cy - 9} L${cx + 20} ${cy + 7} L${cx} ${cy + 10} L${cx - 20} ${cy + 7}Z`} fill={cover} {...ol(k)} />
      <path d={`M${cx - 18.4} ${cy - 11} Q${cx - 9} ${cy - 12} ${cx} ${cy - 8} L${cx} ${cy + 8} Q${cx - 9} ${cy + 4} ${cx - 18.4} ${cy + 5}Z`} fill={PAPER} {...ol(k)} />
      <path d={`M${cx + 18.4} ${cy - 11} Q${cx + 9} ${cy - 12} ${cx} ${cy - 8} L${cx} ${cy + 8} Q${cx + 9} ${cy + 4} ${cx + 18.4} ${cy + 5}Z`} fill="#FBF5E6" {...ol(k)} />
      {k.detail && (
        <g stroke={OUT} strokeWidth="0.9" strokeDasharray="1.6 1.1" opacity="0.75">
          {[0, 1, 2, 3].map((i) => (
            <path key={i} d={`M${cx - 15 + i * 3.6} ${cy - 7.6} L${cx - 15 + i * 3.6} ${cy + 2}`} />
          ))}
          {[0, 1, 2].map((i) => (
            <path key={"r" + i} d={`M${cx + 5 + i * 3.6} ${cy - 7.6} L${cx + 5 + i * 3.6} ${cy + 1}`} />
          ))}
        </g>
      )}
    </g>
  );
}

function closedBook(k: Kit, x: number, y: number, w: number, h: number, c: string, rot = 0): ReactNode {
  return (
    <g transform={`rotate(${rot} ${x + w / 2} ${y + h / 2})`}>
      <rect x={x} y={y} width={w} height={h} rx="1.2" fill={c} {...ol(k)} />
      <rect x={x + w * 0.55} y={y + 3} width={w * 0.28} height={h * 0.5} fill={PAPER} {...ol(k, 0.6)} />
      {k.detail && (
        <g fill={GOLD}>
          {[0.2, 0.4, 0.6, 0.8].map((t) => (
            <circle key={t} cx={x + 2.4} cy={y + h * t} r="0.7" />
          ))}
        </g>
      )}
    </g>
  );
}

function banner(k: Kit, x: number, top: number): ReactNode {
  const { detail, acc } = k;
  const flag = tone(k.c, 0.46, 0.35, 0.56);
  return (
    <g>
      {rod(k, `M${x} ${top} L${x} 188`, "#5B3A22", 2.4)}
      <path d={`M${x + 1} ${top + 8} L${x + 20} ${top + 8} L${x + 20} ${top + 42} L${x + 15} ${top + 37} L${x + 10} ${top + 42} L${x + 5} ${top + 37} L${x + 1} ${top + 42}Z`} fill={flag} {...ol(k)} />
      <path d={`M${x + 1} ${top + 8} L${x + 20} ${top + 8} L${x + 20} ${top + 13} L${x + 1} ${top + 13}Z`} fill={acc} {...ol(k, 0.8)} />
      <circle cx={x + 10.5} cy={top + 24} r="5.4" fill={INNER} {...ol(k, 0.8)} />
      {detail && <path d={`M${x + 8} ${top + 21} L${x + 13} ${top + 21} M${x + 10.5} ${top + 20} L${x + 10.5} ${top + 28} M${x + 8} ${top + 25} L${x + 13} ${top + 25}`} stroke={acc} strokeWidth="1.2" />}
      <path d={`M${x - 3} ${top + 1} L${x} ${top - 9} L${x + 3} ${top + 1}Z`} fill={STEEL} {...ol(k)} />
      <path d={`M${x - 2.6} ${top + 2} Q${x - 6} ${top + 8} ${x - 4} ${top + 13} Q${x} ${top + 8} ${x + 2.6} ${top + 2}Z`} fill="#C8372D" {...ol(k, 0.8)} />
    </g>
  );
}

function warHorn(k: Kit): ReactNode {
  const ivory = "#EADCB8";
  return (
    <g>
      <path d="M57.6 92.6 Q44 92 33 78.4 L26.4 86.4 Q40 98.4 57.6 95.6Z" fill={ivory} {...ol(k)} />
      <path d="M57.6 94.4 Q42 96 28.6 84 L26.4 86.4 Q40 98.4 57.6 95.6Z" fill={shade(ivory, 0.2)} />
      <path d="M45.4 89 L42.4 95.4 M37 84 L33.6 90.6" stroke={GOLD} strokeWidth="2.2" />
      <ellipse cx="29.6" cy="82.4" rx="3.4" ry="6.4" transform="rotate(40 29.6 82.4)" fill={ivory} {...ol(k)} />
      <ellipse cx="29.6" cy="82.4" rx="1.8" ry="4" transform="rotate(40 29.6 82.4)" fill="#7A6040" />
    </g>
  );
}

function horn(k: Kit, d: string, bell: P, r: number): ReactNode {
  return (
    <g>
      {rod(k, d, "#E8D9B6", 3.6)}
      <ellipse cx={bell[0]} cy={bell[1]} rx={r * 0.55} ry={r} fill="#E8D9B6" {...ol(k)} />
      <ellipse cx={bell[0]} cy={bell[1]} rx={r * 0.3} ry={r * 0.62} fill="#7A6040" />
    </g>
  );
}

function abacus(k: Kit, x: number, y: number, w: number, h: number, rot = 0): ReactNode {
  const { detail } = k;
  const cols = Math.round(w / 5.2);
  const cw = (w - 4) / cols;
  const beads = [];
  if (detail || true) {
    for (let i = 0; i < cols; i++) {
      const cx = x + 2 + cw * (i + 0.5);
      beads.push(<ellipse key={"t" + i} cx={cx} cy={y + 3.6 + ((i + k.look) % 3 === 0 ? 1.2 : 0)} rx="2" ry="1.3" fill="#7A3B2C" />);
      const lower = (i * 7 + k.look) % 4;
      for (let j = 0; j < 3; j++) {
        beads.push(
          <ellipse key={i + "b" + j} cx={cx} cy={y + h - 3 - j * 2.9 - (j >= lower ? 0 : 1.6)} rx="2" ry="1.3" fill="#7A3B2C" />,
        );
      }
    }
  }
  return (
    <g transform={`rotate(${rot} ${x + w / 2} ${y + h / 2})`}>
      <rect x={x} y={y} width={w} height={h} rx="1.6" fill="#F0E2C4" {...ol(k)} />
      {Array.from({ length: cols }, (_, i) => (
        <path key={i} d={`M${x + 2 + cw * (i + 0.5)} ${y + 1} L${x + 2 + cw * (i + 0.5)} ${y + h - 1}`} stroke="#8B6A44" strokeWidth="0.6" />
      ))}
      {beads}
      <path d={`M${x} ${y + 7} L${x + w} ${y + 7}`} stroke={WOOD} strokeWidth="1.6" />
      <rect x={x} y={y} width={w} height={h} rx="1.6" fill="none" stroke={WOOD} strokeWidth="2.2" />
      <rect x={x - 1.1} y={y - 1.1} width={w + 2.2} height={h + 2.2} rx="2.2" fill="none" {...ol(k)} />
    </g>
  );
}

function pouch(k: Kit, x: number, y: number): ReactNode {
  return (
    <g>
      <path d={`M${x - 5} ${y} Q${x - 7} ${y + 10} ${x} ${y + 11} Q${x + 7} ${y + 10} ${x + 5} ${y}Z`} fill="#B8352F" {...ol(k)} />
      <path d={`M${x - 5.4} ${y} L${x + 5.4} ${y}`} stroke={GOLD} strokeWidth="1.8" />
      <circle cx={x} cy={y + 6} r="2.4" fill={GOLD} {...ol(k, 0.6)} />
      <rect x={x - 0.8} y={y + 5.2} width="1.6" height="1.6" fill={GOLD_SH} />
    </g>
  );
}

function coin(k: Kit, x: number, y: number, r: number, key?: number): ReactNode {
  return (
    <g key={key}>
      <circle cx={x} cy={y} r={r} fill={GOLD} {...ol(k, 0.8)} />
      <rect x={x - r * 0.3} y={y - r * 0.3} width={r * 0.6} height={r * 0.6} fill={GOLD_SH} />
    </g>
  );
}

function keys(k: Kit, x: number, y: number): ReactNode {
  return (
    <g>
      <circle cx={x} cy={y} r="3.4" fill="none" stroke={OUT} strokeWidth={1.6 + k.sw * 2} />
      <circle cx={x} cy={y} r="3.4" fill="none" stroke={GOLD} strokeWidth="1.6" />
      {[-1, 0, 1].map((i) => (
        <g key={i} transform={`rotate(${i * 22} ${x} ${y})`}>
          {rod(k, `M${x} ${y + 3.4} L${x} ${y + 13}`, GOLD, 1.4)}
          <path d={`M${x} ${y + 11} L${x + 2.6} ${y + 11} M${x} ${y + 13} L${x + 2} ${y + 13}`} stroke={GOLD_SH} strokeWidth="1.1" />
        </g>
      ))}
    </g>
  );
}

function seal(k: Kit, x: number, y: number): ReactNode {
  return (
    <g>
      <rect x={x - 5.4} y={y} width="10.8" height="7" rx="1" fill={JADE} {...ol(k)} />
      <rect x={x + 1.4} y={y} width="4" height="7" fill={shade(JADE, 0.2)} />
      <path d={`M${x - 4.4} ${y} Q${x - 4.4} ${y - 7} ${x} ${y - 7} Q${x + 4.4} ${y - 7} ${x + 4.4} ${y}Z`} fill={JADE} {...ol(k)} />
      <circle cx={x - 1.4} cy={y - 4} r="1" fill="#fff" opacity="0.7" />
      <rect x={x - 5.4} y={y + 5} width="10.8" height="2.4" fill={RED} {...ol(k, 0.6)} />
    </g>
  );
}

function rankBadge(k: Kit, x: number, y: number, s: number): ReactNode {
  return (
    <g>
      <rect x={x - s / 2} y={y - s / 2} width={s} height={s} fill={k.sec === SEC[3] ? SEC[0] : k.sec} stroke={GOLD} strokeWidth="2" />
      <rect x={x - s / 2 - 1} y={y - s / 2 - 1} width={s + 2} height={s + 2} fill="none" {...ol(k)} />
      {k.detail ? (
        <g>
          <path d={`M${x - 5} ${y + 3} Q${x - 1} ${y - 5} ${x + 5} ${y - 4} Q${x + 1} ${y - 2} ${x + 1} ${y + 2} Q${x - 2} ${y + 4} ${x - 5} ${y + 3}Z`} fill="#fff" />
          <path d={`M${x + 1} ${y - 1} Q${x + 3} ${y - 7} ${x + 5.4} ${y - 6}`} stroke="#fff" strokeWidth="1.1" fill="none" />
          <circle cx={x + 5.4} cy={y - 6.2} r="1" fill={RED} />
          <path d={`M${x - 6} ${y + 6} Q${x - 3} ${y + 4} ${x} ${y + 6} Q${x + 3} ${y + 4} ${x + 6} ${y + 6}`} stroke={GOLD_HL} strokeWidth="0.9" fill="none" />
        </g>
      ) : (
        <circle cx={x} cy={y} r={s * 0.22} fill="#fff" />
      )}
    </g>
  );
}

function furCollar(k: Kit, c: string): ReactNode {
  const pts: P[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = Math.PI * (i / 10);
    pts.push([60 - Math.cos(t) * 27, 108 + Math.sin(t) * 9]);
  }
  let d = "M32 104 Q34 96 46 98 Q60 104 74 98 Q86 96 88 104";
  for (let i = 10; i >= 0; i--) {
    const [x, y] = pts[i];
    d += ` Q${x + 1.6} ${y + 4.4} ${x - 0.4} ${y}`;
  }
  d += "Z";
  return (
    <g>
      <path d={d} fill={c} {...ol(k)} />
      {k.detail && <path d="M38 107 Q48 113 60 114 Q72 113 82 107" stroke={shade(c, 0.22)} strokeWidth="1" fill="none" />}
    </g>
  );
}

function armor(k: Kit): ReactNode {
  const { pen, detail } = k;
  const lam = pen.pattern(
    "lam",
    5,
    8.8,
    <g fill="none" stroke="#5E6674" strokeWidth="0.55">
      <path d="M0 4.4 L5 4.4 M0 8.8 L5 8.8 M0 0 L0 4.4 M2.5 4.4 L2.5 8.8" />
    </g>,
  );
  const chest = "M40 104 Q60 110 80 104 L83.6 146 Q60 151 36.4 146Z";
  return (
    <g>
      <path d={chest} fill={STEEL} />
      {detail && <path d={chest} fill={lam} />}
      <path d="M68 106 Q78 106 80 104 L83.6 146 Q76 149 70 149.6Z" fill="#7E8794" opacity="0.5" />
      <path d={chest} fill="none" {...ol(k)} />
      {/* tassets */}
      <path d="M36.4 146 Q60 151 83.6 146 L86 162 Q73 166 60.6 163 L59.4 163 Q47 166 34 162Z" fill={STEEL} />
      {detail && <path d="M36.4 146 Q60 151 83.6 146 L86 162 Q73 166 60.6 163 L59.4 163 Q47 166 34 162Z" fill={lam} />}
      <path d="M36.4 146 Q60 151 83.6 146 L86 162 Q73 166 60.6 163 L59.4 163 Q47 166 34 162Z" fill="none" {...ol(k)} />
      <path d="M60 150 L60 163" {...ol(k)} />
      {/* chest mirror */}
      <circle cx="60" cy="122" r="7.4" fill={GOLD} {...ol(k)} />
      <circle cx="60" cy="122" r="5" fill="#D3D9E0" {...ol(k, 0.7)} />
      {detail && <path d="M57.4 119.6 Q59 118.6 61 118.8" stroke="#fff" strokeWidth="1" fill="none" />}
      {/* belt with beast buckle */}
      <path d="M36.2 140 Q60 145 83.8 140 L84.2 147 Q60 152 35.8 147Z" fill="#6B3A2A" {...ol(k)} />
      <circle cx="60" cy="145.4" r="4" fill={GOLD} {...ol(k)} />
      {detail && <path d="M58 144.6 L58.4 145 M61.6 144.6 L62 145 M58.4 147 Q60 148 61.6 147" stroke={OUT} strokeWidth="0.8" />}
    </g>
  );
}

function pauldron(k: Kit, x: number, s: -1 | 1): ReactNode {
  const out = (dx: number) => x + s * dx;
  const plate = (y: number, w: number, i: number) => (
    <path
      key={i}
      d={`M${out(-4)} ${y} Q${out(w * 0.5)} ${y - 5} ${out(w)} ${y + 2} L${out(w + 1)} ${y + 7} Q${out(w * 0.4)} ${y + 3} ${out(-4)} ${y + 6}Z`}
      fill={i === 0 ? GOLD : STEEL}
      {...ol(k)}
    />
  );
  return (
    <g>
      {plate(114, 11, 2)}
      {plate(109, 10, 1)}
      {plate(104, 9, 0)}
    </g>
  );
}

// ───────────────────────────── roles ─────────────────────────────

interface RoleArt {
  robe: string;
  trim: string;
  hem?: number;
  flare?: number;
  collar?: Collar;
  belt?: ReactNode | "none";
  front?: boolean; // front opening trim
  legs?: ReactNode; // trousers etc. under a short tunic
  tallBoots?: boolean;
  long?: boolean; // long hair hanging behind
  back?: ReactNode;
  cloth?: ReactNode;
  outfit?: ReactNode;
  L: P;
  R: P;
  sleeve?: SleeveKind;
  sleeveC?: string;
  sleeveW?: number;
  shoulders?: ReactNode;
  front2?: ReactNode; // props before hands
  over?: ReactNode; // after head
  overHands?: P[];
  hideHands?: boolean;
  head: HeadOpts;
}

const SL: P = [39, 109];
const SR: P = [81, 109];

// Which looks are women / bearded, per role (mixes the court across looks).
const CAST: Record<Role, { fem: number[]; beard: number[] }> = {
  vizier: { fem: [1, 3], beard: [2] },
  smith: { fem: [2, 3], beard: [1] },
  scribe: { fem: [1, 3], beard: [2] },
  painter: { fem: [0, 3], beard: [2] },
  bard: { fem: [0, 1], beard: [] },
  archivist: { fem: [1, 3], beard: [] },
  herald: { fem: [1, 3], beard: [2] },
  merchant: { fem: [0, 3], beard: [1] },
  steward: { fem: [1, 3], beard: [] },
  magistrate: { fem: [0, 3], beard: [1, 2] },
};
const EXPR: Expr[] = ["cheer", "gentle", "stern", "smirk"];

function roleArt(role: Role, k: Kit): RoleArt {
  const { work, detail, fem, look, c, acc, sec } = k;
  switch (role) {
    case "vizier": {
      const robe = "#E8B744";
      return {
        robe,
        trim: acc,
        belt: belt(k, acc),
        long: fem,
        cloth: (
          <g>
            <g fill="none" strokeLinecap="round">
              <path d="M44 166 C38 156 46 146 54 152 C62 158 70 150 66 142 C63 136 72 134 76 140" stroke={RED} strokeWidth={detail ? 2.4 : 3} />
              {detail && (
                <>
                  <path d="M44 166 C38 156 46 146 54 152 C62 158 70 150 66 142 C63 136 72 134 76 140" stroke={GOLD_HL} strokeWidth="0.8" strokeDasharray="1.4 1.4" />
                  <path d="M76 140 l3 -2 M76 140 l1 -3.4 M52 151 l-1 3 M60 154 l1 3" stroke={RED} strokeWidth="1.2" />
                </>
              )}
            </g>
            {detail && <circle cx="77" cy="139.4" r="2.2" fill={RED} />}
            {detail && (
              <path d="M30 174 Q34 170 38 174 Q42 170 46 174 Q50 170 54 174 Q58 170 62 174 Q66 170 70 174 Q74 170 78 174 Q82 170 86 174 Q90 170 94 174" stroke={GOLD_SH} strokeWidth="1.1" fill="none" />
            )}
            <path d="M36 112 Q48 118 60 116 Q72 118 84 112 L84 124 Q72 128 60 126 Q48 128 36 124Z" fill={shade(robe, 0.08)} />
            {detail && <path d="M38 118 Q42 115 46 118 Q50 115 54 118 M66 118 Q70 115 74 118 Q78 115 82 118" stroke={GOLD_SH} strokeWidth="1" fill="none" />}
          </g>
        ),
        L: work ? [52, 128] : [55, 127],
        R: work ? [96, 98] : [65.5, 128],
        sleeveW: 12,
        front2: work ? (
          <g>
            {hu(k, 52, 110, 26, -12)}
            {ruyi(k, [96, 106], [104, 74])}
            {detail && star(110, 68, 2.4, GOLD, 1)}
            {detail && star(94, 66, 1.6, GOLD, 2)}
          </g>
        ) : (
          hu(k, 60, 104, 36)
        ),
        head: fem ? { top: "none", hat: phoenixCrown(k) } : { top: "none", hat: goldCrown(k) },
      };
    }
    case "smith": {
      const tunic = tone(c, 0.46, 0.22, 0.42);
      const leather = "#8B5A35";
      return {
        robe: tunic,
        trim: shade(tunic, 0.3),
        hem: 156,
        legs: trousers(k, "#3E3A4A", sec === SEC[3] ? "#C9B99A" : lighten(sec, 0.5)),
        tallBoots: true,
        sleeve: "short",
        belt: "none",
        front: false,
        outfit: (
          <g>
            <path d="M46 106 L52 112 M74 106 L68 112" stroke={leather} strokeWidth="2" />
            <path d="M47 112 L73 112 L77 166 Q60 169.4 43 166Z" fill={leather} {...ol(k)} />
            <path d="M66 112 L73 112 L77 166 Q71 167.6 68 167.6Z" fill={shade(leather, 0.2)} />
            <path d="M47 112 L73 112 L77 166 Q60 169.4 43 166Z" fill="none" {...ol(k)} />
            {detail && <rect x="52" y="140" width="12" height="9" rx="1.4" fill={shade(leather, 0.12)} {...ol(k, 0.8)} />}
            {detail && <path d="M48 114 L48.6 163 M72 114 L75 163" stroke="#C9965E" strokeWidth="0.8" strokeDasharray="1.6 1.4" fill="none" />}
            <path d="M33.6 127 Q60 131.5 86.4 127 L86.9 133.5 Q60 138 33.1 133.5Z" fill={sec} {...ol(k)} />
            <path d="M40 131 L36 146 L40.6 146 L43 132Z" fill={sec} {...ol(k, 0.9)} />
          </g>
        ),
        L: work ? [72, 148] : [31, 145],
        R: work ? [96, 98] : [87, 134],
        front2: work ? (
          <g>
            {anvil(k)}
            {rod(k, "M72 150 L90 159", "#4A4A55", 1.6)}
            {rod(k, "M73 152 L91 162", "#4A4A55", 1.6)}
          </g>
        ) : (
          hammer(k, [87, 134], [96, 104])
        ),
        over: work ? hammer(k, [96, 98], [104, 72]) : undefined,
        overHands: work ? [[96, 98]] : undefined,
        head: {
          top: fem ? "femBun" : "knot",
          topColor: fem ? RED : sec,
          hat: headband(k, sec === SEC[3] ? "#B8352F" : sec),
        },
      };
    }
    case "scribe": {
      const robe = lighten(tone(c, 0.55, 0.25, 0.5), 0.78);
      const trim = tone(c, 0.32, 0.3, 0.55);
      return {
        robe,
        trim,
        long: fem,
        belt: belt(k, trim),
        L: work ? [32, 133] : [50, 124],
        R: work ? [72, 126] : [89, 148],
        front2: work ? (
          <g>
            {bambooOpen(k, 26, 70, 128, 17)}
            {brush(k, [78, 112], [70, 130])}
          </g>
        ) : (
          <g>
            {bambooRoll(k, 47, 104, 30)}
            {brush(k, [86, 136], [92, 162])}
          </g>
        ),
        head: fem
          ? { top: "guan", topColor: "#E8E4DA" }
          : { top: "none", hat: futou(k) },
      };
    }
    case "painter": {
      const robe = tone(c, 0.76, 0.3, 0.55);
      const trim = tone(c, 0.42, 0.3, 0.55);
      return {
        robe,
        trim,
        flare: 3,
        long: true,
        belt: belt(k, sec === SEC[3] ? trim : sec),
        cloth: (
          <path d="M33 112 Q40 150 28 186 L22 186 L22 108Z M87 112 Q80 150 92 186 L98 186 L98 108Z" fill={lighten(robe, 0.45)} opacity="0.55" />
        ),
        L: work ? [34, 140] : [28, 140],
        R: work ? [88, 118] : [89, 142],
        sleeveW: 12.5,
        back: work ? (
          <g>
            {rod(k, "M104 80 L104 188", WOOD, 2.4)}
            {rod(k, "M92 80 L116 80", WOOD, 2.4)}
          </g>
        ) : undefined,
        front2: work ? (
          <g>
            {hangingScroll(k, 93, 82, 22, 56)}
            {brush(k, [84, 106], [94, 118])}
            <ellipse cx="34" cy="146" rx="8" ry="3.4" fill="#EEE6D6" {...ol(k)} />
            <circle cx="31" cy="145.6" r="1.6" fill="#2A2430" />
            <circle cx="36" cy="145.6" r="1.4" fill={RED} />
          </g>
        ) : (
          <g>
            {hangingScroll(k, 15, 139, 26, 44)}
            {brush(k, [86, 134], [92, 158])}
          </g>
        ),
        head: { top: fem ? "femBun" : "knotPin", topColor: fem ? acc : sec },
      };
    }
    case "bard": {
      const dress = tone(c, 0.78, 0.3, 0.55);
      const trim = tone(c, 0.48, 0.3, 0.52);
      const ribbon = sec === SEC[3] ? lighten(trim, 0.5) : lighten(sec, 0.55);
      return {
        robe: dress,
        trim,
        flare: 7,
        long: true,
        belt: (
          <g>
            <path d="M34 120 Q60 124 86 120 L86.4 131 Q60 135 33.6 131Z" fill={sec === SEC[3] ? trim : sec} {...ol(k)} />
            {detail && <path d="M34 123 Q60 127 86 123" stroke={GOLD} strokeWidth="0.8" fill="none" />}
            {rod(k, "M57 133 Q54 146 50 160", ribbon, 2.6)}
            {rod(k, "M62 133 Q64 146 67 158", ribbon, 2.6)}
          </g>
        ),
        cloth: (
          <g>
            <path d="M22 150 Q60 158 98 150 L98 200 L22 200Z" fill={lighten(dress, 0.4)} />
            <path d="M22 150 Q60 158 98 150" stroke={OUT} strokeWidth={k.sw} fill="none" />
            {detail && [38, 50, 70, 82].map((x) => flower(k, x, 166 + (x % 3), 2.2, "#F6C2CC", x))}
          </g>
        ),
        back: (
          <g>
            {rod(k, "M41 108 C22 112 16 140 22 178", ribbon, 4)}
            {rod(k, "M79 108 C98 112 104 140 98 178", ribbon, 4)}
          </g>
        ),
        L: work ? [75, 117] : [74, 114],
        R: work ? [52, 150] : [54, 148],
        sleeveW: 12,
        front2: (
          <g>
            {pipa(k, 62, 142, 24)}
            {work && detail && (
              <g fill={trim}>
                <g transform="translate(96 96) scale(0.5)">
                  <ellipse cx="0" cy="8" rx="4.2" ry="3.2" transform="rotate(-20 0 8)" />
                  <rect x="2.6" y="-8" width="1.8" height="16" rx="0.9" />
                </g>
                <g transform="translate(22 104) scale(0.42)">
                  <ellipse cx="0" cy="8" rx="4.2" ry="3.2" transform="rotate(-20 0 8)" />
                  <rect x="2.6" y="-8" width="1.8" height="16" rx="0.9" />
                </g>
              </g>
            )}
          </g>
        ),
        head: fem
          ? { top: "femFlower", topColor: look === 0 ? "#F3B3C0" : lighten(trim, 0.35) }
          : { top: "guan", topColor: JADE },
      };
    }
    case "archivist": {
      const robe = tone(c, 0.26, 0.25, 0.48);
      const trim = "#C29A55";
      const fur = look === 0 || look === 2;
      return {
        robe,
        trim,
        long: false,
        belt: belt(k, sec === SEC[3] ? "#5A4A3A" : sec),
        outfit: fur ? furCollar(k, look === 2 ? "#6E5A48" : "#E7DDCB") : undefined,
        L: work ? [41, 130] : [43, 133],
        R: work ? [79, 130] : [77, 133],
        back: work ? (
          <g>
            {bambooRoll(k, 14, 168, 20)}
            {bambooRoll(k, 24, 172, 16)}
          </g>
        ) : undefined,
        front2: work ? openBook(k, 60, 129, shade(trim, 0.3)) : bookStack(k, 60, 132, 3),
        head: k.elder
          ? { top: "guan", topColor: BLACK }
          : fem
            ? { top: "femBun", topColor: JADE }
            : { top: "guan", topColor: "#C8CCD2" },
      };
    }
    case "herald": {
      const under = tone(c, 0.44, 0.35, 0.56);
      return {
        robe: under,
        trim: shade(under, 0.3),
        hem: 166,
        legs: trousers(k, "#3E3A4A", "#8A7A62"),
        tallBoots: true,
        belt: "none",
        front: false,
        sleeve: "narrow",
        outfit: armor(k),
        shoulders: (
          <g>
            {pauldron(k, 38, -1)}
            {pauldron(k, 82, 1)}
          </g>
        ),
        back: (
          <g>
            <path d="M40 106 C30 130 28 160 30 180 Q46 184 60 182 Q74 184 90 180 C92 160 90 130 80 106Z" fill={shade(under, 0.35)} {...ol(k)} />
            {banner(k, 95, 14)}
          </g>
        ),
        L: work ? [46, 97] : [31, 143],
        R: [93, 138],
        front2: work ? undefined : horn(k, "M45 158 Q36 166 27 158", [26, 157.4], 3.8),
        over: work ? warHorn(k) : undefined,
        overHands: work ? [[46, 97]] : undefined,
        head: {
          ...(fem
            ? {
                top: "pony" as Top,
                behind: rod(k, "M58 24 C38 20 28 42 30 72 C31 90 26 102 22 112", k.hair, 7),
              }
            : { top: "none" as Top, hat: helmet(k) }),
          mouth: work ? ("o" as const) : undefined,
        },
      };
    }
    case "merchant": {
      const robe = tone(c, 0.44, 0.3, 0.5);
      const trim = sec === SEC[3] ? shade(robe, 0.4) : sec;
      const pat = k.pen.pattern(
        "coin",
        10,
        10,
        <g fill="none" stroke={lighten(robe, 0.35)} strokeWidth="0.7">
          <circle cx="2.5" cy="2.5" r="1.7" />
          <rect x="1.9" y="1.9" width="1.2" height="1.2" />
          <circle cx="7.5" cy="7.5" r="1.7" />
          <rect x="6.9" y="6.9" width="1.2" height="1.2" />
        </g>,
      );
      const hat = look % 2 === 0 ? strawHat(k) : fem ? undefined : roundCap(k);
      return {
        robe,
        trim,
        long: false,
        belt: (
          <g>
            {belt(k, GOLD_SH, false)}
            {pouch(k, 78, 135)}
          </g>
        ),
        cloth: detail ? <rect x="0" y="100" width="120" height="100" fill={pat} /> : undefined,
        L: work ? [38, 136] : [40, 132],
        R: work ? [66, 124] : [80, 132],
        front2: work ? (
          <g>
            {abacus(k, 32, 124, 34, 18, -8)}
            {coin(k, 80, 112, 3, 1)}
            {coin(k, 88, 120, 2.4, 2)}
            {detail && star(84, 104, 2, GOLD, 3)}
          </g>
        ) : (
          abacus(k, 38, 123, 44, 18)
        ),
        head: hat
          ? { top: fem ? "femBun" : "knot", hat }
          : { top: "femBun", topColor: RED },
      };
    }
    case "steward": {
      const robe = tone(c, 0.5, 0.28, 0.5);
      const trim = sec === SEC[3] ? shade(robe, 0.35) : sec;
      return {
        robe,
        trim,
        belt: (
          <g>
            {belt(k, "#3A3340", false)}
            {keys(k, 41, 137)}
          </g>
        ),
        L: work ? [40, 132] : [47, 124],
        R: work ? [76, 124] : [88, 148],
        front2: work ? (
          <g>
            {openBook(k, 46, 134, "#4B5F7A")}
            {brush(k, [82, 108], [70, 128])}
          </g>
        ) : (
          closedBook(k, 39, 108, 15, 22, "#4B5F7A", -8)
        ),
        head: fem ? { top: "twin", topColor: acc } : { top: "none", hat: smallCap(k) },
      };
    }
    case "magistrate": {
      const robe = tone(c, 0.38, 0.32, 0.52);
      return {
        robe,
        trim: shade(robe, 0.35),
        collar: "round",
        front: false,
        belt: (
          <g>
            <path d="M33 128 Q60 133 87 128 L87.6 136 Q60 141 32.4 136Z" fill="#2E2A33" {...ol(k)} />
            {[40, 50, 70, 80].map((x) => (
              <rect key={x} x={x - 2.6} y={x === 40 || x === 80 ? 129.4 : 131} width="5.2" height="5" rx="1" fill={JADE} {...ol(k, 0.7)} />
            ))}
            <rect x="56.6" y="131.4" width="6.8" height="6" rx="1" fill={GOLD} {...ol(k, 0.8)} />
          </g>
        ),
        outfit: rankBadge(k, 60, 117, 17),
        L: work ? [36, 140] : [53, 144],
        R: work ? [62, 134] : [67, 144],
        front2: work ? (
          <g>
            <rect x="28" y="140" width="30" height="18" fill={PAPER} {...ol(k)} transform="rotate(-6 43 149)" />
            {detail && <path d="M32 144 L32 154 M36 144 L36 152 M40 144 L40 155" stroke={OUT} strokeWidth="0.9" strokeDasharray="1.6 1.1" transform="rotate(-6 43 149)" />}
            <rect x="46" y="146" width="7" height="7" fill="none" stroke={RED} strokeWidth="1.4" transform="rotate(-6 43 149)" />
            {seal(k, 62, 126)}
          </g>
        ) : (
          seal(k, 60, 140)
        ),
        overHands: work ? undefined : undefined,
        head: { top: "none", hat: wingedHat(k) },
      };
    }
  }
}

// ───────────────────────────── assembly ─────────────────────────────

export interface DrawOpts {
  pose?: Pose;
  eyeClass?: string;
  detail?: boolean;
}

export function drawPerson(
  pen: Pen,
  role: Role,
  look: number,
  color: string,
  o: DrawOpts = {},
): ReactNode {
  const lk = ((look % 4) + 4) % 4;
  const cast = CAST[role];
  const fem = cast.fem.includes(lk);
  const elder = role === "archivist" && lk === 2;
  const skin = SKIN[lk];
  const detail = o.detail ?? true;
  const k: Kit = {
    pen,
    c: color,
    acc: tone(color, 0.36, 0.35, 0.56),
    sec: SEC[lk],
    skin,
    skinSh: mix(skin, "#B9675C", 0.32),
    hair: elder ? WHITE_HAIR : HAIR,
    hairHl: elder ? WHITE_SH : HAIR_HL,
    look: lk,
    fem,
    beard: !fem && cast.beard.includes(lk),
    elder,
    expr: elder ? "gentle" : EXPR[lk],
    work: o.pose === "work",
    detail,
    sw: detail ? 1.2 : 1.7,
  };
  const a = roleArt(role, k);
  const hem = a.hem ?? 180;
  const kind = a.sleeve ?? "wide";
  const sc = a.sleeveC ?? a.robe;
  return (
    <g>
      {a.back}
      {a.long && <path d={LONG_HAIR} fill={k.hair} {...ol(k)} />}
      {a.legs}
      {boots(k, a.tallBoots)}
      <path d="M53.6 95 L53.6 106 L66.4 106 L66.4 95Z" fill={skin} {...ol(k)} />
      <path d="M53.6 95 L66.4 95 L66.4 101.4 Q60 104.6 53.6 101.4Z" fill={k.skinSh} />
      {robeBody(k, {
        c: a.robe,
        trim: a.trim,
        hem,
        flare: a.flare ?? 0,
        collar: a.collar ?? "cross",
        belt: a.belt,
        cloth: a.cloth,
        front: a.front,
      })}
      {a.outfit}
      {sleeve(k, SL, a.L, -1, sc, a.trim, kind, a.sleeveW)}
      {sleeve(k, SR, a.R, 1, sc, a.trim, kind, a.sleeveW)}
      {a.shoulders}
      {a.front2}
      {!a.hideHands && hand(k, a.L, "l")}
      {!a.hideHands && hand(k, a.R, "r")}
      {head(k, a.head, o.eyeClass, !!a.long)}
      {a.over}
      {a.overHands?.map((h, i) => hand(k, h, "o" + i))}
    </g>
  );
}

// keep darken referenced for palette tweaks
void darken;
