# Measuring the mix

`src/lib/audio.ts` carries a table of levels in its header. This is how that
table is produced, and it should be re-run rather than reasoned about whenever a
cue's level changes.

## Why in a browser

The obvious approach is a Node shim implementing the handful of Web Audio nodes
the module uses. The problem is that a shim measures the shim: get the biquad's
gain at resonance or the exponential ramp's shape slightly wrong and every
number moves together, plausibly, in a way nothing catches. Chromium's
`OfflineAudioContext` is the same engine that will play the sounds to a player,
renders far faster than real time, and costs nothing to use.

## Running it

1. `npm run dev`, open the game.
2. The module publishes itself as `window.__dsAudio` in development only --
   see the bottom of `audio.ts`. It exposes `playSound`, `startMusic`,
   `stopMusic`, `stopLoop`, the two enable switches, and `reset`.
3. Paste the harness below into the console.
4. `await sweep(CUES, 5)`.

`reset` is `__resetAudioForMeasurement`, and it exists only for this: the module
holds one AudioContext for the life of the page, and each cue needs its own
offline context to be rendered into.

```js
const SR = 44100;

function stats(buf) {
  const n = buf.length, ch = buf.numberOfChannels;
  const chans = []; for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
  let peak = 0; const sq = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < ch; c++) { const v = chans[c][i]; const a = Math.abs(v); if (a > peak) peak = a; s += v * v; }
    sq[i + 1] = sq[i] + s / ch;
  }
  const w = Math.min(n, Math.round(0.3 * buf.sampleRate));
  let best = 0;
  for (let i = 0; i + w <= n; i += 64) { const m = (sq[i + w] - sq[i]) / w; if (m > best) best = m; }
  const db = (x) => (x <= 1e-9 ? -99 : 20 * Math.log10(x));
  return { peak: +peak.toFixed(3), loud: +db(Math.sqrt(best)).toFixed(1) };
}

async function render(fire, secs = 8) {
  const A = window.__dsAudio; A.reset();
  let cap = null; const Real = window.AudioContext;
  window.AudioContext = function () {
    const oc = new OfflineAudioContext(2, Math.round(SR * secs), SR);
    oc.resume = () => Promise.resolve();   // offline contexts refuse resume()
    cap = oc; return oc;
  };
  try { fire(A); } finally { window.AudioContext = Real; }
  return cap ? stats(await cap.startRendering()) : null;
}

async function sweep(names, n = 5) {
  const out = {};
  for (const nm of names) {
    const p = [], l = [];
    for (let i = 0; i < n; i++) { const s = await render((A) => A.playSound(nm)); p.push(s.peak); l.push(s.loud); }
    p.sort((a, b) => a - b); l.sort((a, b) => a - b);
    out[nm] = { peak: p[(n / 2) | 0], loud: l[(n / 2) | 0], peakMin: p[0], peakMax: p[n - 1] };
  }
  return out;
}
```

## Three things that will bite you

**Render each cue more than once.** The noise buffer is regenerated per context,
`noiseTrim` can multiply a narrowband voice by up to 12, and white noise peaks
well above its own RMS. A single render of `dragonReel` can come back anywhere
between 0.32 and 0.79. Take the median of five and record the spread.

**Do not measure loops or beds inside a render.** `reelLoop`, `anticipation`,
`freeSpinsLoop` and the music beds are driven by `setInterval`, which keeps wall
time and knows nothing about offline-render time. Put one inside a pile-up and
the scheduler dumps an arbitrary amount of content into the render; it will
happily report the limiter's ceiling for an ordinary spin that in truth peaks at
0.358. Measure them alone, and reason about them as the roughly -30 dB floor
they are.

**Whole-render RMS is not a property of the sound.** It falls as the render gets
longer. Use the loudest 300 ms window, which is stable and is what "how loud is
it" actually means.

## The one invariant

The GRAND must be the loudest thing in the game. It is not enough to give it the
highest level: it sits flat against the soft clip at 0.893, so raising it does
nothing and the tier below it has to give way instead. Check it directly after
any change to a fanfare:

```js
const g = await render((A) => A.playSound('jackpotGrand'));
const l = await render((A) => A.playSound('winLegendary'));
g.loud > l.loud;   // must be true
```
