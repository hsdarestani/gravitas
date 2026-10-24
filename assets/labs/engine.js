/* GraviQuest Topic 01: deterministic, browser-only educational simulation engine.
   No network calls, eval, external dependencies, or access to private workspace state.
   These are simplified teaching models, never experimental protein measurements
   or benchmark results from real language models. */
(function (root) {
  "use strict";
  const clamp = (v, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(v)) ? Number(v) : min));
  const sigmoid = x => 1 / (1 + Math.exp(-x));
  function seeded(seed) {
    let x = (Number(seed) >>> 0) || 1;
    return function () {
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
      return (x >>> 0) / 4294967296;
    };
  }
  function equilibrium(tempC, meltC, widthC) {
    const t = clamp(tempC, 0, 150);
    return 1 / (1 + Math.exp((t - clamp(meltC, 15, 120)) / clamp(widthC, 1, 30)));
  }
  function foldedFraction(tempC, minutes, meltC, widthC) {
    const temperature = clamp(tempC, 0, 150);
    const time = clamp(minutes, 0, 180);
    const eq = equilibrium(temperature, meltC, widthC);
    const start = equilibrium(20, meltC, widthC);
    const rate = 0.035 + 0.004 * Math.max(0, temperature - 20);
    return clamp(eq + (start - eq) * Math.exp(-rate * time), 0, 1);
  }
  function protein(input) {
    const x = input || {};
    const temperature = clamp(x.temperature, 20, 90);
    const minutes = clamp(x.minutes, 1, 60);
    const meltC = clamp(x.meltC === undefined ? 58 : x.meltC, 40, 76);
    const widthC = clamp(x.widthC === undefined ? 5 : x.widthC, 2, 12);
    const folded = foldedFraction(temperature, minutes, meltC, widthC);
    const points = [];
    for (let t = 20; t <= 90; t += 5) {
      points.push({ t, folded: foldedFraction(t, minutes, meltC, widthC), measured: false });
    }
    // Controlled synthetic teaching fixture. Only 20-50°C are "observed" in the story.
    const practice = [20, 30, 40, 50].map((t, i) => ({
      t, folded: clamp(foldedFraction(t, 10, 58, 5) + [0.005, -0.007, 0.01, -0.008][i], 0, 1),
      label: "Synthetic practice observation (10 min)"
    }));
    return { temperature, minutes, meltC, widthC, folded, points, practice, measuredMax: 50,
      model: "Two-state equilibrium with illustrative exponential relaxation; not molecular dynamics." };
  }
  function bias(input) {
    const x = input || {};
    const runs = Math.round(clamp(x.runs === undefined ? 100 : x.runs, 10, 1000));
    const agreeability = clamp(x.agreeability === undefined ? 75 : x.agreeability, 0, 100) / 100;
    const evidence = clamp(x.evidence === undefined ? 65 : x.evidence, 0, 100) / 100;
    const seed = Math.round(clamp(x.seed === undefined ? 4701 : x.seed, 1, 2147483647));
    // A deliberately stated toy assumption: leading prompts increase the simulated
    // tendency to agree. This formula does NOT estimate any real model's behavior.
    const neutralProbability = sigmoid(-0.7 + 1.0 * agreeability - 3.2 * evidence);
    const leadingProbability = sigmoid(-0.7 + 3.2 * agreeability - 3.2 * evidence);
    const random = seeded(seed);
    let neutralAgree = 0, leadingAgree = 0;
    for (let i = 0; i < runs; i++) {
      const u = random(); // paired draws hold simulated variation constant
      if (u < neutralProbability) neutralAgree++;
      if (u < leadingProbability) leadingAgree++;
    }
    return { runs, seed, agreeability, evidence,
      neutralAgree, leadingAgree,
      neutralRate: neutralAgree / runs, leadingRate: leadingAgree / runs,
      neutralProbability, leadingProbability,
      note: "Synthetic Monte Carlo teaching model. Not real LLM outputs or measured bias." };
  }
  const api = Object.freeze({ version: "1.0.0", clamp, seeded, equilibrium, foldedFraction, protein, bias });
  root.GraviLab = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
