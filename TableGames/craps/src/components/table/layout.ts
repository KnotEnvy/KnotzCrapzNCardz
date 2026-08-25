/**
 * Geometry for the felt.
 *
 * One source of truth for where every betting area sits, what it is called, and
 * where a chip lands when you bet it. The renderer draws from this list and the
 * hit testing reads the same rectangles, so a betting area can never drift away
 * from the thing you click.
 *
 * All coordinates are in the SVG viewBox below. Because chips are drawn inside
 * the same SVG, everything scales together and stays aligned at any size.
 */

import type { BetSpec } from '@/lib/engine/table';
import type { Bet, BetLocation, PointNumber, PropKind } from '@/lib/engine/types';

export const VIEW = { w: 1600, h: 760 } as const;

/** The player layout occupies the left; the proposition box sits on the right. */
const LEFT = { x: 44, w: 1106 } as const;
const PROP = { x: 1172, w: 384 } as const;

/**
 * The row grid. The numbers row starts low enough to leave a strip of bare felt
 * above it for the puck to ride on, the way it does on a real table.
 */
export const ROWS = {
  numbers: { y: 64, h: 168 },
  come: { y: 240, h: 100 },
  field: { y: 348, h: 104 },
  bottom: { y: 462, h: 96 },
  pass: { y: 566, h: 122 },
} as const;

/**
 * The dealer's proposition box: the whole right-hand column.
 *
 * Exported as one rectangle so the felt can print it as a box rather than
 * implying it with a divider line. On a real layout this area is the stickman's
 * and is visibly set apart from the players' side; running the two together on
 * one flat green is the main thing that makes a drawn table read as a diagram.
 */
export const PROP_BOX = { x: 1160, y: 34, w: 408, h: 676, rx: 12 } as const;

export const BOX_NUMBERS: PointNumber[] = [4, 5, 6, 8, 9, 10];

const DC_WIDTH = 156;
const CELL_W = (LEFT.w - DC_WIDTH) / BOX_NUMBERS.length; // 158.33

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  rx?: number;
}

export interface Point {
  x: number;
  y: number;
}

export type AreaVariant = 'number' | 'band' | 'prop' | 'hard' | 'small' | 'side' | 'hornhigh';

export interface FeltArea {
  /** Stable id, also used as the React key. */
  id: string;
  spec: BetSpec;
  rect: Rect;
  label: string;
  /** Second line, usually the payout. */
  sub?: string;
  variant: AreaVariant;
  /**
   * What a dealer would call this bet out loud.
   *
   * Separate from `label` because `label` is the glyph printed on the felt, and
   * on the props that glyph is just a number: the horn high two and the two
   * itself both print "2". The tooltip and the screen reader need the name, not
   * the print.
   */
  callName?: string;
  /** Where a chip stack for this area comes to rest. */
  anchor: Point;
  /** Clicking opens a panel instead of placing a wager. */
  action?: 'OPEN_HOP';
}

/* ------------------------------------------------------------------ *
 * Box numbers
 * ------------------------------------------------------------------ */

export function cellFor(n: PointNumber): Rect {
  const i = BOX_NUMBERS.indexOf(n);
  return {
    x: LEFT.x + DC_WIDTH + i * CELL_W,
    y: ROWS.numbers.y,
    w: CELL_W,
    h: ROWS.numbers.h,
  };
}

/**
 * The three printed bands inside a box number.
 *
 * A real layout stacks the number's business vertically: laid and don't-come
 * money rides above the number, the number itself carries the payout, and the
 * right side sits below it. Naming those bands rather than leaving one
 * undivided cell is what lets each one be labelled and clicked for the bet it
 * actually holds, instead of the player having to arm a mode first.
 */
export const CELL_BANDS = { lay: 48, mid: 72, place: 48 } as const;

export function numberZones(n: PointNumber): { lay: Rect; mid: Rect; place: Rect } {
  const c = cellFor(n);
  const pad = 3;
  const w = c.w - pad * 2;
  return {
    lay: { x: c.x + pad, y: c.y + pad, w, h: CELL_BANDS.lay - pad },
    mid: { x: c.x + pad, y: c.y + CELL_BANDS.lay, w, h: CELL_BANDS.mid },
    place: { x: c.x + pad, y: c.y + CELL_BANDS.lay + CELL_BANDS.mid, w, h: CELL_BANDS.place - pad },
  };
}

/**
 * Sub-anchors inside a box number, arranged the way a dealer actually stacks
 * them: the don't side rides above the number, the right side below it. Each
 * one sits in the middle of the band that band's label names.
 */
export function numberAnchors(n: PointNumber) {
  const c = cellFor(n);
  const cx = c.x + c.w / 2;
  return {
    glyph: { x: cx, y: c.y + 76 },
    odds: { x: cx, y: c.y + 104 },
    /*
     * Chip anchors sit a little inside the band's half-width, because each one
     * is then pushed further out again by the seat offset. Base ±34 plus a
     * seat spread of ±15 puts the widest stack at ±69 in a cell of half-width
     * 79 — four stacks across a box number, all inside the printed line.
     */
    lay: { x: cx - 34, y: c.y + 26 },
    dontCome: { x: cx + 34, y: c.y + 26 },
    place: { x: cx - 34, y: c.y + 142 },
    come: { x: cx + 34, y: c.y + 142 },
    /*
     * Where each band's printed caption sits.
     *
     * Pushed hard into the band's outer edge so a resting stack clears it.
     * Chips covering the print is authentic, but a caption half-hidden behind
     * one reads as a layout bug rather than as a table in use, and these
     * captions only earn their place by being legible on an empty box.
     */
    layLabel: { x: c.x + 9, y: c.y + 9 },
    dcLabel: { x: c.x + c.w - 11, y: c.y + 9 },
    placeLabel: { x: c.x + 9, y: c.y + c.h - 8 },
    comeLabel: { x: c.x + c.w - 11, y: c.y + c.h - 8 },
    buyLabel: { x: c.x + 12, y: c.y + 104 },
  };
}

/**
 * The puck sits inside the box it marks, tucked into the upper-left corner so
 * it never covers the number. There is no room above the top row for it to ride
 * outside the layout the way it does on a real table.
 */
export function puckAnchor(n: PointNumber | null): Point {
  // The puck rides on the bare felt above the row: off, it waits over the
  // don't-come box; on, it sits over the number it marks.
  const y = ROWS.numbers.y - 28;
  if (n === null) return { x: LEFT.x + DC_WIDTH / 2, y };
  const c = cellFor(n);
  return { x: c.x + c.w / 2, y };
}

/* ------------------------------------------------------------------ *
 * The full area list
 * ------------------------------------------------------------------ */

function band(
  id: string,
  spec: BetSpec,
  rect: Rect,
  label: string,
  sub: string | undefined,
  anchor: Point,
  variant: AreaVariant = 'band',
): FeltArea {
  return { id, spec, rect, label, sub, anchor, variant };
}

const hardRow1 = PROP.x;
const hardCellW = PROP.w / 2;

/**
 * The proposition column's row grid.
 *
 * Written out rather than scattered through the area list because the column
 * is packed to the millimetre: every row's y is the previous row's y plus its
 * height plus a gutter, and a hand-tuned constant in the middle of that chain
 * is how a felt ends up with two cells overlapping and nothing to catch it.
 */
const PROP_ROWS = {
  hardTop: 48,
  hardBottom: 132,
  hardH: 80,
  singles: 222,
  singlesH: 80,
  hornHigh: 312,
  hornHighH: 52,
  anySeven: 374,
  anyCraps: 436,
  pairRow: 498,
  hornHop: 560,
  bandH: 52,
  side: 622,
  sideH: 76,
} as const;

/** Opening the hop panel is an action, not a wager, so it carries a flag. */
export const HOP_AREA: FeltArea = {
  id: 'hop',
  spec: { kind: 'HOP' },
  rect: { x: PROP.x + hardCellW, y: PROP_ROWS.hornHop, w: hardCellW, h: PROP_ROWS.bandH, rx: 4 },
  label: 'HOP',
  sub: '15 / 30 to 1',
  variant: 'prop',
  anchor: { x: PROP.x + hardCellW * 2 - 30, y: PROP_ROWS.hornHop + 26 },
  action: 'OPEN_HOP',
};

export const AREAS: FeltArea[] = [
  /* ---- Box numbers: one clickable cell each ---- */
  ...BOX_NUMBERS.map<FeltArea>((n) => {
    const rect = cellFor(n);
    return {
      id: `num-${n}`,
      spec: { kind: 'PLACE', number: n },
      rect,
      label: n === 6 ? 'SIX' : n === 9 ? 'NINE' : String(n),
      sub: undefined,
      variant: 'number',
      anchor: numberAnchors(n).place,
    };
  }),

  /* ---- Don't come ---- */
  band(
    'dont-come',
    { kind: 'DONT_COME' },
    { x: LEFT.x, y: ROWS.numbers.y, w: DC_WIDTH, h: ROWS.numbers.h },
    "DON'T COME",
    'BAR 12',
    { x: LEFT.x + DC_WIDTH / 2, y: ROWS.numbers.y + 124 },
  ),

  /* ---- Come ---- */
  band(
    'come',
    { kind: 'COME' },
    { x: LEFT.x, y: ROWS.come.y, w: LEFT.w, h: ROWS.come.h, rx: 6 },
    'COME',
    undefined,
    { x: LEFT.x + LEFT.w / 2, y: ROWS.come.y + ROWS.come.h / 2 + 26 },
  ),

  /* ---- Field ---- */
  band(
    'field',
    { kind: 'FIELD' },
    { x: LEFT.x, y: ROWS.field.y, w: LEFT.w, h: ROWS.field.h, rx: 6 },
    'FIELD',
    undefined, // FieldArt prints the numbers; a sub-label here would collide
    { x: LEFT.x + 62, y: ROWS.field.y + ROWS.field.h / 2 },
  ),

  /* ---- Big 6 and Big 8 ---- */
  band(
    'big-6',
    { kind: 'BIG', number: 6 },
    { x: LEFT.x, y: ROWS.bottom.y, w: 100, h: ROWS.bottom.h, rx: 6 },
    'BIG 6',
    '1:1',
    { x: LEFT.x + 50, y: ROWS.bottom.y + ROWS.bottom.h - 24 },
    'small',
  ),
  band(
    'big-8',
    { kind: 'BIG', number: 8 },
    { x: LEFT.x + 106, y: ROWS.bottom.y, w: 100, h: ROWS.bottom.h, rx: 6 },
    'BIG 8',
    '1:1',
    { x: LEFT.x + 156, y: ROWS.bottom.y + ROWS.bottom.h - 24 },
    'small',
  ),

  /* ---- Don't pass ---- */
  band(
    'dont-pass',
    { kind: 'DONT_PASS' },
    { x: LEFT.x + 216, y: ROWS.bottom.y, w: LEFT.w - 216, h: ROWS.bottom.h, rx: 6 },
    "DON'T PASS BAR",
    undefined, // DontPassArt draws the barred twelve
    { x: LEFT.x + 216 + (LEFT.w - 216) / 2, y: ROWS.bottom.y + ROWS.bottom.h - 26 },
  ),

  /* ---- Pass line ---- */
  band(
    'pass',
    { kind: 'PASS' },
    { x: LEFT.x, y: ROWS.pass.y, w: LEFT.w, h: ROWS.pass.h, rx: 10 },
    'PASS LINE',
    undefined,
    { x: LEFT.x + LEFT.w / 2, y: ROWS.pass.y + ROWS.pass.h - 34 },
  ),

  /* ---- Hardways ---- */
  ...([
    [4, '7 to 1', PROP_ROWS.hardTop, 0],
    [10, '7 to 1', PROP_ROWS.hardTop, 1],
    [6, '9 to 1', PROP_ROWS.hardBottom, 0],
    [8, '9 to 1', PROP_ROWS.hardBottom, 1],
  ] as const).map<FeltArea>(([n, sub, y, col]) =>
    band(
      `hard-${n}`,
      { kind: 'HARDWAY', number: n },
      { x: hardRow1 + col * hardCellW, y, w: hardCellW, h: PROP_ROWS.hardH, rx: 4 },
      `HARD ${n}`,
      sub,
      { x: hardRow1 + col * hardCellW + hardCellW / 2, y: y + 62 },
      'hard',
    ),
  ),

  /* ---- Single number props ---- */
  ...([
    ['TWO', '2', '30 to 1', 'the two, aces'],
    ['THREE', '3', '15 to 1', 'the three'],
    ['YO', '11', '15 to 1', 'the yo, eleven'],
    ['TWELVE', '12', '30 to 1', 'the twelve, boxcars'],
  ] as const).map<FeltArea>(([prop, label, sub, callName], i) => {
    const w = PROP.w / 4;
    return {
      id: `prop-${prop}`,
      spec: { kind: 'PROP', prop },
      rect: { x: PROP.x + i * w, y: PROP_ROWS.singles, w, h: PROP_ROWS.singlesH, rx: 4 },
      label,
      sub,
      callName,
      variant: 'prop',
      anchor: { x: PROP.x + i * w + w / 2, y: PROP_ROWS.singles + 46 },
    };
  }),

  /* ---- Horn highs ----
     Four of the most-called bets at a live table, and until now they were
     reachable only from inside the hop dialog. A real layout prints them. */
  ...([
    ['HORN_HIGH_2', '2'],
    ['HORN_HIGH_3', '3'],
    ['HORN_HIGH_YO', '11'],
    ['HORN_HIGH_12', '12'],
  ] as const).map<FeltArea>(([prop, label], i) => {
    const w = PROP.w / 4;
    return {
      id: `prop-${prop}`,
      spec: { kind: 'PROP', prop },
      rect: { x: PROP.x + i * w, y: PROP_ROWS.hornHigh, w, h: PROP_ROWS.hornHighH, rx: 4 },
      label,
      sub: 'horn high',
      callName: `horn high ${label}`,
      variant: 'hornhigh',
      anchor: { x: PROP.x + i * w + w / 2, y: PROP_ROWS.hornHigh + 30 },
    };
  }),

  band(
    'any-seven',
    { kind: 'PROP', prop: 'ANY_7' },
    { x: PROP.x, y: PROP_ROWS.anySeven, w: PROP.w, h: PROP_ROWS.bandH, rx: 4 },
    'ANY SEVEN',
    '4 to 1',
    { x: PROP.x + PROP.w - 34, y: PROP_ROWS.anySeven + 26 },
    'prop',
  ),
  band(
    'any-craps',
    { kind: 'PROP', prop: 'ANY_CRAPS' },
    { x: PROP.x, y: PROP_ROWS.anyCraps, w: PROP.w, h: PROP_ROWS.bandH, rx: 4 },
    'ANY CRAPS',
    '7 to 1',
    { x: PROP.x + PROP.w - 34, y: PROP_ROWS.anyCraps + 26 },
    'prop',
  ),
  band(
    'c-and-e',
    { kind: 'PROP', prop: 'C_AND_E' },
    { x: PROP.x, y: PROP_ROWS.pairRow, w: hardCellW, h: PROP_ROWS.bandH, rx: 4 },
    'C & E',
    '7 / 15',
    { x: PROP.x + hardCellW - 30, y: PROP_ROWS.pairRow + 26 },
    'prop',
  ),
  band(
    'world',
    { kind: 'PROP', prop: 'WORLD' },
    { x: PROP.x + hardCellW, y: PROP_ROWS.pairRow, w: hardCellW, h: PROP_ROWS.bandH, rx: 4 },
    'WORLD',
    'push on 7',
    { x: PROP.x + hardCellW * 2 - 30, y: PROP_ROWS.pairRow + 26 },
    'prop',
  ),
  HOP_AREA,
  band(
    'horn',
    { kind: 'PROP', prop: 'HORN' },
    { x: PROP.x, y: PROP_ROWS.hornHop, w: hardCellW, h: PROP_ROWS.bandH, rx: 4 },
    'HORN',
    '2 3 11 12',
    { x: PROP.x + hardCellW - 30, y: PROP_ROWS.hornHop + 26 },
    'prop',
  ),

  /* ---- Side bets ---- */
  band(
    'fire',
    { kind: 'FIRE' },
    { x: PROP.x, y: PROP_ROWS.side, w: hardCellW, h: PROP_ROWS.sideH, rx: 4 },
    'FIRE BET',
    '24 / 249 / 999',
    { x: PROP.x + hardCellW / 2, y: PROP_ROWS.side + 54 },
    'side',
  ),
  ...([
    ['SMALL', 'SMALL', '30:1'],
    ['TALL', 'TALL', '30:1'],
    ['ALL', 'ALL', '150:1'],
  ] as const).map<FeltArea>(([ats, label, sub], i) => {
    const w = hardCellW / 3;
    return {
      id: `ats-${ats}`,
      spec: { kind: 'ATS', ats },
      rect: { x: PROP.x + hardCellW + i * w, y: PROP_ROWS.side, w, h: PROP_ROWS.sideH, rx: 4 },
      label,
      sub,
      variant: 'side',
      anchor: { x: PROP.x + hardCellW + i * w + w / 2, y: PROP_ROWS.side + 52 },
    };
  }),
];

/* ------------------------------------------------------------------ *
 * Where a placed bet's chips are drawn
 * ------------------------------------------------------------------ */

const AREA_BY_KEY = new Map<string, FeltArea>();
for (const area of AREAS) {
  AREA_BY_KEY.set(areaKey(area.spec), area);
}

function areaKey(spec: BetSpec): string {
  return [spec.kind, spec.number ?? '', spec.prop ?? '', spec.ats ?? ''].join('|');
}

/**
 * Resting place for a bet's chip stack. Bets that travel (come, don't come, the
 * line once a point is on) follow their number around the layout, exactly as
 * the dealer would move them.
 */
export function anchorFor(bet: BetLocation): Point {
  switch (bet.kind) {
    case 'PASS':
      if (bet.number === undefined) return AREA_BY_KEY.get('PASS|||')!.anchor;
      return { x: cellFor(bet.number as PointNumber).x + 22, y: ROWS.pass.y + 40 };

    case 'DONT_PASS':
      if (bet.number === undefined) return AREA_BY_KEY.get('DONT_PASS|||')!.anchor;
      return { x: cellFor(bet.number as PointNumber).x + 22, y: ROWS.bottom.y + 28 };

    case 'COME':
      if (bet.number === undefined) return AREA_BY_KEY.get('COME|||')!.anchor;
      return numberAnchors(bet.number as PointNumber).come;

    case 'DONT_COME':
      if (bet.number === undefined) return AREA_BY_KEY.get('DONT_COME|||')!.anchor;
      return numberAnchors(bet.number as PointNumber).dontCome;

    case 'PLACE':
    case 'BUY':
      return numberAnchors(bet.number as PointNumber).place;

    case 'LAY':
      return numberAnchors(bet.number as PointNumber).lay;

    case 'HOP':
      return HOP_AREA.anchor;

    default:
      return AREA_BY_KEY.get(areaKey(bet))?.anchor ?? { x: VIEW.w / 2, y: VIEW.h / 2 };
  }
}

/**
 * How far each seat's money sits from the shared anchor for a spot.
 *
 * Tuned against the chip radius the felt actually draws (20), so two seats on
 * the same spot come out just touching rather than a quarter overlapped. On the
 * narrowest cells — Small / Tall / All at 64 wide — a pair does overhang the
 * printed line slightly, which is what happens on a real layout too.
 */
const SEAT_SPREAD = 19;

/**
 * Both seats can have money on the same spot, so each is pushed off the shared
 * anchor in its own direction: the first seat's money to the left, the second
 * seat's to the right.
 *
 * Purely horizontal, which matters. The old diagonal nudge read as one stack
 * sitting on another, so telling the two apart came down to squinting at the
 * rim colour. Left and right is a distinction you can make at a glance and
 * without knowing the colour code, and it matches how the two seats are laid
 * out everywhere else in the app.
 */
export function seatOffset(seat: 'A' | 'B'): Point {
  return seat === 'A' ? { x: -SEAT_SPREAD, y: 0 } : { x: SEAT_SPREAD, y: 0 };
}

/** Odds ride offset on top of the flat bet, the way a dealer stacks them. */
export function oddsAnchorFor(bet: Bet): Point {
  const base = anchorFor(bet);
  const rightSide = bet.kind === 'PASS' || bet.kind === 'COME';
  return { x: base.x + (rightSide ? 23 : -23), y: base.y - 17 };
}

/* ------------------------------------------------------------------ *
 * Which printed rectangle a settled bet belongs to
 *
 * `anchorFor` answers "where do the chips sit". This answers "which box do I
 * light up", which is a different question for every bet that travels: a come
 * bet that has moved to the eight wins on the eight's box, not in the come
 * band it started in.
 * ------------------------------------------------------------------ */

const AREA_BY_ID = new Map<string, FeltArea>();
for (const area of AREAS) {
  AREA_BY_ID.set(area.id, area);
}

function rectById(id: string): Rect | null {
  return AREA_BY_ID.get(id)?.rect ?? null;
}

/** Every proposition maps onto a printed box; the horn highs share the horn. */
function propRectId(prop: PropKind | undefined): string | null {
  switch (prop) {
    case 'ANY_7':
      return 'any-seven';
    case 'ANY_CRAPS':
      return 'any-craps';
    case 'C_AND_E':
      return 'c-and-e';
    case 'WORLD':
      return 'world';
    case 'TWO':
    case 'THREE':
    case 'YO':
    case 'TWELVE':
      return `prop-${prop}`;
    case 'HORN':
      return 'horn';
    case 'HORN_HIGH_2':
    case 'HORN_HIGH_3':
    case 'HORN_HIGH_YO':
    case 'HORN_HIGH_12':
      return `prop-${prop}`;
    default:
      return null;
  }
}

/**
 * The felt rectangle to highlight when a bet at this location resolves.
 * Null for anything with nowhere sensible to point at, which the caller skips.
 */
export function rectFor(loc: BetLocation): Rect | null {
  switch (loc.kind) {
    case 'PASS':
      return rectById('pass');

    case 'DONT_PASS':
      return rectById('dont-pass');

    case 'COME':
      return loc.number === undefined ? rectById('come') : cellFor(loc.number as PointNumber);

    case 'DONT_COME':
      return loc.number === undefined
        ? rectById('dont-come')
        : cellFor(loc.number as PointNumber);

    case 'PLACE':
    case 'BUY':
    case 'LAY':
      return loc.number === undefined ? null : cellFor(loc.number as PointNumber);

    case 'BIG':
      return rectById(`big-${loc.number}`);

    case 'HARDWAY':
      return rectById(`hard-${loc.number}`);

    case 'FIELD':
      return rectById('field');

    case 'FIRE':
      return rectById('fire');

    case 'ATS':
      return rectById(`ats-${loc.ats}`);

    case 'HOP':
      return HOP_AREA.rect;

    case 'PROP': {
      const id = propRectId(loc.prop);
      return id ? rectById(id) : null;
    }

    default:
      return null;
  }
}

/* ------------------------------------------------------------------ *
 * Off-layout destinations for chips in motion
 * ------------------------------------------------------------------ */

/** Where a seat's winnings fly back to: its own stretch of the rail. */
export const RAIL: Record<'A' | 'B', Point> = {
  A: { x: LEFT.x + 240, y: VIEW.h - 18 },
  B: { x: LEFT.x + 820, y: VIEW.h - 18 },
};

/** Where losing chips get raked to: the boxman, across the table. */
export const BANK: Point = { x: LEFT.x + LEFT.w / 2, y: 12 };
