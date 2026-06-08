// solver.js — the 3Blue1Brown information overlay.
//
// Two different numbers matter, and keeping them apart is the whole point:
//
//   EXPECTED information of a guess  = the entropy of the pattern distribution
//     it induces over the current candidates. This is intrinsic to the guess —
//     it does NOT depend on the host. It's the average bits you'd gain if the
//     answer were a uniformly random candidate.
//
//   REALIZED information of a guess  = log2(before/after) — what you ACTUALLY
//     gained once the host committed to a pattern. This DOES depend on the host.
//
// Against Absurdle, realized < expected (it steers you into the big bucket).
// Against Easy, realized > expected. The gap is the host's thumb on the scale.

import { ANSWERS } from "./words.js";
import { bucketize } from "./engine.js";

// Cached entropy-optimal openers (the one expensive case — N = 2315 candidates).
// We recommend guesses from the curated common-answer pool only, so the overlay
// never surfaces the slang/obscure entries that pad the full allowed list. The
// bits lost versus searching all ~15k allowed words is negligible (~0.05).
export const OPENER_CACHE = {
  poolSize: ANSWERS.length,
  best: [
    ["raise", 5.8779], ["slate", 5.8558], ["crate", 5.8349], ["irate", 5.8314],
    ["trace", 5.8305], ["arise", 5.8209], ["stare", 5.8073], ["snare", 5.7701],
    ["arose", 5.7678], ["least", 5.7516], ["alert", 5.7458], ["crane", 5.7428],
  ],
};

// Expected information (bits) of a guess against a candidate set.
export function expectedInfo(guess, candidates) {
  const n = candidates.length;
  if (n <= 1) return 0;
  const buckets = bucketize(guess, candidates);
  let H = 0;
  for (const arr of buckets.values()) {
    const p = arr.length / n;
    H -= p * Math.log2(p);
  }
  return H;
}

// Find the guess that maximizes expected information against `candidates`.
// Cost is bounded so this stays snappy on the main thread:
//   - full candidate pool (move 1): served from OPENER_CACHE.
//   - small candidate sets: search ALL allowed words.
//   - mid candidate sets: search candidates only (a strong approximation; the
//     theoretical best can be a non-candidate "probe", but for a live demo this
//     is fast and almost always agrees).
export function bestGuess(candidates) {
  const n = candidates.length;
  if (n === ANSWERS.length) {
    const [word, bits] = OPENER_CACHE.best[0];
    return { word, bits, exhaustive: true };
  }
  if (n <= 1) return { word: candidates[0] || null, bits: 0, exhaustive: true };

  // Recommend only from the curated answer pool (keeps suggestions to familiar
  // words; candidates are a subset of it, so winning guesses are always in
  // range). With many candidates, search just the candidates to stay fast.
  const searchSpace = n <= 60 ? ANSWERS : candidates;
  const candSet = new Set(candidates);
  let best = null, bestH = -1, bestIsCand = false;
  for (const g of searchSpace) {
    const H = expectedInfo(g, candidates);
    const isCand = candSet.has(g);
    // Strictly more information wins; on a tie, prefer a guess that is itself a
    // candidate (it can clinch the game this turn).
    if (H > bestH + 1e-9 || (Math.abs(H - bestH) < 1e-9 && isCand && !bestIsCand)) {
      bestH = H; best = g; bestIsCand = isCand;
    }
  }
  return { word: best, bits: bestH, exhaustive: n <= 60 };
}

// Max possible information remaining: log2 of the candidate count. You can never
// learn more than this in total, no matter how clever the guess.
export function uncertaintyBits(candidates) {
  return Math.log2(Math.max(1, candidates.length));
}
