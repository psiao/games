// ===========================================================================
// LS Game Night — single-page shell: hash router + hub + shared chrome.
//   #/            -> hub (tiles + cross-game leaderboard)
//   #/trivia etc. -> loads ./mod/<id>.js and mounts it into #app
// Shared services (Firebase, Audio panel) live here, edit-once for all games.
// ===========================================================================
import { auth, db } from "./common/firebase-config.js";
import { Audio } from "./common/audio.js";
import { signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

const app = document.getElementById("app");
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
Audio.mountPanel();
signInAnonymously(auth).catch(() => {});

// migrated:true  -> served by this SPA at #/<id>
// migrated:false -> still the standalone page in /<id>/ (linked until migrated)
const GAMES = [
  { id: "skwibble", name: "Skwibble",        ico: "🎨", accent: "#2451a9", lb: "skwibble", desc: "Draw & guess. One person sketches the secret word, everyone else races to guess it.", migrated: false },
  { id: "bingo",    name: "Bingo",           ico: "🎱", accent: "#2451a9", lb: "bingo",    desc: "Classic bingo, hosted live. First to complete a line shouts BINGO.", migrated: false },
  { id: "trivia",   name: "Trivia",          ico: "🧠", accent: "#7c5cff", lb: "trivia",   desc: "Live quiz across 7 categories. Answer fast — the quicker you're right, the more points.", migrated: true },
  { id: "logo",     name: "Guess the Logo",  ico: "🔎", accent: "#12b5a6", lb: "logos",    desc: "A brand logo zooms out stage by stage — the earlier you name it, the more points.", migrated: false },
  { id: "grader",   name: "School Grader",   ico: "🎓", accent: "#e5484d", lb: "grader",   desc: "Climb Grade 1 → 5 across school subjects. Are you smarter than a 5th grader?", migrated: false },
];

let current = null; // mounted game module

async function route() {
  const id = (location.hash.replace(/^#\/?/, "").split("?")[0]) || "";
  if (current) { try { current.unmount(); } catch {} current = null; }
  document.querySelectorAll(".modal").forEach(m => m.remove());
  if (!id) { renderHub(); return; }
  const g = GAMES.find(x => x.id === id);
  if (!g) { location.hash = ""; return; }
  if (!g.migrated) { location.href = g.id + "/"; return; }
  app.innerHTML = `<div class="wrap"><p class="hint">Loading ${esc(g.name)}…</p></div>`;
  try {
    const mod = await import(`./mod/${g.id}.js?v=1`);
    const root = document.createElement("div"); app.innerHTML = ""; app.appendChild(root);
    mod.mount(root, { db, auth, Audio, goHome: () => { location.hash = ""; } });
    current = mod;
  } catch (e) {
    app.innerHTML = `<div class="wrap"><p class="hint">Couldn't load that game. <a href="#/">Back to games</a></p></div>`;
  }
}
window.addEventListener("hashchange", route);

// ---- hub ----
let scope = "week", gameFilter = "all", cache = {};
function weekKey(ts){const dt=new Date(ts);const u=new Date(Date.UTC(dt.getFullYear(),dt.getMonth(),dt.getDate()));const day=u.getUTCDay()||7;u.setUTCDate(u.getUTCDate()+4-day);const y=new Date(Date.UTC(u.getUTCFullYear(),0,1));const wk=Math.ceil((((u-y)/86400000)+1)/7);return u.getUTCFullYear()+"-W"+String(wk).padStart(2,"0");}
function scopeKey(s){const d=new Date();const y=String(d.getFullYear());if(s==="all")return"all";if(s==="year")return y;if(s==="month")return y+"-"+String(d.getMonth()+1).padStart(2,"0");return weekKey(Date.now());}
const scopeLabel={week:"this week",month:"this month",year:"this year",all:"all-time"};
async function loadScope(s){const key=scopeKey(s);if(cache[key])return cache[key];try{const snap=await get(ref(db,"lb/"+key));cache[key]=snap.val()||{};}catch{cache[key]={};}return cache[key];}
function pointsFor(e){ return gameFilter==="all" ? (e.points||0) : ((e.byGame&&e.byGame[gameFilter])||0); }

function renderHub() {
  const tiles = GAMES.map(g => {
    const href = g.migrated ? `#/${g.id}` : `${g.id}/`;
    return `<a class="tile" href="${href}" style="--acc:${g.accent}">
      <div class="blob" style="background:color-mix(in srgb,${g.accent} 13%,transparent)"></div>
      <div class="ico">${g.ico}</div><h3>${esc(g.name)}</h3><p>${esc(g.desc)}</p>
      <span class="play" style="background:linear-gradient(180deg,${g.accent},color-mix(in srgb,${g.accent} 78%,black))">Play ${esc(g.name)} →</span>
    </a>`;
  }).join("");
  const pills = [["all", "All games"], ...GAMES.map(g => [g.lb, g.ico + " " + g.name])]
    .map(([k, lbl]) => `<button class="pill${k === gameFilter ? " on" : ""}" data-game="${k}">${esc(lbl)}</button>`).join("");
  const tabs = [["week", "This Week"], ["month", "Month"], ["year", "Year"], ["all", "All-Time"]]
    .map(([k, lbl]) => `<button class="tab${k === scope ? " on" : ""}" data-scope="${k}">${lbl}</button>`).join("");
  app.innerHTML = `<div class="hub-wrap">
    <div class="hub-head"><div class="brandbar" style="justify-content:center"><div class="logo">LS</div></div>
      <h1>Game Night</h1><p class="tagline">Legal Soft engagement games</p></div>
    <div class="tiles">${tiles}</div>
    <div class="card">
      <div class="lb-head"><h2 style="margin:0;font-size:20px">🏆 Leaderboard</h2></div>
      <div id="tabs" class="lb-tabs">${tabs}</div>
      <div id="filters" class="lb-filters">${pills}</div>
      <div id="champ" class="champ"></div>
      <div id="rows" class="lb-rows"></div>
    </div></div>`;
  injectHubStyles();
  app.querySelector("#tabs").addEventListener("click", e => { const b = e.target.closest(".tab"); if (!b) return; scope = b.dataset.scope; renderHub(); });
  app.querySelector("#filters").addEventListener("click", e => { const b = e.target.closest(".pill"); if (!b) return; gameFilter = b.dataset.game; renderHub(); });
  renderBoard();
}
async function renderBoard() {
  const rows = app.querySelector("#rows"), champ = app.querySelector("#champ"); if (!rows) return;
  const data = await loadScope(scope);
  const arr = Object.values(data).map(e => ({ ...e, _p: pointsFor(e) })).filter(e => e._p > 0).sort((a, b) => b._p - a._p || (b.wins || 0) - (a.wins || 0));
  if (!arr.length) { rows.innerHTML = `<div class="dash-empty">No scores ${scopeLabel[scope]} yet — go play a game! 🎮</div>`; champ.innerHTML = ""; return; }
  const medals = ["🥇", "🥈", "🥉"];
  const fname = gameFilter === "all" ? "Overall" : (GAMES.find(g => g.lb === gameFilter)?.name || gameFilter);
  champ.innerHTML = `👑 ${esc(fname)} champion ${scopeLabel[scope]}: <b>${esc(arr[0].name || "—")}</b> · ${arr[0]._p} pts`;
  rows.innerHTML = arr.slice(0, 25).map((e, i) => `<div class="sb-row ${i === 0 ? "sb-top" : ""}"><span class="sb-rank">${i < 3 ? medals[i] : i + 1}</span><span class="sb-name">${esc(e.name || "—")}<div style="font-size:11px;color:var(--muted);font-weight:500">${e.games || 0} game${(e.games || 0) !== 1 ? "s" : ""} · ${e.wins || 0} win${(e.wins || 0) !== 1 ? "s" : ""}</div></span><span class="sb-pts">${e._p}</span></div>`).join("");
}
let hubStyled = false;
function injectHubStyles() {
  if (hubStyled) return; hubStyled = true;
  const s = document.createElement("style");
  s.textContent = `.lb-head{margin-bottom:12px}.lb-tabs,.lb-filters{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
  .tab,.pill{border:1px solid var(--line);background:var(--white);border-radius:999px;padding:6px 12px;font-size:12.5px;font-weight:700;color:var(--muted);cursor:pointer}
  .tab.on,.pill.on{background:var(--brand-accent);color:#fff;border-color:var(--brand-accent)}
  .champ{background:var(--brand-surface);border-radius:12px;padding:10px 14px;font-size:13.5px;margin-bottom:12px}
  .lb-rows{display:grid;gap:7px}`;
  document.head.appendChild(s);
}

onAuthStateChanged(auth, u => { if (u && !location.hash.replace(/^#\/?/, "")) renderBoard(); });
route();
