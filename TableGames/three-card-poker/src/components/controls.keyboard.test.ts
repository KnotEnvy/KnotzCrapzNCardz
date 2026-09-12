/**
 * The one piece of the keyboard handler worth testing on its own.
 *
 * Carried over from the blackjack table, where two rounds of judging landed
 * on this decision from opposite sides — the game swallowing Enter from a
 * focused header button, and then the fix swallowing Space from the felt after
 * a mouse click — and neither was caught by a test, because the logic lived
 * inside a DOM event handler in a suite that runs in node. So the decision is
 * a pure function over `(key, element)` and this is it.
 *
 * The elements are stubs rather than real DOM: `closest` and `matches` are the
 * only two things the function asks of them.
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
      expect(ignoresGameKey('p', el(tag))).toBe(true);
      expect(ignoresGameKey(' ', el(tag))).toBe(true);
      expect(ignoresGameKey('enter', el(tag))).toBe(true);
    }
  });

  it('yields Enter and Space to a button the keyboard is on', () => {
    // Tab to "Paytables", press Enter: the dialog opens, and no round is dealt.
    const tabbedTo = el('BUTTON', { control: true, focusVisible: true });
    expect(ignoresGameKey('enter', tabbedTo)).toBe(true);
    expect(ignoresGameKey(' ', tabbedTo)).toBe(true);
  });

  it('keeps Space for the table when a button merely holds focus from a click', () => {
    // Click Deal with a mouse, and Space still deals the next round.
    const clicked = el('BUTTON', { control: true, focusVisible: false });
    expect(ignoresGameKey(' ', clicked)).toBe(false);
    expect(ignoresGameKey('enter', clicked)).toBe(false);
  });

  it('never yields a single-letter shortcut, whatever holds focus', () => {
    // A focused button does nothing with P or F, so every one has to reach the table.
    for (const key of ['p', 'f', 'c', 'b', ',', '?']) {
      expect(ignoresGameKey(key, el('BUTTON', { control: true, focusVisible: true })), key).toBe(false);
    }
  });

  it('keeps everything when nothing is focused', () => {
    expect(ignoresGameKey(' ', null)).toBe(false);
    expect(ignoresGameKey(' ', el('DIV'))).toBe(false);
  });
});
