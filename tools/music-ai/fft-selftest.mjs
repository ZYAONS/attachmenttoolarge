#!/usr/bin/env node
/* ==========================================================================
   fft-selftest.mjs — is the spectrum measurement itself correct?

   The band shares it reported said 92% of the energy in both pieces sat above
   2 kHz, with a centroid near 11 kHz. That is not what music looks like; it is
   what a broken transform looks like. This feeds the identical routine known
   signals and prints what it makes of them:

     440 Hz sine          → centroid should be ~440 Hz
     4 kHz sine           → centroid should be ~4 kHz
     sine + quiet noise   → centroid should move, but stay in the same region

   Usage: node tools/music-ai/fft-selftest.mjs
   ========================================================================== */

const N = 2048;
const SR = 44100;

function spectrumCentroid(samples, sampleRate) {
  const re = new Float64Array(N), im = new Float64Array(N);
  const cosT = new Float64Array(N / 2), sinT = new Float64Array(N / 2);
  for (let k = 0; k < N / 2; k++) {
    cosT[k] = Math.cos(-2 * Math.PI * k / N);
    sinT[k] = Math.sin(-2 * Math.PI * k / N);
  }
  const frames = Math.max(1, Math.floor(samples.length / N));
  const acc = new Float64Array(N / 2);
  for (let f = 0; f < frames; f++) {
    const off = f * N;
    for (let i = 0; i < N; i++) {
      const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
      re[i] = samples[off + i] * w;
      im[i] = 0;
    }
    /* Direct DFT — the same routine the site uses. This file previously carried a
       copy of the broken iterative radix-2 FFT, so it kept reporting that the
       measurement was wrong long after the app had been fixed. A self-test that
       tests a different implementation than the one in use is worse than none. */
    const binHz0 = sampleRate / N;
    const kTop = Math.min(N / 2, Math.ceil(9000 / binHz0));
    for (let k = 1; k < kTop; k++) {
      let sr = 0, si = 0;
      const th0 = 2 * Math.PI * k / N;
      for (let i = 0; i < N; i++) {
        sr += re[i] * Math.cos(th0 * i);
        si += re[i] * Math.sin(th0 * i);
      }
      acc[k] += sr * sr + si * si;
    }
  }
  const binHz = sampleRate / N;
  let total = 0, weighted = 0, low = 0, mid = 0, high = 0;
  for (let k = 1; k < N / 2; k++) {
    const power = acc[k] / frames, hz = k * binHz;
    total += power; weighted += power * hz;
    if (hz < 300) low += power; else if (hz < 2000) mid += power; else high += power;
  }
  return {
    centroidHz: Math.round(weighted / total),
    lowShare: +(low / total).toFixed(3),
    midShare: +(mid / total).toFixed(3),
    highShare: +(high / total).toFixed(3)
  };
}

/* print where the energy actually lands: the peak bin must be the tone's bin */
function peakBins(samples, sampleRate, howMany = 5) {
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
    re[i] = samples[i] * w; im[i] = 0;
  }
  // direct DFT at a few candidate frequencies, as a reference measurement
  const binHz = sampleRate / N;
  const mags = [];
  for (let k = 0; k < N / 2; k++) {
    let sr = 0, si = 0;
    for (let i = 0; i < N; i++) {
      const th = -2 * Math.PI * k * i / N;
      sr += re[i] * Math.cos(th);
      si += re[i] * Math.sin(th);
    }
    mags.push({ k, hz: Math.round(k * binHz), p: sr * sr + si * si });
  }
  return mags.sort((a, b) => b.p - a.p).slice(0, howMany);
}

function tone(hz, seconds, amp = 0.5) {
  const n = Math.round(SR * seconds);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin(2 * Math.PI * hz * i / SR);
  return out;
}
function addNoise(sig, level) {
  for (let i = 0; i < sig.length; i++) sig[i] += (Math.random() * 2 - 1) * level;
  return sig;
}

const cases = [
  ["440 Hz sine", tone(440, 1)],
  ["4 kHz sine", tone(4000, 1)],
  ["440 Hz + quiet noise", addNoise(tone(440, 1), 0.02)],
  ["110 Hz sine (a bass note)", tone(110, 1)],
  ["two sines, 110 + 4k", (() => { const a = tone(110, 1, 0.5), b = tone(4000, 1, 0.5); for (let i = 0; i < a.length; i++) a[i] += b[i]; return a; })()]
];

console.log("signal                     centroid    low / mid / high");
for (const [name, sig] of cases) {
  const s = spectrumCentroid(sig, SR);
  console.log(name.padEnd(26) + String(s.centroidHz).padStart(7) + " Hz   " +
              s.lowShare + " / " + s.midShare + " / " + s.highShare);
}
console.log("\n--- direct DFT reference: where the energy really is (440 Hz sine) ---");
for (const b of peakBins(tone(440, 1), SR)) {
  console.log("  bin " + String(b.k).padStart(5) + "  " + String(b.hz).padStart(7) + " Hz   power " + b.p.toExponential(3));
}

console.log("\nA 440 Hz sine must read about 440 Hz. If everything reads near 10 kHz,");
console.log("the transform is wrong and every spectrum number taken from it is worthless.");
