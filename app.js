// app.js — UI for the Wordle-variants lab.
import { ALLOWED_SET, ANSWERS } from "./words.js";
import { Game, POLICIES, SPECTRUM, decodePattern, GREEN, YELLOW } from "./engine.js";
import { expectedInfo, bestGuess, uncertaintyBits } from "./solver.js";

const $ = (sel, root = document) => root.querySelector(sel);
const fmt = (b) => (b === Infinity ? "∞" : b.toFixed(2));
const STATE_CLASS = ["gray", "yellow", "green"];

// ---------- theme ----------
const themeToggle = $("#themeToggle");
const savedTheme = localStorage.getItem("wv-theme");
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
else if (matchMedia("(prefers-color-scheme: dark)").matches) document.documentElement.dataset.theme = "dark";
themeToggle.onclick = () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("wv-theme", next);
};

// ---------- keyboard rendering ----------
const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "ZxcvbnmB"]; // Z=Enter, B=Back
function buildKeyboard(container, onKey) {
  container.innerHTML = "";
  for (const rowStr of KEY_ROWS) {
    const row = document.createElement("div");
    row.className = "krow";
    for (const ch of rowStr) {
      const key = document.createElement("button");
      key.className = "key";
      if (ch === "Z") { key.textContent = "Enter"; key.classList.add("wide"); key.dataset.key = "Enter"; }
      else if (ch === "B") { key.textContent = "⌫"; key.classList.add("wide"); key.dataset.key = "Backspace"; }
      else { key.textContent = ch; key.dataset.key = ch; }
      key.onclick = () => onKey(key.dataset.key);
      row.appendChild(key);
    }
    container.appendChild(row);
  }
}
function paintKeyboard(container, history) {
  const best = {}; // letter -> max state
  for (const mv of history) {
    const tiles = decodePattern(mv.code);
    for (let i = 0; i < 5; i++) {
      const c = mv.guess[i];
      best[c] = Math.max(best[c] ?? -1, tiles[i]);
    }
  }
  for (const key of container.querySelectorAll(".key")) {
    const k = key.dataset.key;
    if (k.length !== 1 || !/[a-z]/.test(k)) continue;
    key.classList.remove("green", "yellow", "gray");
    if (best[k] != null && best[k] >= 0) key.classList.add(STATE_CLASS[best[k]]);
  }
}

// ---------- reusable play controller ----------
class PlayController {
  constructor({ boardEl, keyboardEl, messageEl, makeGame, onUpdate, reveal = true }) {
    this.boardEl = boardEl;
    this.keyboardEl = keyboardEl;
    this.messageEl = messageEl;
    this.makeGame = makeGame;
    this.onUpdate = onUpdate || (() => {});
    this.reveal = reveal;
    buildKeyboard(keyboardEl, (k) => this.handleKey(k));
    this.newGame();
  }
  newGame() {
    this.game = this.makeGame();
    this.typed = "";
    this.moves = []; // { guess, expected, realized, before, after }
    this.message("");
    this.render();
    this.onUpdate(this, null);
  }
  message(text, cls = "") {
    this.messageEl.textContent = text;
    this.messageEl.className = "message" + (cls ? " " + cls : "");
  }
  rowCount() {
    const lim = this.game.guessLimit;
    return isFinite(lim) ? lim : Math.max(6, this.game.history.length + 1);
  }
  handleKey(k) {
    if (this.game.over) return;
    if (k === "Enter") return this.submit();
    if (k === "Backspace") { this.typed = this.typed.slice(0, -1); return this.render(); }
    if (/^[a-zA-Z]$/.test(k) && this.typed.length < 5) { this.typed += k.toLowerCase(); this.render(); }
  }
  submit() {
    if (this.typed.length !== 5) return this.flash("Not enough letters");
    if (!ALLOWED_SET.has(this.typed)) return this.flash("Not in word list");
    const guess = this.typed;
    const candsBefore = this.game.candidates;
    const expected = expectedInfo(guess, candsBefore);
    const move = this.game.submit(guess);
    this.moves.push({ guess, expected, realized: move.bits, before: move.before, after: move.after });
    this.typed = "";
    this.render(move);
    if (this.game.won) this.message(`Solved in ${this.game.guessesUsed}! 🎉`, "win");
    else if (this.game.over) {
      const ans = this.game.secret || this.game.candidates[0] || "—";
      this.message(`Out of guesses — answer: ${ans.toUpperCase()}`, "lose");
    }
    this.onUpdate(this, move);
  }
  flash(text) {
    this.message(text);
    clearTimeout(this._t);
    this._t = setTimeout(() => { if (!this.game.over) this.message(""); }, 1100);
  }
  render(lastMove) {
    const rows = this.rowCount();
    const histLen = this.game.history.length;
    this.boardEl.style.setProperty("--rows", rows);
    this.boardEl.innerHTML = "";
    for (let r = 0; r < rows; r++) {
      const row = document.createElement("div");
      row.className = "row";
      const done = r < histLen ? this.game.history[r] : null;
      const tiles = done ? decodePattern(done.code) : null;
      const typedRow = !done && r === histLen ? this.typed : null;
      for (let c = 0; c < 5; c++) {
        const tile = document.createElement("div");
        tile.className = "tile";
        if (done) {
          tile.textContent = done.guess[c];
          if (this.reveal) tile.classList.add(STATE_CLASS[tiles[c]], "filled");
          if (lastMove && done === lastMove) { tile.classList.add("reveal"); tile.style.animationDelay = `${c * 90}ms`; }
        } else if (typedRow != null && c < typedRow.length) {
          tile.textContent = typedRow[c];
          tile.classList.add("filled");
        }
        row.appendChild(tile);
      }
      this.boardEl.appendChild(row);
    }
    if (this.reveal) paintKeyboard(this.keyboardEl, this.game.history);
  }
}

// ============================================================
//  PLAY VIEW
// ============================================================
const views = {
  play: $("#playView"),
  lab: $("#labView"),
  mystery: $("#mysteryView"),
};
let currentVariant = "original";

// Declared before `play` because the PlayController constructor runs newGame ->
// onUpdate -> updateOverlay, which reads overlayToggle.
const overlayToggle = $("#overlayToggle");
const infoCol = $("#infoCol");

const play = new PlayController({
  boardEl: $("#board"),
  keyboardEl: $("#keyboard"),
  messageEl: $("#message"),
  makeGame: () => new Game(currentVariant),
  onUpdate: (ctrl) => updateOverlay(ctrl),
});

$("#newGame").onclick = () => play.newGame();
overlayToggle.onchange = () => {
  const on = overlayToggle.checked;
  infoCol.hidden = !on;
  $(".play-grid").classList.toggle("with-info", on);
  if (on) updateOverlay(play);
};

function setVariant(key) {
  currentVariant = key;
  const p = POLICIES[key];
  $("#modeTitle").textContent = p.label;
  $("#modeBlurb").textContent = p.blurb;
  play.newGame();
}

function updateOverlay(ctrl) {
  if (!overlayToggle.checked) return;
  const cands = ctrl.game.candidates;
  $("#uncBits").textContent = fmt(uncertaintyBits(cands));
  $("#candCount").textContent = cands.length.toLocaleString();

  // Best guess for the current candidate set (cheap except move 1, which is cached).
  // Only blank it out once the game is actually finished — when a single answer
  // remains, that word IS the recommendation (guess it to win).
  const bestVal = $("#bestGuessVal");
  if (ctrl.game.over) {
    bestVal.innerHTML = "<b>—</b>";
  } else if (cands.length === 1) {
    bestVal.innerHTML = `<b>${cands[0].toUpperCase()}</b> · the only answer left — guess it to win`;
  } else {
    const bg = bestGuess(cands);
    bestVal.innerHTML = bg.word
      ? `<b>${bg.word.toUpperCase()}</b> · ${bg.bits.toFixed(2)} bits expected`
      : "<b>—</b>";
  }
  const yr = $("#yourGuessRow");
  if (ctrl.moves.length) {
    yr.hidden = false;
    const last = ctrl.moves[ctrl.moves.length - 1];
    $("#yourWord").textContent = last.guess.toUpperCase();
    $("#yourBits").textContent = last.expected.toFixed(2);
  } else yr.hidden = true;

  // Trace table: expected vs realized vs the host's thumb on the scale.
  const tbody = $("#trace tbody");
  tbody.innerHTML = "";
  const maxBits = Math.max(0.001, ...ctrl.moves.map((m) => Math.max(m.expected, m.realized)));
  ctrl.moves.forEach((m, i) => {
    const gap = m.realized - m.expected;
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td>${i + 1}</td>` +
      `<td>${m.guess}</td>` +
      `<td>${fmt(m.expected)}</td>` +
      `<td class="bar-cell">${fmt(m.realized)} ` +
        `<span class="bar" style="width:${(m.realized / maxBits) * 60}px"></span></td>` +
      `<td class="${gap >= 0 ? "thumb-pos" : "thumb-neg"}">${gap >= 0 ? "+" : ""}${gap.toFixed(2)}</td>`;
    tbody.appendChild(tr);
  });
  explainGap(ctrl);
}

function explainGap(ctrl) {
  const el = $("#explainGap");
  if (!ctrl.moves.length) {
    el.textContent = "Expected = the bits a guess earns on average (host-independent). Realized = the bits the host actually let you keep. Their difference is the host's thumb on the scale.";
    return;
  }
  // Judge by the AVERAGE gap per guess, not the total — an honest secret has
  // real variance, and a couple of lucky guesses shouldn't read as a rigged host.
  const mean = ctrl.moves.reduce((a, m) => a + (m.realized - m.expected), 0) / ctrl.moves.length;
  if (mean > 0.4) el.textContent = "Realized is running ahead of expected — this host keeps handing you more information than an average guess would earn.";
  else if (mean < -0.4) el.textContent = "Realized keeps falling short of expected — this host is steering you into the biggest surviving group, starving you of information. That's the adversary's signature.";
  else el.textContent = "Realized is tracking expected — the hallmark of an honest, pre-committed secret word (the gaps are just luck).";
}

// ============================================================
//  MODE TABS
// ============================================================
const modeNav = $("#modeNav");
function buildTabs() {
  const frag = document.createDocumentFragment();
  for (const key of SPECTRUM) {
    const b = document.createElement("button");
    b.className = "tab";
    b.textContent = POLICIES[key].label;
    b.dataset.target = "play";
    b.dataset.variant = key;
    frag.appendChild(b);
  }
  for (const [target, label] of [["lab", "Comparison Lab"], ["mystery", "Mystery Host"]]) {
    const b = document.createElement("button");
    b.className = "tab special";
    b.textContent = label;
    b.dataset.target = target;
    frag.appendChild(b);
  }
  modeNav.appendChild(frag);
}
buildTabs();

function activateTab(btn) {
  for (const t of modeNav.querySelectorAll(".tab")) t.classList.remove("active");
  btn.classList.add("active");
  const target = btn.dataset.target;
  for (const k in views) views[k].hidden = k !== target;
  if (target === "play") setVariant(btn.dataset.variant);
  else if (target === "mystery") mystery.newGame();
}
modeNav.onclick = (e) => { const b = e.target.closest(".tab"); if (b) activateTab(b); };

// ============================================================
//  COMPARISON LAB
// ============================================================
const labGuesses = [];
const labSeed = ANSWERS[Math.floor(Math.random() * ANSWERS.length)]; // shared original-secret
const labGames = {};
function resetLab() {
  labGuesses.length = 0;
  for (const key of SPECTRUM) {
    // Use the SAME secret for "original" each reset so its column is stable.
    labGames[key] = new Game(key, key === "original" ? { rng: () => ANSWERS.indexOf(labSeed) / ANSWERS.length } : {});
  }
  renderLab();
}
function labAddGuess(word) {
  word = word.toLowerCase();
  if (!ALLOWED_SET.has(word)) { $("#labInput").classList.add("err"); setTimeout(() => $("#labInput").classList.remove("err"), 600); return; }
  labGuesses.push(word);
  for (const key of SPECTRUM) {
    const g = labGames[key];
    if (!g.over) { try { g.submit(word); } catch {} }
  }
  renderLab();
}
function renderLab() {
  const grid = $("#labGrid");
  grid.innerHTML = "";
  for (const key of SPECTRUM) {
    const g = labGames[key];
    const p = POLICIES[key];
    const totalBits = g.history.reduce((a, m) => a + (isFinite(m.bits) ? m.bits : 0), 0);
    const card = document.createElement("div");
    card.className = "lab-card" + (g.won ? " solved" : "");
    const status = g.won ? `solved in ${g.guessesUsed}` : g.over ? "out of guesses" : `${g.candidates.length.toLocaleString()} answers left`;
    let html = `<h4>${p.label}<span class="lc-bits">${totalBits.toFixed(1)} bits</span></h4>`;
    html += `<div class="lc-status">${status}</div>`;
    html += `<div class="lab-mini">`;
    for (const mv of g.history) {
      const tiles = decodePattern(mv.code);
      html += `<div class="row">`;
      for (let i = 0; i < 5; i++) html += `<div class="tile ${STATE_CLASS[tiles[i]]} filled">${mv.guess[i]}</div>`;
      html += `</div>`;
    }
    html += `</div>`;
    // per-guess realized-bits bars
    if (g.history.length) {
      const maxB = Math.max(...g.history.map((m) => (isFinite(m.bits) ? m.bits : 0)), 1);
      html += `<div class="lab-bars">`;
      g.history.forEach((m, i) => {
        const b = isFinite(m.bits) ? m.bits : 11.2;
        html += `<div class="lab-bar-row"><span class="lbl">${m.guess}</span>` +
          `<span class="barwrap"><span class="bar" style="width:${(b / maxB) * 100}%"></span></span>` +
          `<span class="val">${b.toFixed(2)} bits</span></div>`;
      });
      html += `</div>`;
    }
    card.innerHTML = html;
    grid.appendChild(card);
  }
}
$("#labForm").onsubmit = (e) => {
  e.preventDefault();
  const inp = $("#labInput");
  if (inp.value.length === 5) { labAddGuess(inp.value); inp.value = ""; }
};
$("#labReset").onclick = resetLab;
resetLab();

// ============================================================
//  MYSTERY HOST
// ============================================================
const MYSTERY_POOL = ["original", "easy", "medium", "hard", "absurdle"];
let mysteryKey = null;
const mystery = new PlayController({
  boardEl: $("#mysteryBoard"),
  keyboardEl: $("#mysteryKeyboard"),
  messageEl: $("#mysteryMessage"),
  makeGame: () => {
    mysteryKey = MYSTERY_POOL[Math.floor(Math.random() * MYSTERY_POOL.length)];
    $("#mysteryVerdict").hidden = true;
    return new Game(mysteryKey);
  },
  onUpdate: (ctrl, move) => {
    const tbody = $("#mysteryTrace tbody");
    tbody.innerHTML = "";
    ctrl.moves.forEach((m, i) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${i + 1}</td><td>${m.guess}</td><td>${fmt(m.expected)}</td><td>${fmt(m.realized)}</td>`;
      tbody.appendChild(tr);
    });
    if (ctrl.game.over) revealMystery(ctrl);
  },
});
$("#mysteryNew").onclick = () => mystery.newGame();
$("#mysteryReveal").onclick = () => revealMystery(mystery, true);

function revealMystery(ctrl, gaveUp = false) {
  const v = $("#mysteryVerdict");
  const p = POLICIES[mysteryKey];
  const total = ctrl.moves.reduce((a, m) => a + (m.realized - m.expected), 0);
  let tell;
  if (mysteryKey === "original") tell = "Realized bits hugged the expected line — the fingerprint of an honest, fixed secret.";
  else if (mysteryKey === "absurdle" || mysteryKey === "hard") tell = `Realized fell short of expected by ${(-total).toFixed(2)} bits total — the host was steering you into the biggest groups.`;
  else tell = `Realized beat expected by ${total.toFixed(2)} bits total — the host was quietly helping you.`;
  v.hidden = false;
  v.className = "verdict" + (ctrl.game.won ? " win" : "");
  v.innerHTML = `<h4>It was: ${p.label}</h4><p>${p.blurb}</p><p><b>The tell:</b> ${tell}</p>`;
}

// ============================================================
//  GLOBAL KEYBOARD
// ============================================================
addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const active = !views.play.hidden ? play : !views.mystery.hidden ? mystery : null;
  if (!active) return; // lab has its own text input
  if (document.activeElement && document.activeElement.tagName === "INPUT") return;
  if (e.key === "Enter" || e.key === "Backspace" || /^[a-zA-Z]$/.test(e.key)) {
    e.preventDefault();
    active.handleKey(e.key);
  }
});

// ---------- boot ----------
activateTab(modeNav.querySelector(`.tab[data-variant="original"]`));
