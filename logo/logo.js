// ===========================================================================
// LS Guess-the-Logo — logo.js
// Host-run brand-recognition game. A logo is revealed in 4 zoom stages; the
// first player to type the correct brand during a stage wins that stage's
// points. Only the HOST loads logo-content.js (answers + domains), so answers
// stay off players' devices. Logo images come live from logo.dev.
// Data under logo/{code}/ ; scores under lb/{scope}/{eid} (shared leaderboard).
// ===========================================================================
import { auth, db } from "../common/firebase-config.js";
import { EID_RE } from "../common/eid.js";
import { addToLeaderboard } from "../common/leaderboard.js";
import { Music } from "../common/music.js";
import { signInAnonymously, onAuthStateChanged } from
  "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  ref, set, update, get, onValue, push, remove, onDisconnect, off, runTransaction
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

const $ = (id) => document.getElementById(id);
const show = (s) => { document.querySelectorAll(".screen").forEach(x => x.classList.remove("active")); $(s).classList.add("active"); };
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// stage config (spec): points 10/5/2/1, timing 10/8/8/5s, zoom scale per stage
const STAGE_POINTS = [100, 60, 30, 10];
const STAGE_SECS = [10, 8, 8, 5];
const STAGE_SCALE = [14, 7, 3, 1];

// ---- sound ----------------------------------------------------------------
const Sound = (() => {
  let ctx, muted = localStorage.getItem("logo_muted") === "1";
  const ensure = () => { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch {} } if (ctx && ctx.state === "suspended") ctx.resume(); };
  const beep = (f, s, d, t = "sine", g = 0.12) => { if (muted || !ctx) return; const o = ctx.createOscillator(), gn = ctx.createGain(); o.type = t; o.frequency.value = f; o.connect(gn); gn.connect(ctx.destination); const at = ctx.currentTime + s; gn.gain.setValueAtTime(0.0001, at); gn.gain.linearRampToValueAtTime(g, at + .012); gn.gain.exponentialRampToValueAtTime(.0001, at + d); o.start(at); o.stop(at + d + .03); };
  const seq = (n) => { ensure(); n.forEach(x => beep(x.f, x.t, x.d, x.type, x.g)); };
  return {
    ensure, toggle() { muted = !muted; localStorage.setItem("logo_muted", muted ? "1" : "0"); return muted; }, isMuted() { return muted; },
    round() { seq([{ f: 620, t: 0, d: .1 }, { f: 820, t: .08, d: .1 }]); },
    tap() { seq([{ f: 520, t: 0, d: .05, g: .09 }]); },
    win() { seq([{ f: 660, t: 0, d: .1 }, { f: 990, t: .1, d: .18 }]); },
    zoom() { seq([{ f: 440, t: 0, d: .08, g: .07 }]); },
    end() { seq([{ f: 523, t: 0, d: .13 }, { f: 659, t: .12, d: .13 }, { f: 784, t: .24, d: .13 }, { f: 1046, t: .36, d: .3 }]); },
  };
})();
document.addEventListener("click", () => Sound.ensure(), { once: true });

// ---- state ----------------------------------------------------------------
let ME, ROOM, IS_HOST = false, meta = null, players = {}, listeners = [];
let hostTimer = null, resolving = false, finalizing = false;
let LOGOS = null, CATEGORIES = null, logoUrl = null, contentLoaded = false; // host-only
let lastLogoId = "", lastStage = 0, soundState = "";
let chat = {}, guesses = {}, processed = new Set(), awarded = new Set();

// ---- auth -----------------------------------------------------------------
onAuthStateChanged(auth, (u) => { if (u) { ME = u.uid; offerRejoin(); } });
signInAnonymously(auth).catch((e) => { $("join-error").textContent = "Couldn't connect to the server. (" + e.code + ")"; });

function getEid() { const raw = ($("eid").value || "").trim().toUpperCase(); if (!EID_RE.test(raw)) { $("join-error").textContent = "Enter a valid Employee ID to play."; return null; } return raw; }
function getName() { const n = ($("name").value || "").trim(); if (!n) $("join-error").textContent = "Enter your name first."; return n; }

// ---- content (host only) --------------------------------------------------
async function loadContent() {
  if (contentLoaded) return true;
  try { const m = await import("./logo-content.js?v=1"); LOGOS = m.LOGOS; CATEGORIES = m.CATEGORIES; logoUrl = m.logoUrl; contentLoaded = true; return true; }
  catch (e) { alert("Could not load the brand bank."); return false; }
}
function poolForCategory(category) {
  const ids = [];
  LOGOS.forEach((l, i) => { if (!category || category === "mixed" || l.category === category) ids.push(String(i)); });
  return ids;
}
function lookupLogo(id) { const l = LOGOS[Number(id)]; return l ? { ...l, id: String(id) } : null; }
function isCorrect(text, logo) { const g = norm(text); if (!g) return false; if (g === norm(logo.answer)) return true; return (logo.accept || []).some(a => norm(a) === g); }

// ---- create / join --------------------------------------------------------
$("btn-create").addEventListener("click", async () => {
  const name = getName(); if (!name) return; const eid = getEid(); if (!eid) return;
  const code = Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
  try {
    await set(ref(db, `logo/${code}/meta`), {
      hostUid: ME, category: $("opt-cat").value, count: Number($("opt-count").value),
      state: "lobby", qIndex: -1, stage: 1, currentLogo: null, winner: null, reveal: false,
      usedIds: [], createdAt: Date.now(),
    });
    await joinRoom(code, name, eid);
  } catch (e) { $("join-error").textContent = "Could not create the game (" + (e.code || e.message) + ")."; }
});
$("btn-join").addEventListener("click", async () => {
  const name = getName(); if (!name) return; const eid = getEid(); if (!eid) return;
  const code = ($("join-code").value || "").trim().toUpperCase();
  if (code.length !== 4) { $("join-error").textContent = "Enter the 4-letter room code."; return; }
  const snap = await get(ref(db, `logo/${code}/meta`));
  if (!snap.exists()) { $("join-error").textContent = "No game found with that code."; return; }
  await joinRoom(code, name, eid);
});
async function joinRoom(code, name, eid) {
  $("join-error").textContent = ""; ROOM = code;
  const pRef = ref(db, `logo/${code}/players/${ME}`);
  const existing = await get(pRef);
  const metaSnap = await get(ref(db, `logo/${code}/meta`));
  IS_HOST = metaSnap.val().hostUid === ME;
  await update(pRef, { name, eid, connected: true, isHost: IS_HOST, score: existing.exists() ? (existing.val().score || 0) : 0, joinedAt: existing.exists() ? existing.val().joinedAt : Date.now() });
  onDisconnect(pRef).update({ connected: false });
  localStorage.setItem("logo_last", JSON.stringify({ code, name, eid }));
  if (IS_HOST) await loadContent();
  attachListeners(code);
}
async function offerRejoin() {
  try {
    const last = JSON.parse(localStorage.getItem("logo_last") || "null"); if (!last) return;
    const snap = await get(ref(db, `logo/${last.code}/meta`)); if (!snap.exists()) { localStorage.removeItem("logo_last"); return; }
    const h = $("rejoin-hint"); h.style.display = "block"; h.innerHTML = `Rejoin game <b>${esc(last.code)}</b> as <b>${esc(last.name)}</b>? `;
    const b = document.createElement("button"); b.className = "btn-ghost mini"; b.textContent = "Rejoin";
    b.onclick = () => { $("name").value = last.name; if (last.eid) $("eid").value = last.eid; joinRoom(last.code, last.name, last.eid); }; h.appendChild(b);
  } catch {}
}

// ---- listeners ------------------------------------------------------------
function attachListeners(code) {
  detach();
  const m = ref(db, `logo/${code}/meta`); onValue(m, s => { meta = s.val(); if (meta) { IS_HOST = meta.hostUid === ME; onMeta(); } }); listeners.push(m);
  const p = ref(db, `logo/${code}/players`); onValue(p, s => { players = s.val() || {}; onPlayers(); }); listeners.push(p);
  const c = ref(db, `logo/${code}/chat`); onValue(c, s => { chat = s.val() || {}; renderChat(); }); listeners.push(c);
  const gq = ref(db, `logo/${code}/guesses`); onValue(gq, s => { guesses = s.val() || {}; if (IS_HOST) processGuesses(); }); listeners.push(gq);
}
function detach() { listeners.forEach(r => off(r)); listeners = []; stopHostTimer(); }
function stopHostTimer() { if (hostTimer) { clearInterval(hostTimer); hostTimer = null; } }

// ---- meta / render --------------------------------------------------------
function onMeta() {
  if (!meta) return;
  if (meta.state === "lobby") {
    show("screen-lobby"); $("lobby-code").textContent = ROOM; $("lobby-sub").textContent = lobbyLabel();
    renderHowto(); $("btn-start").style.display = IS_HOST ? "block" : "none"; $("lobby-hint").style.display = IS_HOST ? "none" : "block";
    renderLobbyPlayers();
  } else if (meta.state === "done") {
    show("screen-done"); renderScoreboard($("done-board"), true);
    $("btn-again").style.display = IS_HOST ? "block" : "none"; $("done-hint").textContent = IS_HOST ? "" : "Waiting for the host…";
    if (soundState !== "done") { soundState = "done"; Sound.end(); }
  } else {
    show("screen-game");
    const lg = meta.currentLogo;
    if (lg && lg.id !== lastLogoId) { lastLogoId = lg.id; lastStage = 0; if (!IS_HOST) Sound.round(); }
    if (meta.state === "playing" && meta.stage !== lastStage) { lastStage = meta.stage; if (meta.stage > 1 && !IS_HOST) Sound.zoom(); }
    renderGame();
  }
  if (IS_HOST && meta.state === "playing") startHostTimer(); else stopHostTimer();
  if (meta.state === "playing" || meta.state === "revealed") Music.start(); else Music.stop();
}
function onPlayers() {
  if (!meta) return;
  if (meta.state === "lobby") renderLobbyPlayers();
}

const lobbyLabel = () => { const ct = meta.category === "mixed" ? "Mixed categories" : meta.category; return `${ct} · ${meta.count} logos`; };
function renderHowto() {
  $("howto-list").innerHTML = [
    "The host reveals a logo, zoomed way in. It zooms out in stages, getting easier.",
    "Type the brand name fast — the earlier you nail it, the more points (10 → 5 → 2 → 1).",
    "First correct answer wins the round; then the full logo shows and the next one loads.",
    "Highest total after all logos wins. Points also feed the games leaderboard.",
  ].map(t => `<li>${esc(t)}</li>`).join("");
}
function renderLobbyPlayers() {
  const ll = $("lobby-players"); if (!ll) return;
  const e = Object.entries(players);
  ll.innerHTML = e.map(([, p]) => `<li><span class="dot ${p.connected ? "" : "off"}"></span><span>${esc(p.name)}</span>${p.isHost ? '<span class="badge">HOST</span>' : ""}</li>`).join("");
  $("lobby-count").textContent = `${e.length} player${e.length !== 1 ? "s" : ""}`;
}

function renderGame() {
  const lg = meta.currentLogo; const revealed = meta.state === "revealed";
  $("q-progress").textContent = `Logo ${(meta.qIndex || 0) + 1} / ${meta.count}`;
  $("q-category").textContent = lg ? lg.category : "";
  // zoom viewport
  const img = $("logo-img");
  if (lg) { if (img.getAttribute("src") !== lg.url) img.setAttribute("src", lg.url); }
  const scale = revealed ? 1 : STAGE_SCALE[(meta.stage || 1) - 1];
  img.style.transform = `scale(${scale})`;
  // stage/points indicator
  const stageIdx = (meta.stage || 1) - 1;
  $("stage-info").textContent = revealed ? "Full logo" : `Stage ${meta.stage} · worth ${STAGE_POINTS[stageIdx]} pts`;
  // countdown (playing)
  const cd = $("countdown");
  if (lg && meta.state === "playing" && meta.stageEndsAt) { const left = Math.max(0, Math.ceil((meta.stageEndsAt - Date.now()) / 1000)); cd.textContent = left + "s"; cd.style.display = "block"; }
  else cd.style.display = "none";
  // host vs player controls
  $("host-controls").style.display = IS_HOST ? "flex" : "none";
  renderChat();
  $("answer-row").style.display = (!IS_HOST && meta.state === "playing") ? "flex" : "none";
  // host answer helper
  $("host-answer").style.display = IS_HOST ? "block" : "none";
  if (IS_HOST && lg) { const full = lookupLogo(lg.id); $("host-answer").textContent = full ? `Answer: ${full.answer}` : ""; }
  // status / winner banner
  let msg = "";
  if (revealed) {
    const answer = meta.revealAnswer || (IS_HOST && lg ? (lookupLogo(lg.id) || {}).answer : "") || "";
    const scorers = Object.entries(players).filter(([uid, p]) => p && uid !== meta.hostUid && p.scoredId === lg.id);
    if (!IS_HOST && players[ME] && players[ME].scoredId === lg.id) msg = `✅ You got it! — ${answer}`;
    else if (scorers.length) msg = `${scorers.length} ${scorers.length === 1 ? "player" : "players"} got it — ${answer}`;
    else msg = `Nobody got it — ${answer}`;
    if (soundState !== "rev" + lg.id) { soundState = "rev" + lg.id; Sound.win(); }
  } else if (!IS_HOST) { msg = "Type the brand and hit Guess!"; }
  else { msg = "Players are guessing…"; }
  $("status-line").textContent = msg;
  // reveal scoreboard
  if (revealed) { $("mini-board").style.display = "block"; renderScoreboard($("mini-board"), false); } else $("mini-board").style.display = "none";
  // host buttons
  if (IS_HOST) { $("btn-zoom").style.display = meta.state === "playing" ? "inline-block" : "none"; $("btn-next").style.display = revealed ? "inline-block" : "none"; $("btn-next").textContent = ((meta.qIndex || 0) + 1 >= meta.count) ? "See results \u2192" : "Next logo"; }
}
function renderScoreboard(el, big) {
  const rows = Object.entries(players).filter(([uid, p]) => p && uid !== meta.hostUid).map(([, p]) => p).sort((a, b) => (b.score || 0) - (a.score || 0));
  const medals = ["🥇", "🥈", "🥉"];
  el.innerHTML = rows.map((p, i) => `<div class="sb-row ${big && i === 0 ? "sb-top" : ""}"><span class="sb-rank">${i < 3 ? medals[i] : i + 1}</span><span class="sb-name">${esc(p.name)}</span><span class="sb-pts">${p.score || 0}</span></div>`).join("") || `<div class="dash-empty">No scores.</div>`;
}

// ---- player: submit a guess -----------------------------------------------
$("answer-send").addEventListener("click", submitGuess);
$("answer-input").addEventListener("keydown", (e) => { if (e.key === "Enter") submitGuess(); });
function renderChat() {
  const log = $("chat-log"); if (!log) return;
  const entries = Object.values(chat || {}).sort((a, b) => (a.ts || 0) - (b.ts || 0));
  log.innerHTML = entries.map(e => {
    if (e.system) return `<div class="cmsg sys">${esc(e.text)}</div>`;
    if (e.kind === "got") return `<div class="cmsg win">\u2705 ${esc(e.text)}</div>`;
    return `<div class="cmsg"><span class="cwho">${esc(e.name)}:</span> ${esc(e.text)}</div>`;
  }).join("") || `<div class="cmsg sys">Guesses show up here — the earlier you're right, the more points!</div>`;
  log.scrollTop = log.scrollHeight;
}

function submitGuess() {
  if (IS_HOST || !meta || meta.state !== "playing" || !meta.currentLogo) return;
  const text = ($("answer-input").value || "").trim(); if (!text) return;
  Sound.tap();
  push(ref(db, `logo/${ROOM}/guesses`), { uid: ME, name: (players[ME] && players[ME].name) || "?", text, id: meta.currentLogo.id, ts: Date.now() });
  $("answer-input").value = "";
}

// ---- host: flow -----------------------------------------------------------
$("btn-start").addEventListener("click", async () => {
  if (!IS_HOST) return;
  const nonHost = Object.entries(players).filter(([uid, p]) => p.connected && uid !== meta.hostUid).length;
  if (nonHost < 1) { alert("Need at least 1 player (besides the host) to start."); return; }
  if (!(await loadContent())) return;
  finalizing = false;
  const resets = {}; Object.keys(players).forEach(uid => { if (uid !== meta.hostUid) { resets[`logo/${ROOM}/players/${uid}/score`] = 0; resets[`logo/${ROOM}/players/${uid}/scoredId`] = null; } });
  if (Object.keys(resets).length) await update(ref(db), resets);
  try { await remove(ref(db, `logo/${ROOM}/chat`)); } catch (e) {}
  try { await remove(ref(db, `logo/${ROOM}/guesses`)); } catch (e) {}
  await drawNext(true);
});
$("btn-zoom").addEventListener("click", () => { if (IS_HOST) advanceStage(true); });
$("btn-next").addEventListener("click", () => { if (IS_HOST) nextRound(); });
$("btn-again").addEventListener("click", async () => {
  if (!IS_HOST) return; if (!(await loadContent())) return; finalizing = false;
  const resets = {}; Object.keys(players).forEach(uid => { if (uid !== meta.hostUid) { resets[`logo/${ROOM}/players/${uid}/score`] = 0; resets[`logo/${ROOM}/players/${uid}/scoredId`] = null; } });
  resets[`logo/${ROOM}/meta/qIndex`] = -1; await update(ref(db), resets);
  try { await remove(ref(db, `logo/${ROOM}/chat`)); } catch (e) {}
  try { await remove(ref(db, `logo/${ROOM}/guesses`)); } catch (e) {}
  await drawNext(true);
});

function usedList() { const u = meta && meta.usedIds; return Array.isArray(u) ? u.slice() : (u ? Object.values(u) : []); }
async function drawNext(first) {
  resolving = false; processed = new Set(); awarded = new Set();
  const pool = poolForCategory(meta.category);
  let used = usedList();
  let avail = pool.filter((id) => !used.includes(id));
  if (avail.length === 0) { used = []; avail = pool.slice(); }
  const id = avail[Math.floor(Math.random() * avail.length)];
  used.push(id);
  const full = lookupLogo(id);
  const qIndex = first ? 0 : (meta.qIndex || 0) + 1;
  const now = Date.now();
  await update(ref(db, `logo/${ROOM}/meta`), {
    state: "playing", qIndex, usedIds: used, reveal: false, revealAnswer: null,
    stage: 1, stageEndsAt: now + STAGE_SECS[0] * 1000,
    currentLogo: { id, url: logoUrl(full.domain), category: full.cat || full.category },
  });
  try { await remove(ref(db, `logo/${ROOM}/guesses`)); } catch (e) {}
  try { await push(ref(db, `logo/${ROOM}/chat`), { system: true, text: `\u2014 Round ${qIndex + 1} \u2014`, ts: Date.now() }); } catch (e) {}
}
function startHostTimer() { if (hostTimer) return; hostTimer = setInterval(() => {
  if (!IS_HOST || !meta || meta.state !== "playing") return;
  renderGame();
  if (meta.stageEndsAt && Date.now() >= meta.stageEndsAt) advanceStage(false);
}, 400); }
async function advanceStage(manual) {
  if (!IS_HOST || !meta || meta.state !== "playing") return;
  const s = meta.stage || 1;
  if (s >= 4) { await revealRound(); return; }   // out of stages -> reveal
  const now = Date.now();
  await update(ref(db, `logo/${ROOM}/meta`), { stage: s + 1, stageEndsAt: now + STAGE_SECS[s] * 1000 });
}
async function processGuesses() {
  if (!IS_HOST || !meta || meta.state !== "playing" || !meta.currentLogo) return;
  const full = lookupLogo(meta.currentLogo.id); if (!full) return;
  const id = meta.currentLogo.id;
  const pending = Object.entries(guesses || {})
    .filter(([k, e]) => e && !processed.has(k) && e.id === id && e.uid && e.uid !== meta.hostUid)
    .sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
  if (pending.length) {
    const pts = STAGE_POINTS[(meta.stage || 1) - 1];
    const updates = {};
    for (const [k, e] of pending) {
      processed.add(k);
      const pl = players[e.uid] || {};
      if (isCorrect(e.text, full)) {
        if (awarded.has(e.uid) || pl.scoredId === id) continue;   // one score per player per round
        awarded.add(e.uid);
        updates[`logo/${ROOM}/players/${e.uid}/score`] = (pl.score || 0) + pts;
        updates[`logo/${ROOM}/players/${e.uid}/scoredId`] = id;
        const ck = push(ref(db, `logo/${ROOM}/chat`)).key;
        updates[`logo/${ROOM}/chat/${ck}`] = { kind: "got", uid: e.uid, name: e.name, text: `${e.name} got it! (+${pts})`, ts: e.ts || Date.now() };
      } else {
        const ck = push(ref(db, `logo/${ROOM}/chat`)).key;
        updates[`logo/${ROOM}/chat/${ck}`] = { kind: "guess", uid: e.uid, name: e.name, text: String(e.text).slice(0, 60), ts: e.ts || Date.now() };
      }
    }
    if (Object.keys(updates).length) { try { await update(ref(db), updates); } catch (e) {} }
  }
  // everyone connected has scored -> reveal early
  const conn = Object.entries(players).filter(([uid, p]) => p && p.connected && uid !== meta.hostUid);
  if (conn.length && conn.every(([uid, p]) => awarded.has(uid) || p.scoredId === id)) revealRound();
}
async function revealRound() {
  if (resolving) return; resolving = true; stopHostTimer();
  const full = lookupLogo(meta.currentLogo.id);
  await update(ref(db, `logo/${ROOM}/meta`), { state: "revealed", reveal: true, revealAnswer: full ? full.answer : null });
}
async function nextRound() {
  if (!IS_HOST || !meta) return;
  if ((meta.qIndex || 0) + 1 >= meta.count) { await finalize(); return; }
  await drawNext(false);
}
async function finalize() {
  if (finalizing) return; finalizing = true;
  await update(ref(db, `logo/${ROOM}/meta`), { state: "done" });
  const scorers = Object.entries(players).filter(([uid, p]) => p && uid !== meta.hostUid);
  const top = Math.max(0, ...scorers.map(([, p]) => p.score || 0));
  for (const [, p] of scorers) { if (!p.eid) continue; try { await addToLeaderboard(p.eid, p.name, "logos", p.score || 0, top > 0 && (p.score || 0) === top); } catch (e) {} }
}

// ---- feedback -------------------------------------------------------------
let fbRating = 0;
const openFb = () => { $("feedback-modal").style.display = "flex"; $("fb-form").style.display = "block"; $("fb-thanks").style.display = "none"; };
const closeFb = () => { $("feedback-modal").style.display = "none"; };
["btn-feedback", "btn-feedback-end"].forEach(id => { const el = $(id); if (el) el.addEventListener("click", openFb); });
$("fb-close").addEventListener("click", closeFb);
$("feedback-modal").addEventListener("click", e => { if (e.target.id === "feedback-modal") closeFb(); });
document.querySelectorAll("#fb-stars span").forEach(s => s.addEventListener("click", () => { fbRating = Number(s.dataset.v); document.querySelectorAll("#fb-stars span").forEach(x => x.classList.toggle("on", Number(x.dataset.v) <= fbRating)); }));
$("fb-send").addEventListener("click", async () => {
  const comment = $("fb-comment").value.trim(); if (!fbRating && !comment) return;
  try { await push(ref(db, "feedback/" + (ROOM || "logo")), { game: "Logo", name: (players[ME] && players[ME].name) || "", rating: fbRating || "", comment, gameDate: new Date((meta && meta.createdAt) || Date.now()).toISOString().slice(0, 10), ts: Date.now() }); } catch (e) {}
  $("fb-form").style.display = "none"; $("fb-thanks").style.display = "block"; fbRating = 0; $("fb-comment").value = ""; document.querySelectorAll("#fb-stars span").forEach(x => x.classList.remove("on"));
  setTimeout(closeFb, 1800);
});

// ---- misc -----------------------------------------------------------------
$("btn-copy").addEventListener("click", async () => { const url = `${location.origin}${location.pathname}?room=${ROOM}`; try { await navigator.clipboard.writeText(url); $("btn-copy").textContent = "Copied!"; } catch { prompt("Invite link:", url); } setTimeout(() => ($("btn-copy").textContent = "Copy invite link"), 1500); });
$("btn-mute").addEventListener("click", () => { $("btn-mute").textContent = Sound.toggle() ? "🔇" : "🔊"; });
$("btn-music").addEventListener("click", () => { $("btn-music").style.opacity = Music.toggle() ? "0.4" : "1"; });
$("btn-music").style.opacity = Music.isMuted() ? "0.4" : "1";
$("btn-mute").textContent = Sound.isMuted() ? "🔇" : "🔊";
$("btn-leave").addEventListener("click", () => { location.href = "../"; });

const params = new URLSearchParams(location.search);
if (params.get("room")) $("join-code").value = params.get("room").toUpperCase();
