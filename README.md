# Wordle & the Shape of Difficulty

### ▶ Play it live: **https://beaurancourt.github.io/wordle-demonstration/**

A small static site demonstrating a family of Wordle variants, built to make one
point precise: **all of these games are the same engine with a different "host
policy."** The only thing that really changes between them is how much information
(in [3Blue1Brown's sense](https://www.youtube.com/watch?v=v68zYyaEmEA),
bits = log₂(candidates_before / candidates_after)) the host is willing to give
you per guess.

Built for a blog post about *static* difficulty (a fixed secret word) versus
*dynamic* difficulty (an adversary who reshapes the answer to starve you of
clues, à la [Absurdle](https://qntm.org/absurdle)).

## Run it

It's plain HTML and ES modules, with no build step. Serve the folder over HTTP,
since ES modules won't load from `file://`:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Deploy by copying the folder to GitHub Pages, Netlify, or any static host.

## The core idea

The engine tracks the set of answers still consistent with all feedback so far
(`candidates`). When you guess, it partitions the candidates by the color
pattern each would produce. A host policy then chooses which pattern to reveal,
and that single choice is a choice of how much information to hand you. Every
variant is just a different policy:

| Variant        | The host reveals…                                  | Information |
|----------------|----------------------------------------------------|-------------|
| Always Right   | the win, now                                       | ∞ (ends)    |
| Easy           | near the top of the range available on the guess   | most        |
| Medium         | a bit more than an honest guess would              | more        |
| Original       | whatever a fixed secret word happens to give       | baseline    |
| Hard           | a bit less than an honest guess would              | less        |
| Absurdle       | the least it legally can (the biggest bucket)      | least       |

Easy, Medium, Hard, and Absurdle are literally one function aimed at a different
point in the information range available on each guess, so the difficulty knob is
the information knob. Because the range is recomputed every guess, the hosts stay
cleanly separated and monotone on every move. Realized information from an honest
secret averages to the guess's entropy, which sits between Hard and Medium, so
the experienced ladder is **Easy > Medium > Original > Hard > Absurdle**.

### Expected vs. Realized: the host's thumb on the scale

The information overlay separates two numbers, and the gap between them is the
whole story:

- **Expected** information of a guess is the entropy of the pattern distribution
  it induces over the current candidates. It's intrinsic to the guess and does
  not depend on the host.
- **Realized** information is `log₂(before/after)`, what you actually gained after
  the host committed to a pattern. This does depend on the host.

Against Absurdle, realized comes in below expected, because it steers you into the
biggest bucket. Against Easy, realized runs above expected. Against an honest
secret word, realized tracks expected and fluctuates only by luck.

## The views

- **Six variants.** Play any host directly. Toggle the information overlay to see
  the live bits readout, candidate count, optimal next guess, and the
  expected-vs-realized trace.
- **Comparison Lab.** Type one sequence of guesses and watch every host react to
  the *same* guesses side by side, with per-guess realized-bits bars.
- **Mystery Host.** You're playing one of the hosts but aren't told which. Can you
  feel the difference from inside the game? The realized-bits column is your only
  tell, and the host is revealed at the end.

## Files

| File         | What it is |
|--------------|-----------|
| `index.html` | Markup and view scaffolding |
| `styles.css` | Wordle-faithful styling, light/dark |
| `engine.js`  | Pattern computation, candidate tracking, the host policies |
| `solver.js`  | Entropy / expected-information math + best-guess search |
| `app.js`     | UI: boards, keyboard, overlay, Lab, Mystery |
| `words.js`   | Word lists (auto-generated) |

## Word lists & attribution

- Answer pool: the original Wordle answers (the host's candidate set, used with a
  uniform prior), 2,307 after filtering. Recommended guesses are drawn only from
  this curated pool, so the overlay never surfaces obscure or slang words.
- Allowed guesses: the superset you may type (14,796 after filtering), from the
  open [tabatkins/wordle-list](https://github.com/tabatkins/wordle-list).
- Slurs and profanity have been removed from both lists for this public deploy
  (59 words from the allowed guesses, 8 from the answer pool). Aside from that,
  these are the original pre-NYT lists, chosen deliberately for fidelity with
  3Blue1Brown's analysis rather than the modern NYT game's curated set.
- **Absurdle** is by [qntm](https://qntm.org/absurdle).
- The information framing follows
  [3Blue1Brown's Wordle video](https://www.youtube.com/watch?v=v68zYyaEmEA)
  (uniform prior, no word-frequency weighting, to keep the math legible).

## Notes & simplifications

- The solver uses a uniform prior over the answer pool (3b1b weights by word
  frequency). This keeps "bits" easy to reason about for a teaching demo.
- The best-guess search is exhaustive over the answer pool when few candidates
  remain and restricted to the candidate set when many remain, a strong and fast
  approximation. The expensive opening move is precomputed and cached.
- Absurdle is uncapped (the challenge is fewest guesses); the others use the
  classic six-guess limit.
