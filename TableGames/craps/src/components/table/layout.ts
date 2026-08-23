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

export type AreaVariant = 'number' | 'band' | 'prop' | 'hard' | 'small' | 'side';

export interface FeltArea {
  /** Stable id, also used as the React key. */
  id: string;
  spec: BetSpec;
  rect: Rect;
  label: string;
  /** Second line, usually the payout. */
  sub?: string;
  variant: AreaVariant;
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
 * Sub-anchors inside a box number, arranged the way a dealer actually stacks
 * them: the don't side rides above the number, the right side below it.
 */
export function numberAnchors(n: PointNumber) {
  const c = cellFor(n);
  const cx = c.x + c.w / 2;
  return {
    glyph: { x: cx, y: c.y + 74 },
    odds: { x: cx, y: c.y + 106 },
    lay: { x: cx - 44, y: c.y + 26 },
    dontCome: { x: cx + 44, y: c.y + 26 },
    place: { x: cx - 42, y: c.y + 142 },
    come: { x: cx + 42, y: c.y + 142 },
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

/** Opening the hop panel is an action, not a wager, so it carries a flag. */
export const HOP_AREA: FeltArea = {
  id: 'hop',
  spec: { kind: 'HOP' },
  rect: { x: PROP.x + hardCellW, y: 546, w: hardCellW, h: 56, rx: 4 },
  label: 'HOP',
  sub: '15 / 30 to 1',
  variant: 'prop',
  anchor: { x: PROP.x + hardCellW * 2 - 30, y: 546 + 28 },
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
  band(
    'hard-4',
    { kind: 'HARDWAY', number: 4 },
    { x: hardRow1, y: 44, w: hardCellW, h: 96, rx: 4 },
    'HARD 4',
    '7 to 1',
    { x: hardRow1 + hardCellW / 2, y: 44 + 74 },
    'hard',
  ),
  band(
    'hard-10',
    { kind: 'HARDWAY', number: 10 },
    { x: hardRow1 + hardCellW, y: 44, w: hardCellW, h: 96, rx: 4 },
    'HARD 10',
    '7 to 1',
    { x: hardRow1 + hardCellW * 1.5, y: 44 + 74 },
    'hard',
  ),
  band(
    'hard-6',
    { kind: 'HARDWAY', number: 6 },
    { x: hardRow1, y: 144, w: hardCellW, h: 96, rx: 4 },
    'HARD 6',
    '9 to 1',
    { x: hardRow1 + hardCellW / 2, y: 144 + 74 },
    'hard',
  ),
  band(
    'hard-8',
    { kind: 'HARDWAY', number: 8 },
    { x: hardRow1 + hardCellW, y: 144, w: hardCellW, h: 96, rx: 4 },
    'HARD 8',
    '9 to 1',
    { x: hardRow1 + hardCellW * 1.5, y: 144 + 74 },
    'hard',
  ),

  /* ---- Single number props ---- */
  ...([
    ['TWO', '2', '30 to 1'],
    ['THREE', '3', '15 to 1'],
    ['YO', '11', '15 to 1'],
    ['TWELVE', '12', '30 to 1'],
  ] as const).map<FeltArea>(([prop, label, sub], i) => {
    const w = PROP.w / 4;
    return {
      id: `prop-${prop}`,
      spec: { kind: 'PROP', prop },
      rect: { x: PROP.x + i * w, y: 250, w, h: 88, rx: 4 },
      label,
      sub,
      variant: 'prop',
      anchor: { x: PROP.x + i * w + w / 2, y: 250 + 48 },
    };
  }),

  band(
    'any-seven',
    { kind: 'PROP', prop: 'ANY_7' },
    { x: PROP.x, y: 348, w: PROP.w, h: 56, rx: 4 },
    'ANY SEVEN',
    '4 to 1',
    { x: PROP.x + PROP.w - 34, y: 348 + 28 },
    'prop',
  ),
  band(
    'any-craps',
    { kind: 'PROP', prop: 'ANY_CRAPS' },
    { x: PROP.x, y: 414, w: PROP.w, h: 56, rx: 4 },
    'ANY CRAPS',
    '7 to 1',
    { x: PROP.x + PROP.w - 34, y: 414 + 28 },
    'prop',
  ),
  band(
    'c-and-e',
    { kind: 'PROP', prop: 'C_AND_E' },
    { x: PROP.x, y: 480, w: hardCellW, h: 56, rx: 4 },
    'C & E',
    '7 / 15',
    { x: PROP.x + hardCellW - 30, y: 480 + 28 },
    'prop',
  ),
  band(
    'world',
    { kind: 'PROP', prop: 'WORLD' },
    { x: PROP.x + hardCellW, y: 480, w: hardCellW, h: 56, rx: 4 },
    'WORLD',
    'push on 7',
    { x: PROP.x + hardCellW * 2 - 30, y: 480 + 28 },
    'prop',
  ),
  HOP_AREA,
  band(
    'horn',
    { kind: 'PROP', prop: 'HORN' },
    { x: PROP.x, y: 546, w: hardCellW, h: 56, rx: 4 },
    'HORN',
    '2 3 11 12',
    { x: PROP.x + hardCellW - 30, y: 546 + 28 },
    'prop',
  ),

  /* ---- Side bets ---- */
  band(
    'fire',
    { kind: 'FIRE' },
    { x: PROP.x, y: 612, w: hardCellW, h: 88, rx: 4 },
    'FIRE BET',
    '24 / 249 / 999',
    { x: PROP.x + hardCellW / 2, y: 612 + 64 },
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
      rect: { x: PROP.x + hardCellW + i * w, y: 612, w, h: 88, rx: 4 },
      label,
      sub,
      variant: 'side',
      anchor: { x: PROP.x + hardCellW + i * w + w / 2, y: 612 + 62 },
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
      return { x: PROP.x + hardCellW * 2 - 30, y: 546 + 28 };

    default:
      return AREA_BY_KEY.get(areaKey(bet))?.anchor ?? { x: VIEW.w / 2, y: VIEW.h / 2 };
  }
}

/**
 * Both seats can have money on the same spot, so each is nudged off the shared
 * anchor in its own direction. Combined with the coloured rim it stays obvious
 * whose chips are whose.
 */
export function seatOffset(seat: 'A' | 'B'): Point {
  return seat === 'A' ? { x: -7, y: -5 } : { x: 7, y: 5 };
}

/** Odds ride offset on top of the flat bet, the way a dealer stacks them. */
export function oddsAnchorFor(bet: Bet): Point {
  const base = anchorFor(bet);
  const rightSide = bet.kind === 'PASS' || bet.kind === 'COME';
  return { x: base.x + (rightSide ? 20 : -20), y: base.y - 15 };
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
    case 'HORN_HIGH_2':
    case 'HORN_HIGH_3':
    case 'HORN_HIGH_YO':
    case 'HORN_HIGH_12':
      return 'horn';
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
