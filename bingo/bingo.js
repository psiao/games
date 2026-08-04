// ===========================================================================
// LS Bingo - bingo.js  (v2 rebuild)
// Host-authoritative. Host runs the caller AND auto-validates wins (no button).
// - Unique serial-numbered cards from a 300-card pool, assigned by the host.
// - Host has NO card; host sees a live participant dashboard.
// - Winning is detected automatically; multiple co-winners supported.
// - Employee ID (EID) gate keys scores to identity for payouts.
// - Scores aggregate to scores/{eid} (foundation for the cross-game leaderboard).
// Reuses the "LS Engagement Games" Firebase project + shared /feedback path.
// Game data lives under bingo/{code}/ ; scores under scores/{eid}.
// ===========================================================================
import { auth, db } from "../common/firebase-config.js";
import { EID_RE } from "../common/eid.js";
import { addToLeaderboard } from "../common/leaderboard.js";
import { signInAnonymously, onAuthStateChanged } from
  "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  ref, set, update, get, onValue, onChildAdded, push, remove, onDisconnect, off, runTransaction
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";
import { BINGO_CONTENT } from "./bingo-content.js?v=2";

const $ = (id) => document.getElementById(id);
const show = (s) => { document.querySelectorAll(".screen").forEach(x => x.classList.remove("active")); $(s).classList.add("active"); };
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---- sound ----------------------------------------------------------------
const Sound = (() => {
  let ctx, muted = localStorage.getItem("bingo_muted") === "1";
  const ensure = () => { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch {} } if (ctx && ctx.state === "suspended") ctx.resume(); };
  const beep = (f, s, d, t = "sine", g = 0.14) => { if (muted || !ctx) return; const o = ctx.createOscillator(), gn = ctx.createGain(); o.type = t; o.frequency.value = f; o.connect(gn); gn.connect(ctx.destination); const at = ctx.currentTime + s; gn.gain.setValueAtTime(0.0001, at); gn.gain.linearRampToValueAtTime(g, at + .012); gn.gain.exponentialRampToValueAtTime(.0001, at + d); o.start(at); o.stop(at + d + .03); };
  const seq = (n) => { ensure(); n.forEach(x => beep(x.f, x.t, x.d, x.type, x.g)); };
  return {
    ensure,
    toggle() { muted = !muted; localStorage.setItem("bingo_muted", muted ? "1" : "0"); return muted; },
    isMuted() { return muted; },
    draw() { seq([{ f: 620, t: 0, d: .1 }, { f: 880, t: .08, d: .12 }]); },
    daub() { seq([{ f: 520, t: 0, d: .06, g: .1 }]); },
    bingo() { seq([{ f: 523, t: 0, d: .14 }, { f: 659, t: .13, d: .14 }, { f: 784, t: .26, d: .14 }, { f: 1046, t: .39, d: .34 }]); },
  };
})();
document.addEventListener("click", () => Sound.ensure(), { once: true });

// ---- state ----------------------------------------------------------------
let ME, ROOM, IS_HOST = false, meta = null, players = {}, listeners = [];
let myCard = null, myMarks = null, autoTimer = null, soundCalled = "", soundWon = "";
let poolCache = null, assigning = false, finalizing = false;
const POOL_SIZE = 300;

// ---- auth -----------------------------------------------------------------
onAuthStateChanged(auth, (u) => { if (u) { ME = u.uid; offerRejoin(); } });
signInAnonymously(auth).catch((e) => { $("join-error").textContent = "Couldn't connect to the server. Check the Firebase config. (" + e.code + ")"; });

// show phrase-language only for icebreaker
$("lang-field").style.display = "none";
$("opt-style").addEventListener("change", () => { $("lang-field").style.display = $("opt-style").value === "icebreaker" ? "block" : "none"; });

function getEid() {
  const raw = ($("eid").value || "").trim().toUpperCase();
  if (!EID_RE.test(raw)) { $("join-error").textContent = "Enter a valid Employee ID to play."; return null; }
  return raw;
}

// ---- helpers --------------------------------------------------------------
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const makeCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
const rangeArr = (lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
function pickN(arr, n) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); }

function makeCard(style, lang) {
  const card = [];
  if (style === "numbers") {
    const ranges = [[1, 15], [16, 30], [31, 45], [46, 60], [61, 75]];
    const cols = ranges.map(([lo, hi]) => pickN(rangeArr(lo, hi), 5));
    for (let r = 0; r < 5; r++) { const row = []; for (let c = 0; c < 5; c++) row.push({ v: cols[c][r] }); card.push(row); }
  } else {
    const pool = style === "emoji" ? BINGO_CONTENT.emojis : (BINGO_CONTENT.icebreaker[lang] || BINGO_CONTENT.icebreaker.en);
    const picks = pickN(pool, 25); let i = 0;
    for (let r = 0; r < 5; r++) { const row = []; for (let c = 0; c < 5; c++) row.push({ v: picks[i++] }); card.push(row); }
  }
  card[2][2] = { v: "FREE", free: true };
  return card;
}
const cardSig = (card) => card.map(row => row.map(c => c.v).join(",")).join("|");
const freshMarks = () => { const m = Array.from({ length: 5 }, () => Array(5).fill(false)); m[2][2] = true; return m; };
const calledSet = () => new Set(Object.keys((meta && meta.called) || {}));
const isCaller = () => meta && (meta.style === "numbers" || meta.style === "emoji");
const fullPool = () => meta.style === "numbers" ? rangeArr(1, 75) : BINGO_CONTENT.emojis.slice();
const fullPoolSize = () => meta.style === "numbers" ? 75 : BINGO_CONTENT.emojis.length;

// ---- create / join --------------------------------------------------------
$("btn-create").addEventListener("click", async () => {
  const name = getName(); if (!name) return;
  const eid = getEid(); if (!eid) return;
  const code = makeCode();
  try {
    await set(ref(db, `bingo/${code}/meta`), {
      hostUid: ME, style: $("opt-style").value, win: $("opt-win").value, lang: $("opt-lang").value,
      state: "lobby", called: {}, lastCalled: "", createdAt: Date.now(),
    });
    await joinRoom(code, name, eid);
  } catch (e) { $("join-error").textContent = "Could not create the game (" + (e.code || e.message) + ")."; }
});
$("btn-join").addEventListener("click", async () => {
  const name = getName(); if (!name) return;
  const eid = getEid(); if (!eid) return;
  const code = ($("join-code").value || "").trim().toUpperCase();
  if (code.length !== 4) { $("join-error").textContent = "Enter the 4-letter room code."; return; }
  const snap = await get(ref(db, `bingo/${code}/meta`));
  if (!snap.exists()) { $("join-error").textContent = "No game found with that code."; return; }
  await joinRoom(code, name, eid);
});
function getName() { const n = ($("name").value || "").trim(); if (!n) $("join-error").textContent = "Enter your name first."; return n; }

async function joinRoom(code, name, eid) {
  $("join-error").textContent = ""; ROOM = code;
  const pRef = ref(db, `bingo/${code}/players/${ME}`);
  const existing = await get(pRef);
  const metaSnap = await get(ref(db, `bingo/${code}/meta`));
  IS_HOST = metaSnap.val().hostUid === ME;
  await update(pRef, { name, eid, connected: true, isHost: IS_HOST, joinedAt: existing.exists() ? existing.val().joinedAt : Date.now() });
  onDisconnect(pRef).update({ connected: false });
  localStorage.setItem("bingo_last", JSON.stringify({ code, name, eid }));
  attachListeners(code);
}
async function offerRejoin() {
  try {
    const last = JSON.parse(localStorage.getItem("bingo_last") || "null"); if (!last) return;
    const snap = await get(ref(db, `bingo/${last.code}/meta`)); if (!snap.exists()) { localStorage.removeItem("bingo_last"); return; }
    const h = $("rejoin-hint"); h.style.display = "block"; h.innerHTML = `Rejoin game <b>${esc(last.code)}</b> as <b>${esc(last.name)}</b>? `;
    const b = document.createElement("button"); b.className = "btn-ghost mini"; b.textContent = "Rejoin";
    b.onclick = () => { $("name").value = last.name; if (last.eid) $("eid").value = last.eid; joinRoom(last.code, last.name, last.eid); }; h.appendChild(b);
  } catch {}
}

// ---- listeners ------------------------------------------------------------
function attachListeners(code) {
  detach();
  const m = ref(db, `bingo/${code}/meta`); onValue(m, s => { meta = s.val(); if (meta) { IS_HOST = meta.hostUid === ME; onMeta(); if (IS_HOST) checkWinners(); } }); listeners.push(m);
  const p = ref(db, `bingo/${code}/players`); onValue(p, s => { players = s.val() || {}; renderPlayers(); if (IS_HOST && meta && meta.state === "playing") { assignCards(); checkWinners(); } }); listeners.push(p);
}
function detach() { listeners.forEach(r => off(r)); listeners = []; stopAuto(); }
function stopAuto() { if (autoTimer) { clearInterval(autoTimer); autoTimer = null; const a = $("auto-draw"); if (a) a.checked = false; } }

// ---- meta / render --------------------------------------------------------
function onMeta() {
  if (!meta) return;
  if (meta.state === "lobby") {
    show("screen-lobby");
    $("lobby-code").textContent = ROOM;
    $("lobby-mode").textContent = modeLabel();
    renderHowto();
    $("btn-start").style.display = IS_HOST ? "block" : "none";
    $("lobby-hint").style.display = IS_HOST ? "none" : "block";
  } else if (meta.state === "won") {
    show("screen-win");
    renderWinners();
    $("btn-again").style.display = IS_HOST ? "block" : "none";
    $("win-hint").textContent = IS_HOST ? "" : "Waiting for the host...";
    if (soundWon !== "1") { soundWon = "1"; Sound.bingo(); }
    stopAuto();
  } else { // playing
    soundWon = "";
    show("screen-game");
    if (IS_HOST) { renderHostView(); }
    else { ensureMyCard(); renderGame(); }
    if (meta.lastCalled && meta.lastCalled !== soundCalled) { soundCalled = meta.lastCalled; Sound.draw(); }
  }
}
function modeLabel() {
  const st = { numbers: "Numbers", emoji: "Emoji", icebreaker: "Icebreaker" }[meta.style] || "Bingo";
  const wn = { line: "line", corners: "four corners", blackout: "blackout" }[meta.win] || meta.win;
  return `${st} · ${wn}`;
}
function renderHowto() {
  const ul = $("howto-list"); if (!ul) return;
  const items = [];
  if (meta.style === "icebreaker") {
    items.push("Tap every square that's true about you.");
    items.push("Complete the win pattern to get BINGO.");
  } else {
    items.push("The host calls items one at a time. Tap the matching squares on your card to daub.");
    items.push("You win when your card's called squares complete the pattern - even if you miss a daub.");
  }
  items.push("Wins are checked automatically - there's no button to press.");
  items.push("More than one person can win at once. Your card number is shown for prize tracking.");
  ul.innerHTML = items.map(t => `<li>${esc(t)}</li>`).join("");
}

// lobby player list
function renderPlayers() {
  const ll = $("lobby-players"); if (!ll) return;
  const entries = Object.entries(players);
  ll.innerHTML = entries.map(([, p]) =>
    `<li><span class="dot ${p.connected ? "" : "off"}"></span><span>${esc(p.name)}</span>${p.isHost ? '<span class="badge">HOST</span>' : ""}</li>`).join("");
  const n = entries.length; $("lobby-count").textContent = `${n} player${n !== 1 ? "s" : ""}`;
}

// ---- host: assign unique cards from the pool ------------------------------
async function loadPool() {
  if (poolCache) return poolCache;
  const s = await get(ref(db, `bingo/${ROOM}/pool`));
  poolCache = s.val() || null;
  return poolCache;
}
async function assignCards() {
  if (!IS_HOST || assigning || !meta || meta.state !== "playing") return;
  assigning = true;
  try {
    const pool = await loadPool(); if (!pool) return;
    const serials = Object.keys(pool);
    const used = new Set(Object.values(players).map(p => p && p.cardNo).filter(Boolean).map(String));
    let free = pickN(serials.filter(s => !used.has(String(s))), serials.length);
    let fi = 0; const updates = {};
    for (const [uid, p] of Object.entries(players)) {
      if (!p || uid === meta.hostUid || !p.connected || p.cardNo) continue;
      if (fi >= free.length) break;
      const serial = free[fi++];
      updates[`bingo/${ROOM}/players/${uid}/cardNo`] = Number(serial);
      updates[`bingo/${ROOM}/players/${uid}/cardJson`] = pool[serial];
    }
    if (Object.keys(updates).length) await update(ref(db), updates);
  } catch {} finally { assigning = false; }
}

// ---- player: read my assigned card ---------------------------------------
function ensureMyCard() {
  if (meta.state !== "playing") return;
  const meP = players[ME] || {};
  if (meP.cardJson) {
    myCard = JSON.parse(meP.cardJson);
    if (!myMarks) myMarks = loadMarks() || freshMarks();
  }
}
const marksKey = () => `bingo_marks_${ROOM}_${ME}`;
const saveMarks = () => { try { localStorage.setItem(marksKey(), JSON.stringify(myMarks)); } catch {} };
const loadMarks = () => { try { return JSON.parse(localStorage.getItem(marksKey()) || "null"); } catch { return null; } };

function renderGame() {
  $("host-dash").style.display = "none";
  $("player-view").style.display = "block";
  $("game-mode").textContent = modeLabel();
  const caller = isCaller();
  $("called-wrap").style.display = caller ? "block" : "none";
  $("called-now").textContent = caller ? (meta.lastCalled || "-") : "";
  $("caller-bar").style.display = "none";
  $("mark-hint").style.display = caller ? "none" : "block";
  $("my-cardno").textContent = (players[ME] && players[ME].cardNo) ? `Card #${players[ME].cardNo}` : "";
  // header (B I N G O only for numbers)
  $("bingo-header").innerHTML = meta.style === "numbers" ? ["B", "I", "N", "G", "O"].map(l => `<span>${l}</span>`).join("") : "";
  if (!myCard) { $("bingo-card").innerHTML = ""; return; }
  const called = calledSet();
  const grid = $("bingo-card"); grid.innerHTML = "";
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
    const cell = myCard[r][c]; const d = document.createElement("div");
    d.className = "cell";
    if (cell.free) { d.classList.add("free"); d.textContent = "FREE"; }
    else {
      d.textContent = cell.v;
      if (meta.style === "icebreaker") d.classList.add("phrase");
      if (myMarks[r][c]) d.classList.add("marked");
      else if (caller && called.has(String(cell.v))) d.classList.add("callable");
    }
    d.addEventListener("click", () => toggleCell(r, c));
    grid.appendChild(d);
  }
  // status: am I a winner?
  const iWon = meta.winners && meta.winners[ME];
  showClaim(iWon ? "You got BINGO!" : "", iWon ? "ok" : "");
}

function toggleCell(r, c) {
  if (!myCard || !meta || meta.state !== "playing") return;
  const cell = myCard[r][c]; if (cell.free) return;
  if (isCaller() && !calledSet().has(String(cell.v))) return; // can't mark what wasn't called
  myMarks[r][c] = !myMarks[r][c]; saveMarks(); Sound.daub();
  if (!isCaller()) { update(ref(db, `bingo/${ROOM}/players/${ME}`), { marksJson: JSON.stringify(myMarks) }); }
  renderGame();
}
function showClaim(txt, cls) { const el = $("claim-msg"); if (!el) return; el.textContent = txt; el.className = "claim-msg" + (cls ? " " + cls : ""); }

// ---- host view: caller bar + dashboard ------------------------------------
function renderHostView() {
  $("player-view").style.display = "none";
  $("host-dash").style.display = "block";
  $("game-mode").textContent = modeLabel();
  const caller = isCaller();
  $("called-wrap").style.display = caller ? "block" : "none";
  $("called-now").textContent = caller ? (meta.lastCalled || "-") : "";
  $("caller-bar").style.display = caller ? "flex" : "none";
  $("btn-draw").style.display = caller ? "inline-block" : "none";
  document.querySelector(".caller-bar .auto").style.display = caller ? "flex" : "none";
  if (caller) $("called-history").innerHTML = Object.keys(meta.called || {}).map(v => `<span>${esc(v)}</span>`).join("");
  renderDash();
}
function renderDash() {
  const list = $("dash-list"); if (!list) return;
  const called = calledSet();
  const rows = Object.entries(players).filter(([uid, p]) => p && uid !== meta.hostUid);
  $("dash-count").textContent = `${rows.length} player${rows.length !== 1 ? "s" : ""}`;
  list.innerHTML = rows.map(([uid, p]) => {
    const card = p.cardJson ? JSON.parse(p.cardJson) : null;
    let prog = "-";
    let won = meta.winners && meta.winners[uid];
    if (card) {
      const marks = isCaller()
        ? card.map(row => row.map(cell => cell.free || called.has(String(cell.v))))
        : (p.marksJson ? JSON.parse(p.marksJson) : freshMarks());
      const pp = patternProgress(card, marks);
      prog = `${pp.done}/${pp.need} ${pp.label}`;
    }
    return `<div class="dash-row ${won ? "won" : ""}">
      <span class="dot ${p.connected ? "" : "off"}"></span>
      <span class="dr-name">${esc(p.name)}</span>
      <span class="dr-eid">${esc(p.eid || "")}</span>
      <span class="dr-card">${p.cardNo ? "#" + p.cardNo : "-"}</span>
      <span class="dr-prog">${won ? "WON" : esc(prog)}</span>
    </div>`;
  }).join("") || `<div class="dash-empty">No players yet.</div>`;
}

// ---- host controls --------------------------------------------------------
$("btn-start").addEventListener("click", async () => {
  if (!IS_HOST) return;
  const nonHost = Object.entries(players).filter(([uid, p]) => p.connected && uid !== meta.hostUid).length;
  if (nonHost < 1) { alert("Need at least 1 player (besides the host) to start."); return; }
  await startGame();
});
$("btn-again").addEventListener("click", () => { if (IS_HOST) startGame(); });
$("btn-draw").addEventListener("click", drawNext);
$("auto-draw").addEventListener("change", (e) => {
  stopAuto();
  if (e.target.checked) autoTimer = setInterval(drawNext, 5000);
});

async function startGame() {
  finalizing = false;
  // fresh unique-card pool for this game
  const pool = buildPool(meta.style, meta.lang || "en");
  poolCache = pool;
  await set(ref(db, `bingo/${ROOM}/pool`), pool);
  // clear player cards + marks + winners + called
  const updates = {};
  Object.keys(players).forEach(uid => {
    updates[`bingo/${ROOM}/players/${uid}/cardNo`] = null;
    updates[`bingo/${ROOM}/players/${uid}/cardJson`] = null;
    updates[`bingo/${ROOM}/players/${uid}/marksJson`] = null;
  });
  await update(ref(db), updates);
  Object.keys(players).forEach(uid => { if (players[uid]) { players[uid].cardNo = null; players[uid].cardJson = null; players[uid].marksJson = null; } });
  myCard = null; myMarks = null; try { localStorage.removeItem(marksKey()); } catch {}
  await update(ref(db, `bingo/${ROOM}/meta`), { state: "playing", called: {}, lastCalled: "", winners: null, winPoints: null });
  await assignCards();
}
function buildPool(style, lang) {
  const pool = {}; const seen = new Set(); let n = 0, guard = 0;
  while (n < POOL_SIZE && guard < POOL_SIZE * 60) {
    guard++;
    const card = makeCard(style, lang);
    const sig = cardSig(card);
    if (seen.has(sig)) continue;
    seen.add(sig); n++; pool[n] = JSON.stringify(card);
  }
  return pool;
}

async function drawNext() {
  if (!IS_HOST || !meta || meta.state !== "playing" || !isCaller()) return;
  const called = meta.called || {};
  const remaining = fullPool().filter(v => !(String(v) in called));
  if (!remaining.length) { stopAuto(); return; }
  const pick = String(remaining[Math.floor(Math.random() * remaining.length)]);
  await update(ref(db), { [`bingo/${ROOM}/meta/called/${pick}`]: Date.now(), [`bingo/${ROOM}/meta/lastCalled`]: pick });
}

// ---- host: automatic win detection ----------------------------------------
async function checkWinners() {
  if (!IS_HOST || finalizing || !meta || meta.state !== "playing") return;
  const called = calledSet();
  const found = {};
  for (const [uid, p] of Object.entries(players)) {
    if (!p || uid === meta.hostUid || !p.connected || !p.cardJson) continue;
    const card = JSON.parse(p.cardJson);
    const marks = isCaller()
      ? card.map(row => row.map(cell => cell.free || called.has(String(cell.v))))
      : (p.marksJson ? JSON.parse(p.marksJson) : freshMarks());
    if (validateWin(card, marks)) found[uid] = { name: p.name || "Someone", eid: p.eid || "", cardNo: p.cardNo || 0 };
  }
  if (!Object.keys(found).length) return;
  finalizing = true;
  const pts = winPoints();
  const winObj = {};
  Object.entries(found).forEach(([uid, w]) => { winObj[uid] = { ...w, points: pts }; });
  await update(ref(db, `bingo/${ROOM}/meta`), { state: "won", winners: winObj, winPoints: pts });
  // scores: winners get points + win; everyone connected gets a game played
  for (const [uid, p] of Object.entries(players)) {
    if (!p || uid === meta.hostUid || !p.connected || !p.eid) continue;
    const won = !!found[uid];
    await addToLeaderboard(p.eid, p.name, "bingo", won ? pts : 0, won);
  }
}
function winPoints() {
  if (isCaller()) {
    const calls = Object.keys(meta.called || {}).length || 1;
    const total = fullPoolSize() || 75;
    return Math.max(10, Math.round(100 * (total - calls) / total));
  }
  return 50; // icebreaker: flat (no call-speed metric)
}

function validateWin(card, marks) {
  const m = marks.map(row => row.slice()); m[2][2] = true;
  const rowFull = r => m[r].every(Boolean);
  const colFull = c => [0, 1, 2, 3, 4].every(r => m[r][c]);
  if (meta.win === "line") {
    for (let i = 0; i < 5; i++) if (rowFull(i) || colFull(i)) return true;
    if ([0, 1, 2, 3, 4].every(i => m[i][i])) return true;
    if ([0, 1, 2, 3, 4].every(i => m[i][4 - i])) return true;
    return false;
  }
  if (meta.win === "corners") return m[0][0] && m[0][4] && m[4][0] && m[4][4];
  return m.every(row => row.every(Boolean)); // blackout
}
// closest progress toward the active pattern (for the host dashboard)
function patternProgress(card, marks) {
  const m = marks.map(row => row.slice()); m[2][2] = true;
  if (meta.win === "corners") {
    const done = [m[0][0], m[0][4], m[4][0], m[4][4]].filter(Boolean).length;
    return { done, need: 4, label: "corners" };
  }
  if (meta.win === "blackout") {
    let done = 0; for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) if (m[r][c]) done++;
    return { done, need: 25, label: "squares" };
  }
  // line: best row/col/diagonal
  let best = 0;
  for (let i = 0; i < 5; i++) {
    best = Math.max(best, m[i].filter(Boolean).length);
    best = Math.max(best, [0, 1, 2, 3, 4].filter(r => m[r][i]).length);
  }
  best = Math.max(best, [0, 1, 2, 3, 4].filter(i => m[i][i]).length);
  best = Math.max(best, [0, 1, 2, 3, 4].filter(i => m[i][4 - i]).length);
  return { done: best, need: 5, label: "line" };
}

// ---- win screen -----------------------------------------------------------
function renderWinners() {
  const w = (meta && meta.winners) || {};
  const arr = Object.values(w);
  $("win-sub").textContent = arr.length > 1 ? `${arr.length} winners!` : "Winner";
  $("win-title").textContent = arr.length > 1 ? "Bingo x" + arr.length + "!" : "Bingo!";
  $("win-list").innerHTML = arr.map(x =>
    `<li><span class="w-name">${esc(x.name || "Someone")}</span>` +
    `${x.cardNo ? `<span class="w-card">Card #${esc(x.cardNo)}</span>` : ""}` +
    `<span class="w-pts">+${esc(x.points || 0)}</span></li>`).join("") || "<li>-</li>";
}

// ---- misc -----------------------------------------------------------------
$("btn-copy").addEventListener("click", async () => {
  const url = `${location.origin}${location.pathname}?room=${ROOM}`;
  try { await navigator.clipboard.writeText(url); $("btn-copy").textContent = "Copied!"; } catch { prompt("Invite link:", url); }
  setTimeout(() => ($("btn-copy").textContent = "Copy invite link"), 1500);
});
$("btn-mute").addEventListener("click", () => { $("btn-mute").textContent = Sound.toggle() ? "🔇" : "🔊"; });
$("btn-mute").textContent = Sound.isMuted() ? "🔇" : "🔊";
$("btn-home").addEventListener("click", () => { location.href = "../"; });
$("btn-leave").addEventListener("click", () => { location.href = "../"; });
async function leave() { if (ROOM && ME) { try { await update(ref(db, `bingo/${ROOM}/players/${ME}`), { connected: false }); } catch {} } detach(); ROOM = null; IS_HOST = false; meta = null; players = {}; myCard = null; myMarks = null; poolCache = null; show("screen-join"); }

// ---- feedback (writes to shared /feedback, tagged Bingo) -------------------
let fbRating = 0;
const openFb = () => { $("feedback-modal").style.display = "flex"; $("fb-form").style.display = "block"; $("fb-thanks").style.display = "none"; };
const closeFb = () => { $("feedback-modal").style.display = "none"; };
["btn-feedback", "btn-feedback-end"].forEach(id => { const el = $(id); if (el) el.addEventListener("click", openFb); });
$("fb-close").addEventListener("click", closeFb);
$("feedback-modal").addEventListener("click", e => { if (e.target.id === "feedback-modal") closeFb(); });
document.querySelectorAll("#fb-stars span").forEach(s => s.addEventListener("click", () => { fbRating = Number(s.dataset.v); document.querySelectorAll("#fb-stars span").forEach(x => x.classList.toggle("on", Number(x.dataset.v) <= fbRating)); }));
$("fb-send").addEventListener("click", async () => {
  const comment = $("fb-comment").value.trim(); if (!fbRating && !comment) return;
  try {
    await push(ref(db, "feedback/" + (ROOM || "bingo")), {
      game: "Bingo", name: (players[ME] && players[ME].name) || "", rating: fbRating || "", comment,
      gameDate: new Date((meta && meta.createdAt) || Date.now()).toISOString().slice(0, 10), ts: Date.now(),
    });
  } catch (e) {}
  $("fb-form").style.display = "none"; $("fb-thanks").style.display = "block";
  fbRating = 0; $("fb-comment").value = ""; document.querySelectorAll("#fb-stars span").forEach(x => x.classList.remove("on"));
  setTimeout(closeFb, 1800);
});

// deep link ?room=CODE
const params = new URLSearchParams(location.search);
if (params.get("room")) $("join-code").value = params.get("room").toUpperCase();
