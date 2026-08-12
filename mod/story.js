// ===========================================================================
// mod/story.js — "Story Chain": a hostless, never-ending collaborative story.
//
// HOW IT WORKS (contested tip)
//   The story is one shared linear canon: c1, c2, c3 ... Anyone can propose the
//   NEXT line at the tip. If several people propose, everyone votes with a
//   reaction (one vote each). When the window closes the most-backed line locks
//   into canon and the story advances; the rivals drop into the Cutting Room.
//
// NO HOST, NO ROOMS — one persistent story under  story/  in Firebase.
//   story/canon/c{n}   { seq,text,name,eid,ts,votes,rivals,lockedAt,removed? }
//   story/live         { seq, lockAt, cands:{ id:{text,name,eid,uid,ts,reacts:{eid:emoji}} } }
//   story/cutting/{id} { seq,text,name,eid,ts,votes }
//   story/reports/c{n}/{eid}=true      story/admins/{eid}=true
//   story/paid/c{n}=true               (leaderboard payout guard)
//
// Resolution is client-side but SAFE: the winner is picked deterministically
// (votes desc, then earliest, then id) and written to a fixed key `c{seq}`, so
// two devices resolving at once produce the same write. Payout is guarded by a
// transaction on story/paid/c{seq} so it happens exactly once.
//
// Scores go to the shared leaderboard under game key "story".
// ===========================================================================
import { auth, db } from "../common/firebase-config.js";
import { EID_RE } from "../common/eid.js";
import { addToLeaderboard } from "../common/leaderboard.js";
import { Audio } from "../common/audio.js";
import { signInAnonymously, onAuthStateChanged } from
  "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  ref, set, get, onValue, push, remove, off, update, runTransaction
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

const $ = (id) => document.getElementById(id);
const show = (s) => { document.querySelectorAll(".screen").forEach(x => x.classList.remove("active")); $(s)?.classList.add("active"); };
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---- tuning ---------------------------------------------------------------
const MAX_LEN    = 200;              // a sentence or two
const WINDOW_MS  = 5 * 60 * 1000;    // voting window once the first line lands
const LB_GAME    = "story";
const P_CANON    = 10;               // your line became canon
const P_VOTE     = 2;                // per vote it collected
const P_TRY      = 2;                // consolation for a rival line
const EMOJI      = ["👍", "❤️", "😂", "🔥"];
// Moderators (can hide a line). Also readable from Firebase at story/admins/{eid}.
const ADMIN_EIDS = [];

const SPARKS = [
  "Introduce a twist nobody saw coming.",
  "A new character walks in. Who?",
  "Someone tells a lie.",
  "Change the location entirely.",
  "Reveal something about the past.",
  "Raise the stakes — something goes wrong.",
  "Give someone an impossible choice.",
  "End on a cliffhanger.",
  "Add a small, oddly specific detail.",
  "Let someone finally say the quiet thing out loud.",
  "Bring back something from earlier in the story.",
  "Make it funnier than it has any right to be.",
];

const Sound = {
  ensure() { Audio.ensure(); },
  tap()    { Audio.sfx("tap"); },
  post()   { Audio.sfx("join"); },
  lock()   { Audio.sfx("reveal"); },
  win()    { Audio.celebrate(); },
};

let authUnsub = null, _detach = () => {}, _stop = () => {};

// ---------------------------------------------------------------------------
const SCREENS = `
  <!-- GATE -->
  <section id="screen-gate" class="screen active">
    <div class="wrap">
      <div class="brandbar"><div class="logo">LS</div><div><h1>Story Chain</h1><p class="tagline">One story. Everyone writes it.</p></div></div>
      <div class="card">
        <p class="tinynote" style="margin-top:0">There's no host and no rounds. Drop in whenever, read the story so far, and add the next line. If more than one person adds a line, the team votes and the favourite becomes canon.</p>
        <div class="field"><label for="st-name">Your name</label><input id="st-name" maxlength="20" placeholder="e.g. Alex" autocomplete="off" /></div>
        <div class="field"><label for="st-eid">Employee ID</label><input id="st-eid" maxlength="10" placeholder="Employee ID" autocomplete="off" style="text-transform:uppercase" /></div>
        <button id="st-enter" class="btn-primary full">Open the story</button>
        <div id="st-gate-err" class="error"></div>
      </div>
    </div>
  </section>

  <!-- STORY -->
  <section id="screen-story" class="screen">
    <div class="story-shell">
      <div class="st-top">
        <div class="tb-left"><div class="logo sm">LS</div><div><div class="st-title">Story Chain</div><div class="st-sub" id="st-count">—</div></div></div>
        <div class="tb-right">
          <button id="st-cut" class="btn-ghost mini" title="Lines that didn't make it">✂️ Cutting&nbsp;Room</button>
        </div>
      </div>

      <div class="st-feed" id="st-feed"></div>

      <div class="st-tip" id="st-tip"></div>

      <div class="st-compose" id="st-compose">
        <div class="st-spark" id="st-spark"></div>
        <textarea id="st-input" rows="2" maxlength="${MAX_LEN}" placeholder="Write the next line…"></textarea>
        <div class="st-crow">
          <span class="st-left" id="st-left">${MAX_LEN}</span>
          <button id="st-newspark" class="btn-ghost mini" title="Another prompt">🎲 Spark</button>
          <button id="st-post" class="btn-primary">Add my line</button>
        </div>
        <div id="st-err" class="error"></div>
      </div>

      <p class="hint" id="st-rule"></p>
      <button id="st-leave" class="btn-warn">Sign out of the story</button>
    </div>
  </section>
`;

// ---------------------------------------------------------------------------
export function mount(root, __shell) {
  // No per-game stylesheet — Story Chain's styles live in the shell's app.css
  // (same as Trivia), so there's nothing to inject or clean up here.
  root.innerHTML = SCREENS;

  // ---- state --------------------------------------------------------------
  let ME = null, NAME = "", EID = "";
  let canon = {}, live = null, cutting = {}, reports = {}, admins = {};
  let isAdmin = false, sparkIdx = 0, ticker = null, resolving = false;
  let lastCanonCount = -1, listeners = [], dbErr = false, attached = false;

  const LSK = { name: "ls_story_name", eid: "ls_story_eid" };
  const gerr = (m) => { $("st-gate-err").textContent = m || ""; };
  const cerr = (m) => { $("st-err").textContent = m || ""; };

  document.addEventListener("click", () => Sound.ensure(), { once: true });
  let pendingEnter = false;
  authUnsub = onAuthStateChanged(auth, (u) => {
    if (!u) return;
    ME = u.uid;
    if (pendingEnter) { pendingEnter = false; attach(); }   // reads need a signed-in token
  });
  signInAnonymously(auth).catch(() => gerr("Couldn't connect to the server."));

  // ---- helpers ------------------------------------------------------------
  const canonList = () => Object.entries(canon)
    .map(([k, v]) => ({ key: k, ...v }))
    .sort((a, b) => (a.seq || 0) - (b.seq || 0));
  const maxSeq = () => canonList().reduce((m, e) => Math.max(m, e.seq || 0), 0);
  const lastLine = () => { const l = canonList(); return l.length ? l[l.length - 1] : null; };
  const votesOf = (c) => Object.keys(c.reacts || {}).length;
  const candList = () => Object.entries((live && live.cands) || {})
    .map(([id, c]) => ({ id, ...c }))
    .sort((a, b) => (votesOf(b) - votesOf(a)) || ((a.ts || 0) - (b.ts || 0)) || (a.id < b.id ? -1 : 1));
  const myVote = () => {
    for (const c of candList()) if ((c.reacts || {})[EID]) return { id: c.id, emoji: c.reacts[EID] };
    return null;
  };
  const myCand = () => candList().find(c => c.eid === EID) || null;
  const wroteLast = () => { const l = lastLine(); return !!(l && l.eid === EID); };
  const fmtLeft = (ms) => {
    if (ms <= 0) return "closing…";
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  // ---- gate ---------------------------------------------------------------
  $("st-name").value = localStorage.getItem(LSK.name) || "";
  $("st-eid").value  = localStorage.getItem(LSK.eid) || "";

  function enter() {
    const n = ($("st-name").value || "").trim();
    const e = ($("st-eid").value || "").trim().toUpperCase();
    if (!n) return gerr("Enter your name first.");
    if (!EID_RE.test(e)) return gerr("Enter a valid Employee ID.");
    NAME = n; EID = e;
    localStorage.setItem(LSK.name, n); localStorage.setItem(LSK.eid, e);
    gerr(""); Sound.tap();
    isAdmin = ADMIN_EIDS.includes(EID);
    sparkIdx = Math.floor(Math.random() * SPARKS.length);
    show("screen-story");
    if (ME) attach(); else pendingEnter = true;             // wait for anonymous auth
  }
  $("st-enter").addEventListener("click", enter);
  $("st-eid").addEventListener("keydown", (ev) => { if (ev.key === "Enter") enter(); });
  if ($("st-name").value && EID_RE.test(($("st-eid").value || "").toUpperCase())) {
    // returning reader — go straight in
    enter();
  }

  // ---- live data ----------------------------------------------------------
  // A denied/failed read used to fail silently and leave the screen blank —
  // onValue cancels the listener and throws nothing. Always pass an error
  // handler so the player is told what happened.
  function dbError(err) {
    if (dbErr) return;
    dbErr = true;
    const msg = (err && (err.message || err.code)) || "The server refused the connection.";
    const feed = $("st-feed");
    if (feed) feed.innerHTML = `<div class="st-empty"><div class="st-emptyico">⚠️</div>
      <p><b>Can't reach the story right now.</b><br/>${esc(msg)}<br/>
      Try a refresh — if it keeps happening, the database rules may not allow <code>story/</code> yet.</p></div>`;
    const tip = $("st-tip"); if (tip) tip.innerHTML = "";
    const post = $("st-post"); if (post) post.disabled = true;
    const input = $("st-input");
    if (input) { input.disabled = true; input.placeholder = "Offline — can't add a line right now."; }
    const count = $("st-count"); if (count) count.textContent = "offline";
  }

  function attach() {
    if (attached) return;   // a second tap on "start reading" must not double-subscribe
    attached = true;
    const bind = (path, cb) => {
      const r = ref(db, path);
      const un = onValue(r, (snap) => { cb(snap.val() || {}); }, dbError);
      listeners.push(un);
    };
    bind("story/canon",   (v) => { canon = v; renderFeed(); renderTip(); maybeCelebrate(); });
    bind("story/live",    (v) => { live = (v && v.cands) ? v : null; renderTip(); resolveIfDue(); });
    bind("story/cutting", (v) => { cutting = v; });
    bind("story/reports", (v) => { reports = v; renderFeed(); });
    bind("story/admins",  (v) => { admins = v; isAdmin = ADMIN_EIDS.includes(EID) || !!v[EID]; renderFeed(); });

    _detach = () => { listeners.forEach(un => { try { un(); } catch {} }); listeners = []; };
    ticker = setInterval(() => { renderCountdown(); resolveIfDue(); }, 1000);
    _stop = () => { if (ticker) clearInterval(ticker); ticker = null; attached = false; };
    renderSpark();
    renderFeed(); renderTip();   // paint the empty state now, don't wait on the first snapshot
  }

  // ---- feed ---------------------------------------------------------------
  function renderFeed() {
    if (dbErr) return;
    const feed = $("st-feed"); if (!feed) return;
    const list = canonList();
    const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 60;
    $("st-count").textContent = list.length
      ? `${list.length} line${list.length === 1 ? "" : "s"} of canon`
      : "not started yet";

    if (!list.length) {
      feed.innerHTML = `<div class="st-empty"><div class="st-emptyico">📖</div>
        <p>The page is blank.<br/><b>Write the opening line</b> and the story starts with you.</p></div>`;
      return;
    }
    feed.innerHTML = list.map(e => {
      if (e.removed) return `<div class="st-line gone"><span class="st-seq">${e.seq}</span><em>line removed by a moderator</em></div>`;
      const rc = Object.keys(reports[e.key] || {}).length;
      const mine = e.eid === EID;
      return `<div class="st-line${mine ? " mine" : ""}">
        <span class="st-seq">${e.seq}</span>
        <div class="st-body">
          <p class="st-text">${esc(e.text)}</p>
          <div class="st-meta">
            <span class="st-who">${esc(e.name)}</span>
            ${e.votes ? `<span class="st-votes" title="votes that won it canon">★ ${e.votes}</span>` : ""}
            ${e.rivals ? `<span class="st-beat">beat ${e.rivals}</span>` : ""}
            <button class="st-flag" data-flag="${e.key}" title="Report this line">${rc && isAdmin ? "🚩" + rc : "⚑"}</button>
            ${isAdmin ? `<button class="st-hide" data-hide="${e.key}" title="Hide this line (moderator)">hide</button>` : ""}
          </div>
        </div>
      </div>`;
    }).join("");

    feed.querySelectorAll("[data-flag]").forEach(b => b.addEventListener("click", () => reportLine(b.dataset.flag)));
    feed.querySelectorAll("[data-hide]").forEach(b => b.addEventListener("click", () => hideLine(b.dataset.hide)));
    if (atBottom) feed.scrollTop = feed.scrollHeight;
  }

  function maybeCelebrate() {
    const n = canonList().length;
    if (lastCanonCount >= 0 && n > lastCanonCount) {
      const l = lastLine();
      if (l && l.eid === EID && l.rivals) Sound.win(); else Sound.lock();
    }
    lastCanonCount = n;
  }

  // ---- the tip ------------------------------------------------------------
  function renderTip() {
    if (dbErr) return;
    const box = $("st-tip"); if (!box) return;
    const cands = candList();
    const mineUp = !!myCand();
    const blocked = wroteLast() && !mineUp;

    if (!cands.length) {
      box.innerHTML = `<div class="st-tiphead"><span>The tip</span><span class="st-open">open</span></div>
        <p class="st-tipnote">Nobody has proposed the next line yet. Yours would go straight into canon.</p>`;
    } else {
      const mv = myVote();
      const lead = votesOf(cands[0]);
      box.innerHTML = `<div class="st-tiphead">
          <span>${cands.length === 1 ? "Next line proposed" : `${cands.length} lines competing`}</span>
          <span class="st-clock" id="st-clock">—</span>
        </div>
        <p class="st-tipnote">${cands.length === 1
          ? "Back it or propose a rival before the window closes."
          : "Vote for the one that should become canon — one vote each."}</p>
        ${cands.map(c => {
          const v = votesOf(c);
          const isMine = c.eid === EID;
          const leading = cands.length > 1 && v === lead && v > 0;
          return `<div class="st-cand${isMine ? " own" : ""}${leading ? " lead" : ""}">
            <p class="st-text">${esc(c.text)}</p>
            <div class="st-candfoot">
              <span class="st-who">${esc(c.name)}${isMine ? " (you)" : ""}</span>
              <span class="st-tally">${v} vote${v === 1 ? "" : "s"}</span>
              <span class="st-react">${EMOJI.map(em => {
                const on = mv && mv.id === c.id && mv.emoji === em;
                return `<button class="st-em${on ? " on" : ""}" data-vote="${c.id}" data-em="${em}"${isMine ? ' disabled title="Your own line"' : ""}>${em}</button>`;
              }).join("")}</span>
            </div>
          </div>`;
        }).join("")}`;
      box.querySelectorAll("[data-vote]").forEach(b =>
        b.addEventListener("click", () => vote(b.dataset.vote, b.dataset.em)));
    }

    // compose availability
    const post = $("st-post"), input = $("st-input");
    if (mineUp) {
      post.disabled = true; input.disabled = true;
      input.placeholder = "Your line is in play — waiting for the window to close.";
    } else if (blocked) {
      post.disabled = true; input.disabled = true;
      input.placeholder = "You wrote the last line — let someone else take this one.";
    } else {
      post.disabled = false; input.disabled = false;
      input.placeholder = cands.length ? "Propose a rival line…" : "Write the next line…";
    }
    $("st-rule").innerHTML = `One vote each · ${MAX_LEN} characters max · you can't write two lines in a row`
      + (isAdmin ? " · <b>moderator</b>" : "");
    renderCountdown();
  }

  function renderCountdown() {
    const el = $("st-clock"); if (!el || !live) return;
    el.textContent = "locks in " + fmtLeft((live.lockAt || 0) - Date.now());
  }

  function renderSpark() {
    const el = $("st-spark"); if (el) el.textContent = "💡 " + SPARKS[sparkIdx % SPARKS.length];
  }
  $("st-newspark").addEventListener("click", () => { sparkIdx++; renderSpark(); Sound.tap(); });
  $("st-input").addEventListener("input", () => {
    $("st-left").textContent = MAX_LEN - ($("st-input").value || "").length;
    cerr("");
  });

  // ---- actions ------------------------------------------------------------
  async function postLine() {
    const text = ($("st-input").value || "").trim().replace(/\s+/g, " ");
    if (text.length < 3) return cerr("Give us a little more than that.");
    if (text.length > MAX_LEN) return cerr("A touch too long — trim it down.");
    if (myCand()) return cerr("You already have a line in play.");
    if (wroteLast()) return cerr("You wrote the last line — let someone else take this one.");

    const seq = (live && live.seq) || maxSeq() + 1;
    const id = push(ref(db, "story/live/cands")).key;
    const now = Date.now();
    $("st-post").disabled = true;
    const res = await runTransaction(ref(db, "story/live"), (cur) => {
      cur = cur || {};
      cur.cands = cur.cands || {};
      if (Object.values(cur.cands).some(c => c.eid === EID)) return;       // abort: already in
      cur.seq = cur.seq || seq;
      if (!cur.lockAt) cur.lockAt = now + WINDOW_MS;
      cur.cands[id] = { text, name: NAME, eid: EID, uid: ME, ts: now, reacts: {} };
      return cur;
    }).catch((e) => ({ committed: false, _err: e }));
    $("st-post").disabled = false;
    if (!res.committed) {
      return cerr(res._err
        ? "Couldn't save that — " + ((res._err.message || res._err.code || "unknown error"))
        : "Someone just beat you to it — take another look.");
    }
    $("st-input").value = ""; $("st-left").textContent = MAX_LEN;
    sparkIdx++; renderSpark(); Sound.post();
  }
  $("st-post").addEventListener("click", postLine);
  $("st-input").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) postLine();
  });

  async function vote(cid, em) {
    await runTransaction(ref(db, "story/live"), (cur) => {
      if (!cur || !cur.cands || !cur.cands[cid]) return;
      if (cur.cands[cid].eid === EID) return;                              // no self-voting
      const had = (cur.cands[cid].reacts || {})[EID];
      for (const k in cur.cands) {
        if (cur.cands[k].reacts && cur.cands[k].reacts[EID]) delete cur.cands[k].reacts[EID];
      }
      if (had !== em) {                                                    // same emoji again = un-vote
        cur.cands[cid].reacts = cur.cands[cid].reacts || {};
        cur.cands[cid].reacts[EID] = em;
      }
      return cur;
    }).catch((e) => cerr("Couldn't register that vote — " + (e.message || e.code || "unknown error")));
    Sound.tap();
  }

  async function reportLine(key) {
    await set(ref(db, `story/reports/${key}/${EID}`), true).catch(() => {});
    cerr(""); alert("Thanks — flagged for a moderator to look at.");
  }
  async function hideLine(key) {
    if (!isAdmin) return;
    await update(ref(db, `story/canon/${key}`), { removed: true, text: "" }).catch(() => {});
  }

  // ---- resolution ---------------------------------------------------------
  async function resolveIfDue() {
    if (resolving || !live) return;
    const cands = candList();
    if (!cands.length) return;
    if (Date.now() < (live.lockAt || 0)) return;

    resolving = true;
    try {
      const seq  = live.seq || maxSeq() + 1;
      const key  = "c" + seq;
      const lock = live.lockAt || 0;
      const win  = cands[0], losers = cands.slice(1);
      const wv   = votesOf(win);

      // 1. canon — fixed key + deterministic winner => idempotent across devices
      await set(ref(db, `story/canon/${key}`), {
        seq, text: win.text, name: win.name, eid: win.eid,
        ts: win.ts, votes: wv, rivals: losers.length, lockedAt: Date.now()
      });
      // 2. the rivals go to the Cutting Room
      for (const l of losers) {
        await set(ref(db, `story/cutting/${l.id}`), {
          seq, text: l.text, name: l.name, eid: l.eid, ts: l.ts, votes: votesOf(l)
        }).catch(() => {});
      }
      // 3. clear the round, but only if nothing changed underneath us
      await runTransaction(ref(db, "story/live"), (cur) => {
        if (!cur || (cur.lockAt || 0) !== lock) return;                    // someone else already did
        return null;
      }).catch(() => {});
      // 4. pay out exactly once, whoever gets there first pays everyone
      const paid = await runTransaction(ref(db, `story/paid/${key}`), (cur) => cur ? undefined : true)
        .catch(() => ({ committed: false }));
      if (paid.committed) {
        await addToLeaderboard(win.eid, win.name, LB_GAME, P_CANON + P_VOTE * wv, losers.length > 0);
        for (const l of losers) await addToLeaderboard(l.eid, l.name, LB_GAME, P_TRY, false);
      }
    } catch {} finally { resolving = false; }
  }

  // ---- cutting room -------------------------------------------------------
  $("st-cut").addEventListener("click", async () => {
    Sound.tap();
    const snap = await get(ref(db, "story/cutting")).catch(() => null);
    const all = (snap && snap.val()) || {};
    const list = Object.entries(all).map(([id, c]) => ({ id, ...c }))
      .sort((a, b) => (b.seq || 0) - (a.seq || 0) || (b.votes || 0) - (a.votes || 0));
    const body = list.length
      ? list.map(c => `<div class="st-cutrow"><span class="st-seq">${c.seq}</span>
          <div><p class="st-text">${esc(c.text)}</p>
          <div class="st-meta"><span class="st-who">${esc(c.name)}</span><span class="st-tally">${c.votes || 0} vote${c.votes === 1 ? "" : "s"}</span></div></div></div>`).join("")
      : `<p class="hint">Nothing here yet — every line proposed so far made it into the story.</p>`;
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = `<div class="modal-card">
      <h3>✂️ The Cutting Room</h3>
      <p class="tinynote">Lines that were proposed but lost the vote. They're not canon — but they're not forgotten.</p>
      <div class="st-cutlist">${body}</div>
      <button class="btn-primary full" id="st-cutclose">Back to the story</button></div>`;
    document.body.appendChild(m);
    m.querySelector("#st-cutclose").addEventListener("click", () => m.remove());
    m.addEventListener("click", (ev) => { if (ev.target === m) m.remove(); });
  });

  // ---- leave --------------------------------------------------------------
  $("st-leave").addEventListener("click", () => {
    localStorage.removeItem(LSK.name); localStorage.removeItem(LSK.eid);
    _detach(); _stop();
    NAME = ""; EID = ""; canon = {}; live = null;
    show("screen-gate");
  });
}

export function unmount() {
  if (authUnsub) { authUnsub(); authUnsub = null; }
  _detach(); _stop();
  document.querySelectorAll(".modal").forEach(m => m.remove());
}
