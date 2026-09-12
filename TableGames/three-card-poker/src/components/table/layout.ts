/**
 * The table's geometry, and nothing else.
 *
 * Every number that decides where something sits on the felt lives here, so the
 * print (`Felt`), the furniture (`Bed`), the effects (`Fx`) and the React layout
 * (`Surface`) are all reading one description of the table rather than four
 * that have to agree. That split is the one craps settled on, and the reason is
 * the same: a flash that lights a spot has to land exactly on the spot that was
 * printed, and the only way to guarantee that is for neither of them to know
 * the coordinate.
 *
 * Units are felt units — an arbitrary space scaled to the container once, by
 * `Surface`. Nothing downstream measures a pixel.
 */

/* ------------------------------------------------------------------ *
 * Spots
 * ------------------------------------------------------------------ */

/** The four printed spots at a seat. PLAY is where a decision puts its chips. */
export type SpotName = 'SIX_CARD' | 'PAIR_PLUS' | 'ANTE' | 'PLAY';

export const SPOT_NAMES: readonly SpotName[] = ['SIX_CARD', 'PAIR_PLUS', 'ANTE', 'PLAY'];

/**
 * The shape each spot is printed as.
 *
 * Not decoration: a player learns "circle, diamond, box" long before they learn
 * which word is printed in which, so anything that lights a spot up has to
 * light up *that shape* or it reads as a rectangle appearing over the table.
 */
export type SpotShape = 'circle' | 'diamond' | 'box';

export const SPOT_SHAPE: Record<SpotName, SpotShape> = {
  SIX_CARD: 'circle',
  PAIR_PLUS: 'circle',
  ANTE: 'diamond',
  PLAY: 'box',
};

type LineText = 'QUALIFIER' | 'PLAY_EQUALS_ANTE' | 'NO_QUALIFIER';

export interface PrintedLine {
  text: LineText;
  /** Radius and half-angle of the arc, about the centre far below the table. */
  radius: number;
  spread: number;
  size: number;
  tone: 'gold' | 'muted';
}

export const LINE_TEXT: Record<LineText, string> = {
  QUALIFIER: 'DEALER PLAYS WITH QUEEN HIGH OR BETTER',
  PLAY_EQUALS_ANTE: 'PLAY MUST EQUAL ANTE',
  NO_QUALIFIER: 'NO QUALIFIER: ANTE PAYS 1 TO 1 · PLAY PUSHES',
};

/* ------------------------------------------------------------------ *
 * The table
 * ------------------------------------------------------------------ */

/**
 * The felt comes in two geometries, for the same reason the blackjack felt
 * does: a phone in landscape has about 290 pixels of height for the table, and
 * scaling a deep layout to fit leaves most of the width empty. The shallow
 * table puts each seat's spots in a row instead of a column, drops the printed
 * paytables and two of the three lines, and gives the depth back to the cards.
 *
 * Both are described by the same fields, so nothing downstream branches on
 * which is in use.
 */
export interface FeltGeometry {
  w: number;
  h: number;
  /**
   * How much room the furniture gets *outside* the cloth.
   *
   * The playing surface keeps the coordinate space it always had — the seats,
   * the arcs and the paytables are all still positioned in `0 … w` by `0 … h` —
   * and the rail is drawn in a margin around it. Doing it the other way, by
   * insetting the cloth, would have meant re-tuning every coordinate on the
   * table to buy the wood its width, and the outside seats' Play boxes had
   * about five units of room to give.
   */
  rail: number;
  /** The elliptical bulge the players sit around. */
  arcTop: number;
  arcRx: number;
  arcRy: number;
  /** Centre of the concentric printed arcs, well below the table. */
  arcCy: number;
  lines: readonly PrintedLine[];
  /** The dealer's hand: its top edge, and how wide a card is drawn. */
  dealerY: number;
  dealerCard: number;
  /** The dealer's chip tray — where a losing bet is raked to. */
  bank: { x: number; y: number };
  /** Where the paytables are printed, or null where there is no room for them. */
  paytables: { left: { x: number; y: number }; right: { x: number; y: number }; width: number; row: number } | null;
  /** The shuffling machine: its centre, and how large it is drawn. */
  machine: { x: number; y: number; scale: number };
  /** Each seat's anchor, which every offset below is measured from. */
  seats: ReadonlyArray<{ x: number; y: number }>;
  /** Where each spot's centre sits relative to its seat's anchor. */
  spots: Record<SpotName, { dx: number; dy: number }>;
  /** The size of a spot, in felt units. */
  spotSize: number;
  /** Where a winning bet is paid to, relative to the seat's anchor. */
  payTo: { dx: number; dy: number };
  /** A seat's cards: how wide each is drawn, and where the hand's bottom edge sits. */
  seatCard: number;
  handBottom: number;
  /** The seat's name and bankroll, or null where the header has to carry them. */
  namePlate: { dx: number; dy: number } | null;
  chip: number;
  /**
   * Which side of each spot its settlement figures appear on.
   *
   * Not above, which is where the blackjack felt puts them: here the spots are
   * stacked, so a figure rising off the Ante lands on the Pair Plus spot and
   * one rising off Pair Plus lands on the hand's label. The first draft did
   * exactly that and a winning round was unreadable.
   */
  floats: Record<SpotName, 'left' | 'right' | 'below'>;
}

/**
 * The full table.
 *
 * The vertical budget, dealer outward: the dealer's cards end at about 110 and
 * their label at 135; the three printed lines have apexes at 210, 238 and 264;
 * the centre seat's cards begin at 279 and the outside seats' at 243, which is
 * why the arcs' spreads are chosen to end before x ≈ 280 — each line's *text*
 * has to stay clear of the outside seats' cards, not just its arc.
 */
export const FULL: FeltGeometry = {
  w: 1000,
  h: 560,
  rail: 26,
  arcTop: 300,
  arcRx: 500,
  arcRy: 250,
  arcCy: 820,
  lines: [
    /*
     * 24 degrees, not 21. Measured in the browser, the qualifier line renders
     * 451 units wide and a 21-degree arc at this radius is 447 — so the felt
     * was losing a sliver of the D and the R at either end, which reads as a
     * rendering fault rather than as a design. 24 degrees gives 511 units of
     * path, and its ends still stop short of the outside seats' cards.
     */
    { text: 'QUALIFIER', radius: 610, spread: 24, size: 21, tone: 'gold' },
    { text: 'PLAY_EQUALS_ANTE', radius: 582, spread: 12, size: 12, tone: 'muted' },
    { text: 'NO_QUALIFIER', radius: 556, spread: 23, size: 11, tone: 'muted' },
  ],
  dealerY: 22,
  dealerCard: 60,
  bank: { x: 500, y: 158 },
  // The right-hand block ends at 850, clear of the shuffler's left edge at 893.
  // It started at 690, and the machine sat on top of every pay in its column.
  paytables: { left: { x: 44, y: 42 }, right: { x: 650, y: 42 }, width: 200, row: 14 },
  // Low enough that the machine's lid sits on the cloth and not on the rail.
  machine: { x: 928, y: 100, scale: 1 },
  seats: [
    { x: 190, y: 404 },
    { x: 500, y: 440 },
    { x: 810, y: 404 },
  ],
  spots: {
    SIX_CARD: { dx: -58, dy: -52 },
    PAIR_PLUS: { dx: 0, dy: -52 },
    ANTE: { dx: 0, dy: 0 },
    PLAY: { dx: 0, dy: 52 },
  },
  spotSize: 46,
  // The name plate, which is also where the bankroll is printed: a payoff that
  // lands anywhere else is money going somewhere the player cannot see.
  payTo: { dx: -52, dy: 34 },
  seatCard: 56,
  handBottom: -80,
  namePlate: { dx: -34, dy: 30 },
  chip: 26,
  // The 6 Card Bonus sits left of Pair Plus, so its figure goes on its own far side.
  floats: { SIX_CARD: 'left', PAIR_PLUS: 'right', ANTE: 'right', PLAY: 'right' },
};

/**
 * The shallow table. One printed line, no paytables, and every seat's spots
 * in a row under its cards. The outside seats are pulled in, because the
 * shallow arc closes on the rail much faster.
 */
export const COMPACT: FeltGeometry = {
  w: 1000,
  h: 400,
  rail: 16,
  arcTop: 205,
  arcRx: 500,
  arcRy: 185,
  arcCy: 640,
  /*
   * Smaller and wider than it looks like it should be. Text on a `textPath`
   * is clipped where the path runs out, and at 18px over a 20-degree spread
   * this line lost its last four letters — the felt read "DEALER PLAYS WITH
   * QUEEN HIGH OR BETTE". The arc is 500 x 2 x 23 degrees = 401 units and the
   * line needs about 334 at this size.
   */
  lines: [{ text: 'QUALIFIER', radius: 500, spread: 23, size: 16, tone: 'gold' }],
  dealerY: 12,
  dealerCard: 48,
  bank: { x: 500, y: 104 },
  paytables: null,
  machine: { x: 930, y: 60, scale: 0.72 },
  seats: [
    { x: 205, y: 262 },
    { x: 500, y: 278 },
    { x: 795, y: 262 },
  ],
  spots: {
    SIX_CARD: { dx: -69, dy: 0 },
    PAIR_PLUS: { dx: -23, dy: 0 },
    ANTE: { dx: 23, dy: 0 },
    PLAY: { dx: 69, dy: 0 },
  },
  spotSize: 40,
  // No name plate on the shallow table, so a payoff goes the way it would at a
  // real table with no rack drawn: down, off the edge, to the player.
  payTo: { dx: 0, dy: 72 },
  seatCard: 44,
  handBottom: -30,
  namePlate: null,
  chip: 22,
  // A row has neighbours on both sides and the cards above, so under it is the only room.
  floats: { SIX_CARD: 'below', PAIR_PLUS: 'below', ANTE: 'below', PLAY: 'below' },
};

/**
 * Which geometry a container of this shape wants: below about 0.44 of height
 * per unit of width, the full table would be scaled down by its depth and
 * leave the width empty.
 */
export function geometryFor(width: number, height: number): FeltGeometry {
  if (width <= 0 || height <= 0) return FULL;
  return height / width < 0.44 ? COMPACT : FULL;
}

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

/**
 * The table's outline, optionally grown outward by `grow` units.
 *
 * One function rather than three hand-written paths, because the wood, the
 * padded bumper and the cloth are the same shape at three sizes and the whole
 * point of the rail is that its width is even all the way round. The ellipse
 * keeps its centre and grows its radii, which is what keeps the straight sides
 * meeting the curve tangentially at exactly `arcTop`.
 */
export function tableShape(g: FeltGeometry, grow = 0): string {
  const x0 = -grow;
  const x1 = g.w + grow;
  const y0 = -grow;
  const rx = g.arcRx + grow;
  const ry = g.arcRy + grow;
  return `M ${x0} ${y0} H ${x1} V ${g.arcTop} A ${rx} ${ry} 0 0 1 ${x0} ${g.arcTop} Z`;
}

/** The path for a printed line, as a radius and half-angle about `arcCy`. */
export function lineArc(g: FeltGeometry, radius: number, spreadDeg: number): string {
  const rad = (spreadDeg * Math.PI) / 180;
  const dx = radius * Math.sin(rad);
  const dy = radius * Math.cos(rad);
  const y = (g.arcCy - dy).toFixed(1);
  return `M ${(g.w / 2 - dx).toFixed(1)} ${y} A ${radius} ${radius} 0 0 1 ${(g.w / 2 + dx).toFixed(1)} ${y}`;
}

export function spotCentre(g: FeltGeometry, seatIndex: number, spot: SpotName): { x: number; y: number } {
  const anchor = g.seats[seatIndex];
  const offset = g.spots[spot];
  return { x: anchor.x + offset.dx, y: anchor.y + offset.dy };
}

/** How large a spot is printed. The 6 Card Bonus is the small one. */
export function spotRadius(g: FeltGeometry, spot: SpotName): number {
  return spot === 'SIX_CARD' ? g.spotSize * 0.36 : g.spotSize / 2;
}

/** Where a seat's winnings are paid to. */
export function payPoint(g: FeltGeometry, seatIndex: number): { x: number; y: number } {
  const anchor = g.seats[seatIndex];
  return { x: anchor.x + g.payTo.dx, y: anchor.y + g.payTo.dy };
}
