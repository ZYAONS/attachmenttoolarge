#!/usr/bin/env node
/* ==========================================================================
   harshness-selftest.mjs — would the harshness metric have caught the screech?

   The porch loop sounded like fingernails on a blackboard, and every number the
   suite printed said the track was fine: 92% of its energy sat below 300 Hz, the
   centroid was 169 Hz, the high band was empty. The reason is that a screech is a
   transient. Its share of the total energy is tiny and its contribution to the
   average spectrum is invisible, while the ear cannot ignore it.

   So the metric that catches it looks at the loudest 20 ms instead of the mean.
   This file proves it separates the two cases, using signals built to order:

     clean   a decaying tone with a little noise - what a plucked string is
     broken  a noise burst fed back on itself through a 128-sample delay at 0.965
             gain, which is exactly what a clamped delay line does

   Usage: node tools/music-ai/harshness-selftest.mjs
   ========================================================================== */

const SR = 44100;
const SECONDS = 4;

/* The first attempt at this measured "loudest 20 ms of high-frequency energy over
   the overall level" and it did not work: when something screeches continuously,
   the worst window and the average rise together and the ratio flattens out. The
   synthetic broken signal below scored 3.18 against a threshold of 6 - the metric
   could not have caught the bug it was written for.

   What does separate them is a local measure: inside each 20 ms window, how much
   of that window's own energy is high-frequency, and then the worst window of all.
   A plucked tone keeps a small share in every window; a comb filter ringing
   broadband keeps a large one. */
function harshness(samples, sampleRate) {
  const win = Math.round(sampleRate * 0.02);
  let worst = 0, hsum = 0, tsum = 0, n = 0, prev = samples[0] || 0;
  for (let i = 0; i < samples.length; i++) {
    const d = samples[i] - prev; prev = samples[i];
    hsum += d * d;
    tsum += samples[i] * samples[i];
    n++;
    if (n === win) {
      const share = hsum / Math.max(tsum, 1e-12);
      if (share > worst) worst = share;
      hsum = 0; tsum = 0; n = 0;
    }
  }
  return Math.round(worst * 10000) / 10000;
}

/* a plucked string: one tone, fast attack, slow decay, a whisper of noise */
function clean() {
  const n = SR * SECONDS, out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const note = Math.floor(t * 4) / 4;                 // four notes per second
    const age = t - note;
    const env = Math.exp(-age * 4);
    out[i] = 0.4 * env * Math.sin(2 * Math.PI * 196 * age)
           + 0.12 * env * Math.sin(2 * Math.PI * 392 * age)
           + 0.01 * (Math.random() * 2 - 1) * env;
  }
  return out;
}

/* the broken case: noise into a delay line whose delay was clamped to 128 samples
   with 0.965 of it fed back — a comb filter with a very high Q */
function broken() {
  const n = SR * SECONDS, out = new Float64Array(n);
  const buf = new Float64Array(128);
  let p = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const note = Math.floor(t * 4) / 4;
    const age = t - note;
    const excite = age < 1 / 196 ? (Math.random() * 2 - 1) : 0;   // one period of noise
    const delayed = buf[p];
    const v = excite + 0.965 * delayed;
    buf[p] = v;
    p = (p + 1) % 128;
    out[i] = Math.max(-1, Math.min(1, v * 0.5));
  }
  return out;
}

const rows = [
  ["clean plucked tone", clean()],
  ["clamped-delay feedback", broken()]
];

console.log("signal                     harshness   verdict");
for (const [name, sig] of rows) {
  const h = harshness(sig, SR);
  console.log(name.padEnd(26) + String(h).padStart(8) + "   " + (h >= 0.35 ? "would FAIL" : "passes"));
}
console.log("\nThreshold under test: 0.35. If the second row does not clear it easily,");
console.log("the metric cannot be trusted to catch the bug it exists for.");
