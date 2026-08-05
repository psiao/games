// ===========================================================================
// LS "Are You Smarter Than a School Grader?" — grader.js
// A quiz that CLIMBS grades 1->5, rotating school subjects each round.
// Everyone answers on their device; faster correct answers score more.
// At the end each player gets a report card ("as smart as a Nth grader").
// Only the HOST loads grader-content.js, so answers stay off players' devices.
// Data under grader/{code}/ ; scores under lb/{scope}/{eid} (shared leaderboard).
// ===========================================================================
import { auth, db } from "../common/firebase-config.js";
import { EID_RE } from "../common/eid.js";
import { addToLeaderboard } from "../common/leaderboard.js";
import { signInAnonymously, onAuthStateChanged } from
  "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  ref, set, update, get, onValue, push, remove, onDisconnect, off, runTransaction
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

const $ = (id) => document.getElementById(id);
const show = (s) => { document.querySelectorAll(".screen").forEach(x => x.classList.remove("active")); $(s).classList.add("active"); };
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const MAX_GRADE = 5;

// ---- sound ----------------------------------------------------------------
const Sound = (() => {
  let ctx, muted = localStorage.getItem("grader_muted") === "1";
  const ensure = () => { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch {} } if (ctx && ctx.state === "suspended") ctx.resume(); };
  const beep = (f, s, d, t = "sine", g = 0.12) => { if (muted || !ctx) return; const o = ctx.createOscillator(), gn = ctx.createGain(); o.type = t; o.frequency.value = f; o.connect(gn); gn.connect(ctx.destination); const at = ctx.currentTime + s; gn.gain.setValueAtTime(0.0001, at); gn.gain.linearRampToValueAtTime(g, at + .012); gn.gain.exponentialRampToValueAtTime(.0001, at + d); o.start(at); o.stop(at + d + .03); };
  const seq = (n) => { ensure(); n.forEach(x => beep(x.f, x.t, x.d, x.type, x.g)); };
  return {
    ensure, toggle() { muted = !muted; localStorage.setItem("grader_muted", muted ? "1" : "0"); return muted; }, isMuted() { return muted; },
    q() { seq([{ f: 620, t: 0, d: .1 }, { f: 820, t: .08, d: .1 }]); },
    tap() { seq([{ f: 520, t: 0, d: .05, g: .09 }]); },
    right() { seq([{ f: 660, t: 0, d: .1 }, { f: 990, t: .1, d: .16 }]); },
    wrong() { seq([{ f: 300, t: 0, d: .18, type: "sawtooth", g: .08 }]); },
    tick() { seq([{ f: 880, t: 0, d: .04, g: .05 }]); },
    end() { seq([{ f: 523, t: 0, d: .13 }, { f: 659, t: .12, d: .13 }, { f: 784, t: .24, d: .13 }, { f: 1046, t: .36, d: .3 }]); },
  };
})();
document.addEventListener("click", () => Sound.ensure(), { once: true });

// ---- state ----------------------------------------------------------------
let ME, ROOM, IS_HOST = false, meta = null, players = {}, listeners = [];
let myAnswer = null, hostTimer = null, revealing = false, finalizing = false;
let QUESTIONS = null, SUBJECTS = null, GRADE_LABEL = null, contentLoaded = false; // host-only
let lastQid = "", soundState = "";

onAuthStateChanged(auth, (u) => { if (u) { ME = u.uid; offerRejoin(); } });
signInAnonymously(auth).catch((e) => { $("join-error").textContent = "Couldn't connect to the server. (" + e.code + ")"; });

function getEid() { const raw = ($("eid").value || "").trim().toUpperCase(); if (!EID_RE.test(raw)) { $("join-error").textContent = "Enter a valid Employee ID to play."; return null; } return raw; }
function getName() { const n = ($("name").value || "").trim(); if (!n) $("join-error").textContent = "Enter your name first."; return n; }

// ---- content (host only) --------------------------------------------------
async function loadContent() {
  if (contentLoaded) return true;
  try { const m = await import("./grader-content.js?v=1"); QUESTIONS = m.QUESTIONS; SUBJECTS = m.SUBJECTS; GRADE_LABEL = m.GRADE_LABEL; contentLoaded = true; return true; }
  catch (e) { alert("Could not load the question bank."); return false; }
}
// ladder: qIndex -> which grade & subject (climbs grades, rotates subjects)
function ladderAt(qIndex, perGrade) {
  const grade = Math.min(MAX_GRADE, Math.floor(qIndex / perGrade) + 1);
  const subject = SUBJECTS[qIndex % SUBJECTS.length];
  return { grade, subject };
}
function poolFor(grade, subject) { const arr = (QUESTIONS[grade] && QUESTIONS[grade][subject]) || []; return arr.map((_, i) => grade + "|" + subject + "|" + i); }
function lookupQ(qid) { const [g, s, i] = qid.split("|"); const arr = QUESTIONS[g] && QUESTIONS[g][s]; return (arr && arr[Number(i)]) ? { ...arr[Number(i)], grade: g, subject: s, qid } : null; }
function pickN(arr, n) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); }

// ---- leaderboard signature reused via shared module -----------------------

// ---- create / join --------------------------------------------------------
$("btn-create").addEventListener("click", async () => {
  const name = getName(); if (!name) return; const eid = getEid(); if (!eid) return;
  const perGrade = Number($("opt-count").value);
  const code = Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
  try {
    await set(ref(db, `grader/${code}/meta`), {
      hostUid: ME, perGrade, count: MAX_GRADE * perGrade, questionSeconds: Number($("opt-time").value),
      state: "lobby", qIndex: -1, currentQ: null, reveal: null, usedQ: [], createdAt: Date.now(),
    });
    await joinRoom(code, name, eid);
  } catch (e) { $("join-error").textContent = "Could not create the game (" + (e.code || e.message) + ")."; }
});
$("btn-join").addEventListener("click", async () => {
  const name = getName(); if (!name) return; const eid = getEid(); if (!eid) return;
  const code = ($("join-code").value || "").trim().toUpperCase();
  if (code.length !== 4) { $("join-error").textContent = "Enter the 4-letter room code."; return; }
  const snap = await get(ref(db, `grader/${code}/meta`));
  if (!snap.exists()) { $("join-error").textContent = "No game found with that code."; return; }
  await joinRoom(code, name, eid);
});
async function joinRoom(code, name, eid) {
  $("join-error").textContent = ""; ROOM = code;
  const pRef = ref(db, `grader/${code}/players/${ME}`);
  const existing = await get(pRef);
  const metaSnap = await get(ref(db, `grader/${code}/meta`));
  IS_HOST = metaSnap.val().hostUid === ME;
  await update(pRef, { name, eid, connected: true, isHost: IS_HOST, score: existing.exists() ? (existing.val().score || 0) : 0, correct: existing.exists() ? (existing.val().correct || 0) : 0, joinedAt: existing.exists() ? existing.val().joinedAt : Date.now() });
  onDisconnect(pRef).update({ connected: false });
  localStorage.setItem("grader_last", JSON.stringify({ code, name, eid }));
  if (IS_HOST) await loadContent();
  attachListeners(code);
}
async function offerRejoin() {
  try {
    const last = JSON.parse(localStorage.getItem("grader_last") || "null"); if (!last) return;
    const snap = await get(ref(db, `grader/${last.code}/meta`)); if (!snap.exists()) { localStorage.removeItem("grader_last"); return; }
    const h = $("rejoin-hint"); h.style.display = "block"; h.innerHTML = `Rejoin game <b>${esc(last.code)}</b> as <b>${esc(last.name)}</b>? `;
    const b = document.createElement("button"); b.className = "btn-ghost mini"; b.textContent = "Rejoin";
    b.onclick = () => { $("name").value = last.name; if (last.eid) $("eid").value = last.eid; joinRoom(last.code, last.name, last.eid); }; h.appendChild(b);
  } catch {}
}

// ---- listeners ------------------------------------------------------------
function attachListeners(code) {
  detach();
  const m = ref(db, `grader/${code}/meta`); onValue(m, s => { meta = s.val(); if (meta) { IS_HOST = meta.hostUid === ME; onMeta(); } }); listeners.push(m);
  const p = ref(db, `grader/${code}/players`); onValue(p, s => { players = s.val() || {}; onPlayers(); }); listeners.push(p);
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
    show("screen-done"); renderReportCards(); renderScoreboard($("done-board"), true);
    $("btn-again").style.display = IS_HOST ? "block" : "none"; $("done-hint").textContent = IS_HOST ? "" : "Waiting for the host…";
    if (soundState !== "done") { soundState = "done"; Sound.end(); }
  } else {
    show("screen-game");
    if (meta.state === "playing" && meta.currentQ && meta.currentQ.qid !== lastQid) { lastQid = meta.currentQ.qid; myAnswer = null; if (!IS_HOST) Sound.q(); soundState = ""; }
    renderGame();
  }
  if (IS_HOST && meta.state === "playing") startHostTimer(); else stopHostTimer();
}
function onPlayers() {
  if (!meta) return;
  if (meta.state === "lobby") renderLobbyPlayers();
  if ((meta.state === "playing" || meta.state === "reveal") && IS_HOST) renderHostDash();
  if (IS_HOST && meta.state === "playing") checkAllAnswered();
}

const lobbyLabel = () => `Climb Grade 1 → ${MAX_GRADE} · ${meta.count} questions`;
function renderHowto() {
  $("howto-list").innerHTML = [
    "Questions climb from Grade 1 up to Grade 5, switching school subjects each round.",
    "Everyone answers on their own device — the faster you're right, the more points.",
    "After each question the answer is revealed with the running scoreboard.",
    "At the end you get a report card: how smart ARE you, really? Points feed the leaderboard.",
  ].map(t => `<li>${esc(t)}</li>`).join("");
}
function renderLobbyPlayers() {
  const ll = $("lobby-players"); if (!ll) return;
  const e = Object.entries(players);
  ll.innerHTML = e.map(([, p]) => `<li><span class="dot ${p.connected ? "" : "off"}"></span><span>${esc(p.name)}</span>${p.isHost ? '<span class="badge">HOST</span>' : ""}</li>`).join("");
  $("lobby-count").textContent = `${e.length} player${e.length !== 1 ? "s" : ""}`;
}

function renderGame() {
  const q = meta.currentQ; const revealed = meta.state === "reveal" && meta.reveal;
  $("q-progress").textContent = `Q${(meta.qIndex || 0) + 1} / ${meta.count}`;
  $("q-grade").textContent = q ? `${q.gradeLabel} · ${q.subject}` : "";
  $("q-text").textContent = q ? q.q : "";
  $("host-controls").style.display = IS_HOST ? "flex" : "none";
  $("host-dash").style.display = IS_HOST ? "block" : "none";
  $("player-note").style.display = IS_HOST ? "none" : "block";
  const cd = $("countdown");
  if (q && meta.state === "playing") { const left = Math.max(0, Math.ceil((q.endsAt - Date.now()) / 1000)); cd.textContent = left + "s"; cd.style.display = "block"; }
  else cd.style.display = "none";
  const wrap = $("choices"); wrap.innerHTML = "";
  const letters = ["A", "B", "C", "D"];
  (q ? q.choices : []).forEach((choice, i) => {
    const b = document.createElement("button"); b.className = "choice";
    b.innerHTML = `<span class="cl">${letters[i]}</span><span class="ct">${esc(choice)}</span>`;
    if (revealed) {
      if (i === meta.reveal.correctIndex) b.classList.add("correct");
      if (!IS_HOST && myAnswer && myAnswer.choice === i && i !== meta.reveal.correctIndex) b.classList.add("wrong");
    } else if (IS_HOST) {
      const full = lookupQ(q.qid); if (full && choice === full.a[full.c]) b.classList.add("host-key");
    } else if (myAnswer && myAnswer.choice === i) { b.classList.add("chosen"); }
    if (!IS_HOST && meta.state === "playing" && !myAnswer) b.addEventListener("click", () => submitAnswer(i));
    else b.disabled = true;
    wrap.appendChild(b);
  });
  let msg = "";
  if (!IS_HOST) {
    if (meta.state === "playing") msg = myAnswer ? "Answer locked in — waiting…" : "Pick an answer!";
    else if (revealed) { const right = myAnswer && myAnswer.choice === meta.reveal.correctIndex; msg = myAnswer ? (right ? "✅ Correct!" : "❌ Not this time") : "⏱️ No answer"; if (soundState !== "rev") { soundState = "rev"; right ? Sound.right() : Sound.wrong(); } }
  } else { msg = meta.state === "reveal" ? "Answer revealed — review, then Next." : "Class is answering…"; }
  $("status-line").textContent = msg;
  if (meta.state === "reveal") { $("mini-board").style.display = "block"; renderScoreboard($("mini-board"), false); } else $("mini-board").style.display = "none";
  if (IS_HOST) { $("btn-reveal").style.display = meta.state === "playing" ? "inline-block" : "none"; $("btn-next").style.display = meta.state === "reveal" ? "inline-block" : "none"; }
}
function renderHostDash() {
  const list = $("dash-list"); if (!list) return;
  const q = meta.currentQ; const rows = Object.entries(players).filter(([uid, p]) => p && uid !== meta.hostUid);
  const answered = rows.filter(([, p]) => p.answer && q && p.answer.qid === q.qid).length;
  $("dash-count").textContent = `${answered}/${rows.length} answered`;
  const correctIdx = meta.reveal ? meta.reveal.correctIndex : -1;
  list.innerHTML = rows.map(([uid, p]) => {
    const a = p.answer && q && p.answer.qid === q.qid ? p.answer : null;
    let tag = a ? "answered" : "…";
    if (meta.state === "reveal" && a) tag = a.choice === correctIdx ? "✅" : "❌";
    return `<div class="dash-row"><span class="dot ${p.connected ? "" : "off"}"></span><span class="dr-name">${esc(p.name)}</span><span class="dr-score">${p.score || 0}</span><span class="dr-tag">${tag}</span></div>`;
  }).join("") || `<div class="dash-empty">No players yet.</div>`;
}
function renderScoreboard(el, big) {
  const rows = Object.entries(players).filter(([uid, p]) => p && uid !== meta.hostUid).map(([, p]) => p).sort((a, b) => (b.score || 0) - (a.score || 0));
  const medals = ["🥇", "🥈", "🥉"];
  el.innerHTML = rows.map((p, i) => `<div class="sb-row ${big && i === 0 ? "sb-top" : ""}"><span class="sb-rank">${i < 3 ? medals[i] : i + 1}</span><span class="sb-name">${esc(p.name)}</span><span class="sb-pts">${p.score || 0}</span></div>`).join("") || `<div class="dash-empty">No scores.</div>`;
}
// report card verdict from correct-answer count
function verdict(correct, total) {
  if (total > 0 && correct >= total) return { txt: "Smarter than a 5th grader!", emo: "🎓🏆" };
  const g = Math.max(1, Math.min(5, Math.ceil((correct / Math.max(1, total)) * 5)));
  const ord = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th" }[g];
  return { txt: `As smart as a ${ord} grader`, emo: "🍎" };
}
function renderReportCards() {
  const el = $("report-card"); if (!el) return;
  const total = meta.count || 0;
  const rows = Object.entries(players).filter(([uid, p]) => p && uid !== meta.hostUid).map(([, p]) => p).sort((a, b) => (b.correct || 0) - (a.correct || 0));
  el.innerHTML = `<div class="rc-title">Report Card</div>` + rows.map(p => {
    const v = verdict(p.correct || 0, total);
    return `<div class="rc-row"><span class="rc-name">${esc(p.name)}</span><span class="rc-verdict">${v.emo} ${esc(v.txt)}</span><span class="rc-score">${p.correct || 0}/${total}</span></div>`;
  }).join("") || `<div class="dash-empty">No players.</div>`;
}

function submitAnswer(i) {
  if (IS_HOST || !meta || meta.state !== "playing" || myAnswer) return;
  const q = meta.currentQ; if (!q) return;
  myAnswer = { qid: q.qid, choice: i, at: Date.now() };
  Sound.tap();
  update(ref(db, `grader/${ROOM}/players/${ME}`), { answer: myAnswer });
  renderGame();
}

// ---- host: flow -----------------------------------------------------------
$("btn-start").addEventListener("click", async () => {
  if (!IS_HOST) return;
  const nonHost = Object.entries(players).filter(([uid, p]) => p.connected && uid !== meta.hostUid).length;
  if (nonHost < 1) { alert("Need at least 1 player (besides the host) to start."); return; }
  if (!(await loadContent())) return;
  finalizing = false;
  // reset per-player scores/correct for a fresh climb
  const resets = {}; Object.keys(players).forEach(uid => { if (uid !== meta.hostUid) { resets[`grader/${ROOM}/players/${uid}/score`] = 0; resets[`grader/${ROOM}/players/${uid}/correct`] = 0; } });
  if (Object.keys(resets).length) await update(ref(db), resets);
  await drawNext(true);
});
$("btn-reveal").addEventListener("click", () => { if (IS_HOST) doReveal(); });
$("btn-next").addEventListener("click", () => { if (IS_HOST) advance(); });
$("btn-again").addEventListener("click", async () => {
  if (!IS_HOST) return; if (!(await loadContent())) return; finalizing = false;
  const resets = {}; Object.keys(players).forEach(uid => { if (uid !== meta.hostUid) { resets[`grader/${ROOM}/players/${uid}/score`] = 0; resets[`grader/${ROOM}/players/${uid}/correct`] = 0; } });
  resets[`grader/${ROOM}/meta/qIndex`] = -1; await update(ref(db), resets);
  await drawNext(true);
});

function usedList() { const u = meta && meta.usedQ; return Array.isArray(u) ? u.slice() : (u ? Object.values(u) : []); }
async function drawNext(first) {
  revealing = false;
  const qIndex = first ? 0 : (meta.qIndex || 0) + 1;
  const { grade, subject } = ladderAt(qIndex, meta.perGrade || 2);
  const pool = poolFor(grade, subject);
  let used = usedList();
  let avail = pool.filter((id) => !used.includes(id));
  if (avail.length === 0) { used = used.filter(id => !pool.includes(id)); avail = pool.slice(); } // reset just this pool
  const qid = avail[Math.floor(Math.random() * avail.length)];
  used.push(qid);
  const full = lookupQ(qid);
  const clear = {}; Object.keys(players).forEach(uid => { clear[`grader/${ROOM}/players/${uid}/answer`] = null; });
  if (Object.keys(clear).length) await update(ref(db), clear);
  const now = Date.now();
  await update(ref(db, `grader/${ROOM}/meta`), {
    state: "playing", qIndex, usedQ: used, reveal: null,
    currentQ: { qid, grade, subject, gradeLabel: GRADE_LABEL[grade] || ("Grade " + grade), q: full.q, choices: pickN(full.a, full.a.length), startedAt: now, endsAt: now + (meta.questionSeconds || 20) * 1000 },
  });
}
function startHostTimer() { if (hostTimer) return; hostTimer = setInterval(() => { if (!IS_HOST || !meta || meta.state !== "playing") return; renderGame(); if (meta.currentQ && Date.now() >= meta.currentQ.endsAt) doReveal(); }, 400); }
function checkAllAnswered() {
  if (!IS_HOST || !meta || meta.state !== "playing" || !meta.currentQ) return;
  const rows = Object.entries(players).filter(([uid, p]) => p && uid !== meta.hostUid && p.connected);
  if (rows.length && rows.every(([, p]) => p.answer && p.answer.qid === meta.currentQ.qid)) doReveal();
}
async function doReveal() {
  if (!IS_HOST || revealing || !meta || meta.state !== "playing" || !meta.currentQ) return;
  revealing = true; stopHostTimer();
  const q = meta.currentQ; const full = lookupQ(q.qid);
  const correctText = full ? full.a[full.c] : null; const correctIndex = q.choices.indexOf(correctText);
  const secs = (meta.questionSeconds || 20) * 1000; const updates = {};
  for (const [uid, p] of Object.entries(players)) {
    if (uid === meta.hostUid || !p.answer || p.answer.qid !== q.qid) continue;
    if (p.answer.choice === correctIndex) {
      const remain = Math.max(0, q.endsAt - p.answer.at);
      const pts = Math.max(10, Math.min(100, Math.round(100 * remain / secs)));
      updates[`grader/${ROOM}/players/${uid}/score`] = (p.score || 0) + pts;
      updates[`grader/${ROOM}/players/${uid}/correct`] = (p.correct || 0) + 1;
    }
  }
  if (Object.keys(updates).length) await update(ref(db), updates);
  await update(ref(db, `grader/${ROOM}/meta`), { state: "reveal", reveal: { qid: q.qid, correctIndex } });
}
async function advance() {
  if (!IS_HOST || !meta) return;
  if ((meta.qIndex || 0) + 1 >= meta.count) { await finalize(); return; }
  await drawNext(false);
}
async function finalize() {
  if (finalizing) return; finalizing = true;
  const scorers = Object.entries(players).filter(([uid, p]) => p && uid !== meta.hostUid);
  const top = Math.max(0, ...scorers.map(([, p]) => p.score || 0));
  for (const [, p] of scorers) { if (!p.eid) continue; await addToLeaderboard(p.eid, p.name, "grader", p.score || 0, top > 0 && (p.score || 0) === top); }
  await update(ref(db, `grader/${ROOM}/meta`), { state: "done" });
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
  try { await push(ref(db, "feedback/" + (ROOM || "grader")), { game: "School Grader", name: (players[ME] && players[ME].name) || "", rating: fbRating || "", comment, gameDate: new Date((meta && meta.createdAt) || Date.now()).toISOString().slice(0, 10), ts: Date.now() }); } catch (e) {}
  $("fb-form").style.display = "none"; $("fb-thanks").style.display = "block"; fbRating = 0; $("fb-comment").value = ""; document.querySelectorAll("#fb-stars span").forEach(x => x.classList.remove("on"));
  setTimeout(closeFb, 1800);
});

// ---- misc -----------------------------------------------------------------
$("btn-copy").addEventListener("click", async () => { const url = `${location.origin}${location.pathname}?room=${ROOM}`; try { await navigator.clipboard.writeText(url); $("btn-copy").textContent = "Copied!"; } catch { prompt("Invite link:", url); } setTimeout(() => ($("btn-copy").textContent = "Copy invite link"), 1500); });
$("btn-mute").addEventListener("click", () => { $("btn-mute").textContent = Sound.toggle() ? "🔇" : "🔊"; });
$("btn-mute").textContent = Sound.isMuted() ? "🔇" : "🔊";
$("btn-leave").addEventListener("click", () => { location.href = "../"; });

const params = new URLSearchParams(location.search);
if (params.get("room")) $("join-code").value = params.get("room").toUpperCase();
