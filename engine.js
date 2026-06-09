// engine.js — the unified Wordle engine.
//
// Every variant in this demo is the SAME engine with a different "host policy".
// The engine tracks the set of answers still consistent with all feedback given
// so far ("candidates"). When the player guesses, we partition the candidates by
// the color pattern each would produce. A host policy then chooses WHICH pattern
// to reveal — and that single choice is a choice of how much information
// (3Blue1Brown's definition, bits = log2(before/after)) to hand the player.

import { ANSWERS } from "./words.js";

export const GREEN = 2, YELLOW = 1, GRAY = 0;
export const ALL_GREEN = 242; // 2*81 + 2*27 + 2*9 + 2*3 + 2

// --- Pattern computation -----------------------------------------------------
// Returns a base-3 integer 0..242. Digit i (most significant = position 0) is
// 2 green / 1 yellow / 0 gray. Duplicate letters handled the real Wordle way.
export function patternCode(guess, answer) {
  const res = [0, 0, 0, 0, 0];
  const counts = new Array(26).fill(0);
  for (let i = 0; i < 5; i++) {
    if (guess[i] === answer[i]) res[i] = GREEN;
    else counts[answer.charCodeAt(i) - 97]++;
  }
  for (let i = 0; i < 5; i++) {
    if (res[i] === GREEN) continue;
    const c = guess.charCodeAt(i) - 97;
    if (counts[c] > 0) { res[i] = YELLOW; counts[c]--; }
  }
  return res[0] * 81 + res[1] * 27 + res[2] * 9 + res[3] * 3 + res[4];
}

// Decode a pattern code into an array of 5 tile states.
export function decodePattern(code) {
  const out = [0, 0, 0, 0, 0];
  for (let i = 4; i >= 0; i--) { out[i] = code % 3; code = (code - out[i]) / 3; }
  return out;
}

function greensYellows(code) {
  const t = decodePattern(code);
  let g = 0, y = 0;
  for (const v of t) { if (v === GREEN) g++; else if (v === YELLOW) y++; }
  return g * 2 + y; // weight greens heavier — "how revealing" a pattern is
}

// Bucket a candidate list by the pattern `guess` would produce. Returns a Map
// patternCode -> array of candidate words.
export function bucketize(guess, candidates) {
  const buckets = new Map();
  for (const cand of candidates) {
    const code = patternCode(guess, cand);
    let arr = buckets.get(code);
    if (!arr) buckets.set(code, (arr = []));
    arr.push(cand);
  }
  return buckets;
}

// --- Host policies -----------------------------------------------------------
// A policy is a function (buckets, ctx) -> chosen patternCode.
// `ctx` carries { guess, candidates, secret } for policies that need it.
//
// The easy/medium/hard/absurdle family is a single idea: every host commits to
// an HONEST surviving bucket, but each aims at a different point in the RANGE of
// information available on that particular guess. On any guess the buckets span
// a range of realized information — from the largest bucket (least info) to the
// smallest (most info). A host with knob alpha targets:
//   target = least_info + alpha * (most_info - least_info)
// and commits to the bucket whose realized info is closest.
//   Absurdle alpha=0    -> least info (largest bucket; qntm's rule)
//   Hard     alpha=0.20 -> a bit below an honest guess
//   Medium   alpha=0.45 -> a bit above an honest guess
//   Easy     alpha=0.72 -> well above honest, but not an instant win
// Because the range is recomputed each guess, the hosts stay clearly separated
// and monotone on every move (a fixed candidate-fraction does not — when the
// biggest bucket is small, several hosts collapse onto it). Realized info from
// an HONEST secret averages to the guess's entropy, which lands between Hard and
// Medium — so the experienced ladder is Easy > Medium > Original > Hard >
// Absurdle, exactly matching "easy gives the most info, hard the least."
// The all-green (win) bucket is only ever chosen when it is the host's ONLY one.

function nonWinSorted(buckets) {
  const nonWin = [...buckets.entries()].filter(([code]) => code !== ALL_GREEN);
  // small -> large; ties broken so the "grayer" (less revealing) pattern is
  // treated as larger — the adversarial end also leaks the least per word.
  nonWin.sort((a, b) => {
    if (a[1].length !== b[1].length) return a[1].length - b[1].length;
    const ga = greensYellows(a[0]), gb = greensYellows(b[0]);
    if (ga !== gb) return gb - ga;
    return a[0] - b[0];
  });
  return nonWin;
}

// Pick the honest bucket whose realized information is at level `alpha` of the
// range available on this guess (0 = least info / largest bucket, 1 = most).
function pickByInfoLevel(buckets, candCount, alpha) {
  const nonWin = nonWinSorted(buckets); // small -> large by size
  if (nonWin.length === 0) return ALL_GREEN;
  const info = (size) => Math.log2(candCount / size);
  const mostInfo = info(nonWin[0][1].length);                     // smallest bucket
  const leastInfo = info(nonWin[nonWin.length - 1][1].length);    // largest bucket
  const target = leastInfo + alpha * (mostInfo - leastInfo);
  let best = nonWin[0][0], bestDist = Infinity;
  for (const [code, arr] of nonWin) {
    const d = Math.abs(info(arr.length) - target);
    if (d < bestDist) { bestDist = d; best = code; }
  }
  return best;
}

// Absurdle: keep the single largest honest bucket (qntm's rule).
function pickLargest(buckets) {
  const nonWin = nonWinSorted(buckets);
  if (nonWin.length === 0) return ALL_GREEN;
  return nonWin[nonWin.length - 1][0];
}

export const POLICIES = {
  // Honest, pre-committed secret word — real Wordle.
  original: {
    label: "Original",
    blurb: "A fixed secret word, chosen at the start. Honest feedback every guess. The information you get is whatever an unlucky-or-lucky draw happens to give.",
    needsSecret: true,
    guessLimit: 6,
    select: (buckets, ctx) => patternCode(ctx.guess, ctx.secret),
  },

  // Maximally adversarial — qntm's Absurdle. Keeps the most candidates alive.
  absurdle: {
    label: "Absurdle",
    blurb: "No secret word at all. After each guess the host keeps whichever set of answers is LARGEST, telling you as little as it legally can while staying consistent. Credit: qntm.",
    needsSecret: false,
    guessLimit: Infinity,
    select: (buckets) => pickLargest(buckets),
  },

  // Gag mode — the answer teleports to be exactly your guess.
  alwaysRight: {
    label: "Always Right",
    blurb: "The answer is whatever you just typed. You win on move 1, every time, handing over a full ~11 bits at once. It's the degenerate extreme of maximum information.",
    needsSecret: false,
    guessLimit: 6,
    select: () => ALL_GREEN,
  },

  // Benevolent adversary — collapses your candidate set as fast as possible.
  easy: {
    label: "Easy",
    blurb: "A host rooting for you. Each guess it reveals near the top of what's possible, far more than an honest guess would, collapsing your candidates fast without quite handing you the win.",
    needsSecret: false,
    guessLimit: 6,
    select: (buckets, ctx) => pickByInfoLevel(buckets, ctx.candidates.length, 0.72),
  },

  medium: {
    label: "Medium",
    blurb: "A mildly generous host: it reveals a bit more than an honest guess would, but well short of Easy.",
    needsSecret: false,
    guessLimit: 6,
    select: (buckets, ctx) => pickByInfoLevel(buckets, ctx.candidates.length, 0.45),
  },

  hard: {
    label: "Hard",
    blurb: "A stingy host leaning toward Absurdle: each guess it reveals a bit LESS than an honest guess would, keeping you in the dark longer.",
    needsSecret: false,
    guessLimit: 6,
    select: (buckets, ctx) => pickByInfoLevel(buckets, ctx.candidates.length, 0.20),
  },
};

export const SPECTRUM = ["alwaysRight", "easy", "medium", "original", "hard", "absurdle"];

// --- The game ----------------------------------------------------------------
export class Game {
  constructor(policyKey, opts = {}) {
    this.policyKey = policyKey;
    this.policy = POLICIES[policyKey];
    this.pool = opts.pool || ANSWERS;
    this.candidates = this.pool.slice();
    this.history = []; // { guess, code, before, after, bits }
    this.won = false;
    this.over = false;
    this.secret = null;
    if (this.policy.needsSecret) {
      const r = opts.rng ? opts.rng() : Math.random();
      this.secret = this.pool[Math.floor(r * this.pool.length)];
    }
  }

  get guessLimit() { return this.policy.guessLimit; }
  get guessesUsed() { return this.history.length; }

  // Submit a guess word. Returns the resolved move record.
  submit(guess) {
    if (this.over) throw new Error("game over");
    const before = this.candidates.length;
    const buckets = bucketize(guess, this.candidates);
    const code = this.policy.select(buckets, {
      guess, candidates: this.candidates, secret: this.secret,
    });
    // For alwaysRight the chosen pattern may not correspond to any real
    // candidate; that's intentional (the answer teleports). Everyone else picks
    // an existing bucket, so candidates collapse to it.
    const survivors = buckets.get(code);
    this.candidates = survivors ? survivors : [guess];
    const after = this.candidates.length;
    const bits = Math.log2(before / after);
    const move = { guess, code, before, after, bits };
    this.history.push(move);
    if (code === ALL_GREEN) { this.won = true; this.over = true; }
    else if (this.history.length >= this.guessLimit) { this.over = true; }
    return move;
  }
}
