// ===========================================================================
// mod/grader.js — grader as an SPA module (mount/unmount). Same Firebase model.
// ===========================================================================
// ===========================================================================
// LS "Top of the Class" — grader.js
// A quiz that CLIMBS grades 1->5, rotating school subjects each round.
// Everyone answers on their device; faster correct answers score more.
// At the end each player gets a report card ("as smart as a Nth grader").
// Only the HOST loads grader-content.js, so answers stay off players' devices.
// Data under grader/{code}/ ; scores under lb/{scope}/{eid} (shared leaderboard).
// ===========================================================================
import { auth, db } from "../common/firebase-config.js";
import { EID_RE } from "../common/eid.js";
import { addToLeaderboard } from "../common/leaderboard.js";
import { Audio } from "../common/audio.js";
const Music = Audio.music;
import { signInAnonymously, onAuthStateChanged } from
  "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  ref, set, update, get, onValue, push, remove, onDisconnect, off, runTransaction
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

const $ = (id) => document.getElementById(id);
const show = (s) => { document.querySelectorAll(".screen").forEach(x => x.classList.remove("active")); $(s).classList.add("active"); };
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const MAX_GRADE = 8;

// ---- sound ----------------------------------------------------------------
const Sound = {
  ensure() { Audio.ensure(); },
  toggle() { return Audio.toggleSfx(); },
  isMuted() { return Audio.sfxMuted(); },
  q() { Audio.sfx("round"); },
  tap() { Audio.sfx("tap"); },
  right() { Audio.sfx("correct"); },
  wrong() { Audio.sfx("wrong"); },
  end() { Audio.celebrate(); },
};
document.addEventListener("click", () => Sound.ensure(), { once: true });

let authUnsub = null, _detach = () => {}, _stop = () => {};

const SCREENS = `
  <!-- JOIN -->
  <section id="screen-join" class="screen active">
    <div class="wrap">
      <div class="brandbar"><div class="logo">LS</div><div><h1>Top of the Class</h1><p class="tagline">Climb from Grade 1 to Grade 8</p></div></div>
      <div class="card">
        <div class="field"><label for="name">Your name</label><input id="name" maxlength="20" placeholder="e.g. Alex" autocomplete="off" /></div>
        <div class="field"><label for="eid">Employee ID</label><input id="eid" maxlength="10" placeholder="Employee ID" autocomplete="off" style="text-transform:uppercase" /></div>
        <div class="field"><label for="join-code">Join a game</label>
          <div class="row"><input id="join-code" maxlength="4" placeholder="CODE" style="text-transform:uppercase" autocomplete="off" /><button id="btn-join" class="btn-primary" style="flex:0 0 auto">Join</button></div>
        </div>
        <div class="divider">or host a new game</div>
        <div class="row">
          <div class="field" style="flex:1"><label for="opt-start">Start at grade</label>
            <select id="opt-start"><option value="1">Grade 1 (easiest)</option><option value="2">Grade 2</option><option value="3">Grade 3</option><option value="4">Grade 4</option><option value="5" selected>Grade 5</option><option value="6">Grade 6</option><option value="7">Grade 7</option><option value="8">Grade 8 (hardest)</option></select>
          </div>
          <div class="field" style="flex:1"><label for="opt-count">Questions</label>
            <select id="opt-count"><option value="10" selected>10</option><option value="15">15</option><option value="20">20</option></select>
          </div>
        </div>
        <div class="field"><label for="opt-time">Seconds each</label>
          <select id="opt-time"><option value="15">15s</option><option value="20" selected>20s</option><option value="30">30s</option></select>
        </div>
        <p class="tinynote">Climbs from your chosen grade up to Grade 8, changing subjects each round. Pick a higher grade for a harder game. <b>Grade 5</b> for an all-hard game.</p>
        <button id="btn-create" class="btn-ghost full">Create game</button>
        <div id="join-error" class="error"></div>
        <p class="hint" id="rejoin-hint" style="display:none"></p>
      </div>
    </div>
  </section>

  <!-- LOBBY -->
  <section id="screen-lobby" class="screen">
    <div class="wrap">
      <div class="brandbar"><div class="logo">LS</div><div><h1>Top of the Class</h1><p class="tagline" id="lobby-sub">Lobby</p></div></div>
      <div class="card">
        <label class="mini-label">Room code</label>
        <div class="roomcode" id="lobby-code">----</div>
        <div style="text-align:center"><button id="btn-copy" class="btn-ghost">Copy invite link</button></div>
        <div class="howto"><strong>How to play</strong><ul id="howto-list"></ul></div>
        <div class="listhead"><span>Players</span><span class="count" id="lobby-count"></span></div>
        <ul class="playerlist" id="lobby-players"></ul>
        <button id="btn-start" class="btn-primary full">Start game</button>
        <p class="hint" id="lobby-hint">Waiting for the host to start…</p>
      </div>
    </div>
  </section>

  <!-- GAME -->
  <section id="screen-game" class="screen">
    <div class="game-shell">
      <div class="topbar">
        <div class="tb-left"><div class="logo sm">LS</div><div class="qprog" id="q-progress"></div></div>
        <div class="countdown" id="countdown"></div>
        <div class="tb-right"><button id="btn-feedback" class="iconbtn" title="Feedback">&#128172;</button></div>
      </div>
      <div class="q-block">
        <div class="q-grade" id="q-grade"></div>
        <div class="q-text" id="q-text"></div>
      </div>
      <div class="choices" id="choices"></div>
      <p class="status-line" id="status-line"></p>
      <div id="player-note" class="player-note" style="display:none"></div>
      <div id="mini-board" class="scoreboard" style="display:none"></div>
      <div id="host-dash" class="host-dash" style="display:none">
        <div class="dash-head"><span>Live answers</span><span class="count" id="dash-count"></span></div>
        <div class="dash-list" id="dash-list"></div>
      </div>
      <div id="host-controls" class="host-controls" style="display:none">
        <button id="btn-reveal" class="btn-ghost">Reveal answer</button>
        <button id="btn-next" class="btn-primary" style="display:none">Next question</button>
      </div>
      <div class="chat-log" id="chat-log"></div>
      <div class="chat-row" id="chat-row">
        <input id="chat-input" placeholder="Chat with everyone…" autocomplete="off" maxlength="200" />
        <button id="chat-send" class="btn-primary">Send</button>
      </div>
      <button id="btn-leave" class="btn-warn">Leave game</button>
    </div>
  </section>

  <!-- DONE -->
  <section id="screen-done" class="screen">
    <div class="wrap">
      <div class="brandbar"><div class="logo">&#127891;</div><div><h1>Report Card</h1><p class="tagline">Top of the Class</p></div></div>
      <div class="card">
        <div class="report-card" id="report-card"></div>
        <div class="scoreboard big" id="done-board"></div>
        <button id="btn-again" class="btn-primary full">Play again</button>
        <button id="btn-feedback-end" class="btn-ghost full" style="margin-top:8px">&#128172; Give feedback</button>
        <p class="hint" id="done-hint"></p>
      </div>
    </div>
  </section>

  <!-- FEEDBACK MODAL -->
  <div id="feedback-modal" class="modal" style="display:none">
    <div class="modal-card">
      <button id="fb-close" class="modal-x" aria-label="Close">&times;</button>
      <div id="fb-form">
        <h3 class="fb-title">How was the game?</h3>
        <div id="fb-stars" class="stars"><span data-v="1">&#9733;</span><span data-v="2">&#9733;</span><span data-v="3">&#9733;</span><span data-v="4">&#9733;</span><span data-v="5">&#9733;</span></div>
        <textarea id="fb-comment" placeholder="Anything to add? (optional)"></textarea>
        <button id="fb-send" class="btn-primary full">Send feedback</button>
      </div>
      <div id="fb-thanks" class="fb-thanks" style="display:none">&#127881; Thanks for the feedback!</div>
    </div>
  </div>
`;

export function mount(root, __shell) {
  if (!document.getElementById("grader-css")) { const _l = document.createElement("link"); _l.rel = "stylesheet"; _l.href = "grader/styles.css"; _l.id = "grader-css"; document.head.appendChild(_l); }
  root.innerHTML = SCREENS;


// ---- state ----------------------------------------------------------------
let ME, ROOM, IS_HOST = false, meta = null, players = {}, listeners = [];
let myAnswer = null, hostTimer = null, revealing = false, finalizing = false;
let QUESTIONS = null, SUBJECTS = null, GRADE_LABEL = null, contentLoaded = false; // host-only
let chat = {};
let lastQid = "", soundState = "";

authUnsub = onAuthStateChanged(auth, (u) => { if (u) { ME = u.uid; offerRejoin(); } });
signInAnonymously(auth).catch((e) => { $("join-error").textContent = "Couldn't connect to the server. (" + e.code + ")"; });

function getEid() { const raw = ($("eid").value || "").trim().toUpperCase(); if (!EID_RE.test(raw)) { $("join-error").textContent = "Enter a valid Employee ID to play."; return null; } return raw; }
function getName() { const n = ($("name").value || "").trim(); if (!n) $("join-error").textContent = "Enter your name first."; return n; }

// ---- content (host only) --------------------------------------------------
async function loadContent() {
  if (contentLoaded) return true;
  try { const m = await import("./grader-content.js?v=5"); QUESTIONS = m.QUESTIONS; SUBJECTS = m.SUBJECTS; GRADE_LABEL = m.GRADE_LABEL; contentLoaded = true; return true; }
  catch (e) { alert("Could not load the question bank."); return false; }
}
// ladder: qIndex -> which grade & subject (climbs grades, rotates subjects)
function ladderAt(qIndex, startGrade, count) {
  const sg = Math.min(MAX_GRADE, Math.max(1, startGrade || 1));
  const numGrades = MAX_GRADE - sg + 1;
  const grade = Math.min(MAX_GRADE, sg + Math.floor(qIndex * numGrades / Math.max(1, count || 10)));
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
  const startGrade = Number($("opt-start").value);
  const count = Number($("opt-count").value);
  const code = Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
  try {
    await set(ref(db, `grader/${code}/meta`), {
      hostUid: ME, startGrade, count, questionSeconds: Number($("opt-time").value),
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
  const c = ref(db, `grader/${code}/chat`); onValue(c, s => { chat = s.val() || {}; renderChat(); }); listeners.push(c);
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
  if (meta.state === "playing" || meta.state === "reveal") Music.start(); else if (meta.state === "lobby") Music.stop();
}
function onPlayers() {
  if (!meta) return;
  if (meta.state === "lobby") renderLobbyPlayers();
  if ((meta.state === "playing" || meta.state === "reveal") && IS_HOST) renderHostDash();
  if (IS_HOST && meta.state === "playing") checkAllAnswered();
}

const lobbyLabel = () => { const sg = meta.startGrade || 1; return sg >= MAX_GRADE ? `Grade ${MAX_GRADE} only · ${meta.count} questions` : `Grade ${sg} → ${MAX_GRADE} · ${meta.count} questions`; };
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
  if (IS_HOST) { $("btn-reveal").style.display = meta.state === "playing" ? "inline-block" : "none"; $("btn-next").style.display = meta.state === "reveal" ? "inline-block" : "none"; $("btn-next").textContent = ((meta.qIndex || 0) + 1 >= meta.count) ? "See results \u2192" : "Next question"; }
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
  if (total > 0 && correct >= total) return { txt: "Perfect score — genius!", emo: "🎓🏆" };
  const g = Math.max(1, Math.min(MAX_GRADE, Math.ceil((correct / Math.max(1, total)) * MAX_GRADE)));
  const ord = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th", 6: "6th", 7: "7th", 8: "8th" }[g];
  return { txt: `As smart as a ${ord} grader`, emo: g >= 7 ? "🧠" : "🍎" };
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

function renderChat() {
  const log = $("chat-log"); if (!log) return;
  const entries = Object.values(chat || {}).sort((a, b) => (a.ts || 0) - (b.ts || 0));
  log.innerHTML = entries.map(e => e.system
    ? `<div class="cmsg sys">${esc(e.text)}</div>`
    : `<div class="cmsg"><span class="cwho">${esc(e.name)}:</span> ${esc(e.text)}</div>`
  ).join("") || `<div class="cmsg sys">Chat with everyone here \uD83D\uDC4B</div>`;
  log.scrollTop = log.scrollHeight;
}
function sendChat() {
  const t = ($("chat-input").value || "").trim(); if (!t || !ROOM) return;
  push(ref(db, `grader/${ROOM}/chat`), { uid: ME, name: (players[ME] && players[ME].name) || "?", text: t.slice(0, 200), ts: Date.now() });
  $("chat-input").value = "";
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
  try { await remove(ref(db, `grader/${ROOM}/chat`)); } catch (e) {}
  await drawNext(true);
});
$("btn-reveal").addEventListener("click", () => { if (IS_HOST) doReveal(); });
$("btn-next").addEventListener("click", () => { if (IS_HOST) advance(); });
$("btn-again").addEventListener("click", async () => {
  if (!IS_HOST) return; if (!(await loadContent())) return; finalizing = false;
  const resets = {}; Object.keys(players).forEach(uid => { if (uid !== meta.hostUid) { resets[`grader/${ROOM}/players/${uid}/score`] = 0; resets[`grader/${ROOM}/players/${uid}/correct`] = 0; } });
  resets[`grader/${ROOM}/meta/qIndex`] = -1; await update(ref(db), resets);
  try { await remove(ref(db, `grader/${ROOM}/chat`)); } catch (e) {}
  await drawNext(true);
});

function usedList() { const u = meta && meta.usedQ; return Array.isArray(u) ? u.slice() : (u ? Object.values(u) : []); }
async function drawNext(first) {
  revealing = false;
  const qIndex = first ? 0 : (meta.qIndex || 0) + 1;
  const { grade, subject } = ladderAt(qIndex, meta.startGrade || 1, meta.count || 10);
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
  await update(ref(db, `grader/${ROOM}/meta`), { state: "done" });
  const scorers = Object.entries(players).filter(([uid, p]) => p && uid !== meta.hostUid);
  const top = Math.max(0, ...scorers.map(([, p]) => p.score || 0));
  for (const [, p] of scorers) { if (!p.eid) continue; try { await addToLeaderboard(p.eid, p.name, "grader", p.score || 0, top > 0 && (p.score || 0) === top); } catch (e) {} }
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
  try { await push(ref(db, "feedback/" + (ROOM || "grader")), { game: "Top of the Class", name: (players[ME] && players[ME].name) || "", rating: fbRating || "", comment, gameDate: new Date((meta && meta.createdAt) || Date.now()).toISOString().slice(0, 10), ts: Date.now() }); } catch (e) {}
  $("fb-form").style.display = "none"; $("fb-thanks").style.display = "block"; fbRating = 0; $("fb-comment").value = ""; document.querySelectorAll("#fb-stars span").forEach(x => x.classList.remove("on"));
  setTimeout(closeFb, 1800);
});

// ---- misc -----------------------------------------------------------------
$("btn-copy").addEventListener("click", async () => { const url = `${location.origin}${location.pathname}#/grader?room=${ROOM}`; try { await navigator.clipboard.writeText(url); $("btn-copy").textContent = "Copied!"; } catch { prompt("Invite link:", url); } setTimeout(() => ($("btn-copy").textContent = "Copy invite link"), 1500); });

$("chat-send").addEventListener("click", sendChat);
$("chat-input").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });
$("btn-leave").addEventListener("click", async () => { try { if (ROOM && ME) await update(ref(db, `grader/${ROOM}/players/${ME}`), { connected: false }); } catch {} __shell.goHome(); });

const params = new URLSearchParams((location.hash.split("?")[1]) || "");
if (params.get("room")) $("join-code").value = params.get("room").toUpperCase();


  _detach = (typeof detach === "function") ? detach : () => {};
  _stop = (typeof stopHostTimer === "function") ? stopHostTimer : () => {};
}

export function unmount() {
  if (authUnsub) { authUnsub(); authUnsub = null; }
  _detach(); _stop();
  Music.stop();
  document.getElementById("grader-css")?.remove();
}
