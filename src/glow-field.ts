// Procedural glow field for the Scout overlay (owner, 2026-10-24: "a multitude
// of procedurally generated glowing"). On every show the overlay lays out a new
// set of soft glowing orbs that drift near the edges and tiny sparkles that
// twinkle, on top of the conic sweep. Orbs and sparkles stay near the edges so
// the middle of the page keeps reading. Pure: the overlay passes Math.random,
// tests pass a seeded generator. Only opacity and transform animate (no blur
// filters), so many of them stay cheap on iPhone.

export type Rng = () => number;

export interface GlowOrb {
  /** Center, in percent of the page's width and height. */
  x: number;
  y: number;
  /** Diameter in vmin. */
  size: number;
  color: string;
  /** How far it drifts, in vmin. */
  dx: number;
  dy: number;
  /** One drift there and back, in ms; a negative delay starts it mid-way. */
  duration: number;
  delay: number;
  /** Peak opacity, 0 to 1. */
  peak: number;
}

export interface GlowSparkle {
  x: number;
  y: number;
  /** Diameter in px. */
  size: number;
  color: string;
  duration: number;
  delay: number;
}

export interface GlowField {
  orbs: GlowOrb[];
  sparkles: GlowSparkle[];
}

// Safari blues and cyans with a touch of indigo and teal, so the field has depth
// while still reading as the one blue glow the owner chose (2026-10-17).
export const GLOW_COLORS = ["#0A84FF", "#1A9BE8", "#2BBCE6", "#33CCF0", "#64D2FF", "#5E5CE6", "#30D5C8"] as const;
export const SPARKLE_COLORS = ["#D6F4FF", "#8FE3FF", "#64D2FF", "#FFFFFF"] as const;

// Owner, 2026-10-24: "subtler" than the first preview (12/8 orbs, 36/22 sparkles).
export const ORBS = { mac: 8, phone: 5 } as const;
export const SPARKLES = { mac: 18, phone: 12 } as const;

const between = (rng: Rng, lo: number, hi: number): number => lo + (hi - lo) * rng();
const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(rng() * list.length))]!;
const round = (n: number): number => Math.round(n * 10) / 10;

/** A point near one of the four edges: up to `depth` percent in from it. */
function nearEdge(rng: Rng, depth: number): { x: number; y: number } {
  const along = between(rng, -5, 105);
  const inward = Math.pow(rng(), 1.6) * depth;
  switch (Math.floor(rng() * 4)) {
    case 0:
      return { x: along, y: inward };
    case 1:
      return { x: 100 - inward, y: along };
    case 2:
      return { x: along, y: 100 - inward };
    default:
      return { x: inward, y: along };
  }
}

export function glowField(rng: Rng, phone: boolean): GlowField {
  const orbs: GlowOrb[] = [];
  for (let i = 0; i < (phone ? ORBS.phone : ORBS.mac); i++) {
    const at = nearEdge(rng, 18);
    const duration = Math.round(between(rng, 5000, 12000));
    orbs.push({
      x: round(at.x),
      y: round(at.y),
      size: round(between(rng, phone ? 22 : 16, phone ? 38 : 30)),
      color: pick(rng, GLOW_COLORS),
      dx: round(between(rng, -12, 12)),
      dy: round(between(rng, -12, 12)),
      duration,
      delay: -Math.round(rng() * duration),
      peak: round(between(rng, 0.3, 0.55) * 100) / 100,
    });
  }
  const sparkles: GlowSparkle[] = [];
  for (let i = 0; i < (phone ? SPARKLES.phone : SPARKLES.mac); i++) {
    const at = nearEdge(rng, 24);
    const duration = Math.round(between(rng, 1400, 3800));
    sparkles.push({
      x: round(Math.min(99, Math.max(1, at.x))),
      y: round(Math.min(99, Math.max(1, at.y))),
      size: round(between(rng, 2, 4)),
      color: pick(rng, SPARKLE_COLORS),
      duration,
      delay: -Math.round(rng() * duration),
    });
  }
  return { orbs, sparkles };
}
