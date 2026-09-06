/**
 * Immer's configuration, in one place.
 *
 * Immer deep-freezes everything it produces, which means walking the whole
 * table — including the shoe's four hundred card objects — on every action.
 * That is a useful safety net in a codebase that might mutate state by
 * accident, and this one does not: nothing outside `table.ts` and `resolve.ts`
 * writes to a table, the shoe's array is built by the shuffle and never
 * touched again, and the tests assert the immutability that actually matters
 * (an action returns a new table and leaves the old one alone).
 *
 * Turning it off took a simulated round from 1.6ms to a fraction of that,
 * which is the difference between a measurement suite that runs in two minutes
 * and one that times out. It is set here rather than in either caller so that
 * importing one of them cannot leave the other running under different rules.
 */

import { setAutoFreeze } from 'immer';

setAutoFreeze(false);

export { produce } from 'immer';
