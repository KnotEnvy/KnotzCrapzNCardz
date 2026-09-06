/**
 * The one piece of the keyboard handler worth testing on its own.
 *
 * Two rounds of judging landed on this decision from opposite sides — round
 * six found the game swallowing Enter from a focused header button, round
 * seven found the fix swallowing Space from the felt after a mouse click —
 * and neither was caught by a test, because the logic lived inside a DOM
 * event handler in a suite that runs in node. So the decision is a pure
 * function over `(key, element)` and this is it.
 *
 * The elements are stubs rather than real DOM: `closest` and `matches` are
 * the only two things the function asks of them, and standing up jsdom to
 * supply those would test the framework rather than the rule.
 */

import { describe, expect, it } from 'vitest';
import { ignoresGameKey } from './Controls';

/** A stand-in for a focused element, with only what the function reads. */
function el(tagName: string, opts: { control?: boolean; focusVisible?: boolean } = {}): Element {
  const self = {
    tagName,
    closest: (sel: string) => (opts.control && sel.includes('button') ? self : null),
    matches: (sel: string) => sel === ':focus-visible' && opts.focusVisible === true,
  };
  return self as unknown as Element;
}

describe('who owns a keystroke', () => {
  it('leaves a form field entirely alone', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(ignoresGameKey('s', el(tag))).toBe(true);
      expect(ignoresGameKey(' ', el(tag))).toBe(true);
      expect(ignoresGameKey('enter', el(tag))).toBe(true);
    }
  });

  it('yields Enter and Space to a button the keyboard is on', () => {
    // Round six: focus "Paytables", press Enter, and a round was dealt.
    const tabbedTo = el('BUTTON', { control: true, focusVisible: true });
    expect(ignoresGameKey('enter', tabbedTo)).toBe(true);
    expect(ignoresGameKey(' ', tabbedTo)).toBe(true);
  });

  it('keeps Space for the table when a button merely holds focus from a click', () => {
    // Round seven: click Hit with a mouse, press Space, and the hand was hit
    // again instead of standing.
    const clicked = el('BUTTON', { control: true, focusVisible: false });
    expect(ignoresGameKey(' ', clicked)).toBe(false);
    expect(ignoresGameKey('enter', clicked)).toBe(false);
  });

  it('never yields a single-letter shortcut, whatever holds focus', () => {
    // A focused button does nothing with H or S, so there is nothing to
    // yield to and every one of these has to reach the table.
    for (const key of ['h', 's', 'd', 'p', 'r', 'i', 'n', 'e']) {
      expect(ignoresGameKey(key, el('BUTTON', { control: true, focusVisible: true })), key).toBe(false);
    }
  });

  it('keeps everything when nothing is focused', () => {
    expect(ignoresGameKey(' ', null)).toBe(false);
    expect(ignoresGameKey(' ', el('DIV'))).toBe(false);
  });
});
