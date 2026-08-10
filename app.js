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
  { id: "skwibble", name: "Skwibble",        ico: "🎨", accent: "#2451a9", lb: "skwibble", desc: "Draw & guess. One person sketches the secret word, everyone else races to guess it.", migrated: true },
  { id: "bingo",    name: "Bingo",           ico: "🎱", accent: "#2451a9", lb: "bingo",    desc: "Classic bingo, hosted live. First to complete a line shouts BINGO.", migrated: true },
  { id: "trivia",   name: "Trivia",          ico: "🧠", accent: "#7c5cff", lb: "trivia",   desc: "Live quiz across 7 categories. Answer fast — the quicker you're right, the more points.", migrated: true },
  { id: "logo",     name: "Guess the Logo",  ico: "🔎", accent: "#12b5a6", lb: "logos",    desc: "A brand logo zooms out stage by stage — the earlier you name it, the more points.", migrated: true },
  { id: "grader",   name: "Top of the Class", ico: "🎓", accent: "#e5484d", lb: "grader",   desc: "Climb from Grade 1 up to Grade 8 across school subjects. How high can you go?", migrated: true },
];

let current = null; // mounted game module

const GAME_THEME = `
.game-shell,.wrap,.card,.modal{position:relative;z-index:1}
.btn-primary{background:linear-gradient(180deg,color-mix(in srgb,var(--brand-accent) 90%,#fff),var(--brand-accent));box-shadow:0 8px 20px color-mix(in srgb,var(--brand-accent) 32%,transparent);border:none}
.btn-primary:hover{transform:translateY(-1px);filter:brightness(1.04)}
.card{background:rgba(255,255,255,.93);backdrop-filter:blur(8px);box-shadow:0 20px 46px rgba(20,40,80,.16);border:1px solid rgba(255,255,255,.6)}
.choice{box-shadow:0 6px 16px rgba(20,40,80,.08)}
.choice:hover:not(:disabled){border-color:var(--brand-accent);transform:translateY(-2px)}
.choice.chosen{border-color:var(--brand-accent);background:color-mix(in srgb,var(--brand-accent) 8%,#fff)}
.badge,.qprog .on{color:var(--brand-accent)}
`;
let _homeBtn, _gameBg, _theme;
function setGameChrome(on, accent) {
  if (!_homeBtn) { _homeBtn = document.createElement("button"); _homeBtn.id = "ls-home-btn"; _homeBtn.innerHTML = "\u2190 Games"; _homeBtn.title = "Back to Game Night"; _homeBtn.addEventListener("click", () => { location.hash = ""; }); document.body.appendChild(_homeBtn); }
  if (!_gameBg) { _gameBg = document.createElement("div"); _gameBg.className = "game-bg"; _gameBg.innerHTML = '<span class="ga"></span><span class="gb"></span>'; document.body.appendChild(_gameBg); }
  if (!_theme) { _theme = document.createElement("style"); _theme.id = "ls-game-theme"; _theme.textContent = GAME_THEME; }
  if (on) {
    document.documentElement.style.setProperty("--brand-accent", accent);
    _homeBtn.style.display = "flex"; _gameBg.style.display = "block";
    document.head.appendChild(_theme); // move to end so it beats the game's own styles.css
  } else {
    document.documentElement.style.removeProperty("--brand-accent");
    _homeBtn.style.display = "none"; _gameBg.style.display = "none";
    if (_theme && _theme.parentNode) _theme.remove();
  }
}

async function route() {
  const id = (location.hash.replace(/^#\/?/, "").split("?")[0]) || "";
  if (current) { try { current.unmount(); } catch {} current = null; }
  document.querySelectorAll(".modal").forEach(m => m.remove());
  if (!id) { setGameChrome(false); renderHub(); return; }
  const g = GAMES.find(x => x.id === id);
  if (!g) { location.hash = ""; return; }
  if (!g.migrated) { location.href = g.id + "/"; return; }
  app.innerHTML = `<div class="wrap"><p class="hint">Loading ${esc(g.name)}…</p></div>`;
  try {
    const mod = await import(`./mod/${g.id}.js?v=3`);
    const root = document.createElement("div"); app.innerHTML = ""; app.appendChild(root);
    mod.mount(root, { db, auth, Audio, goHome: () => { location.hash = ""; } });
    current = mod;
    setGameChrome(true, g.accent);
  } catch (e) {
    setGameChrome(false); app.innerHTML = `<div class="wrap"><p class="hint">Couldn't load that game. <a href="#/">Back to games</a></p></div>`;
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

const initials = (n) => ((n||"?").trim().split(/\s+/).map(w=>w[0]||"").slice(0,2).join("").toUpperCase() || "?");
const avColor = (n) => { let h=0; for (const c of (n||"x")) h=(h*31+c.charCodeAt(0))>>>0; return `hsl(${h%360},58%,52%)`; };

function renderHub() {
  const tiles = GAMES.map(g => {
    const href = g.migrated ? `#/${g.id}` : `${g.id}/`;
    const bg = `linear-gradient(150deg, ${g.accent}, color-mix(in srgb, ${g.accent} 60%, #0e1630))`;
    return `<a class="tile" href="${href}" style="background:${bg}">
      <div class="ico">${g.ico}</div><h3>${esc(g.name)}</h3><p>${esc(g.desc)}</p>
      <span class="play">Play &rarr;</span></a>`;
  }).join("");
  const pills = [["all","All games"], ...GAMES.map(g=>[g.lb, g.ico+" "+g.name])]
    .map(([k,l])=>`<button class="pill${k===gameFilter?" on":""}" data-game="${k}">${esc(l)}</button>`).join("");
  const tabs = [["week","This Week"],["month","Month"],["year","Year"],["all","All-Time"]]
    .map(([k,l])=>`<button class="tab${k===scope?" on":""}" data-scope="${k}">${l}</button>`).join("");
  app.innerHTML = `
    <div class="hub-bg"><span class="o1"></span><span class="o2"></span><span class="o3"></span></div>
    <div class="hub-wrap">
      <div class="hero">
        <div class="hero-badge">&#127918; Legal Soft</div>
        <h1 class="hero-title">Game Night</h1>
        <p class="hero-sub">Pick a game, rally your team, and climb the leaderboard.</p>
        <div class="hero-chips"><span>&#127919; ${GAMES.length} games</span><span>&#127942; Live leaderboard</span><span>&#9889; Any device</span></div>
      </div>
      <div class="tiles">${tiles}</div>
      <div class="lb-card">
        <h2 class="lb-title">&#127942; Leaderboard</h2>
        <div id="tabs" class="lb-tabs">${tabs}</div>
        <div id="filters" class="lb-filters">${pills}</div>
        <div id="champ" class="champ"></div>
        <div id="podium"></div>
        <div id="rows" class="lb-rows"></div>
      </div>
    </div>`;
  app.querySelector("#tabs").addEventListener("click", e=>{const b=e.target.closest(".tab");if(!b)return;scope=b.dataset.scope;renderHub();});
  app.querySelector("#filters").addEventListener("click", e=>{const b=e.target.closest(".pill");if(!b)return;gameFilter=b.dataset.game;renderHub();});
  renderBoard();
}
async function renderBoard() {
  const rows=app.querySelector("#rows"), champ=app.querySelector("#champ"), pod=app.querySelector("#podium"); if(!rows) return;
  const data=await loadScope(scope);
  const arr=Object.values(data).map(e=>({...e,_p:pointsFor(e)})).filter(e=>e._p>0).sort((a,b)=>b._p-a._p||(b.wins||0)-(a.wins||0));
  if(!arr.length){ pod.innerHTML=""; champ.innerHTML=""; rows.innerHTML=`<div class="dash-empty">No scores ${scopeLabel[scope]} yet &mdash; go play a game! &#127918;</div>`; return; }
  const fname=gameFilter==="all"?"Overall":(GAMES.find(g=>g.lb===gameFilter)?.name||gameFilter);
  champ.innerHTML=`&#128081; <b>${esc(arr[0].name||"—")}</b> leads ${esc(fname)} ${scopeLabel[scope]} &middot; ${arr[0]._p} pts`;
  const medals=["&#129351;","&#129352;","&#129353;"]; const top=arr.slice(0,3);
  const podCard=(e,i)=>`<div class="pod pod-${i+1}"><div class="medal">${medals[i]}</div><div class="pav" style="background:${avColor(e.name)}">${initials(e.name)}</div><div class="pname">${esc(e.name||"—")}</div><div class="ppts">${e._p}</div><div class="bar"></div></div>`;
  pod.innerHTML = top.length>=2 ? `<div class="podium">${top.map(podCard).join("")}</div>` : "";
  const start = top.length>=2 ? 3 : 0;
  rows.innerHTML = arr.slice(start,25).map((e,idx)=>{ const rank=start+idx+1;
    return `<div class="lb-row"><span class="rk">${rank}</span><span class="lb-av" style="background:${avColor(e.name)}">${initials(e.name)}</span><span class="lb-nm">${esc(e.name||"—")}<small>${e.games||0} game${(e.games||0)!==1?"s":""} &middot; ${e.wins||0} win${(e.wins||0)!==1?"s":""}</small></span><span class="lb-pt">${e._p}</span></div>`;
  }).join("");
}
onAuthStateChanged(auth, u => { if (u && !location.hash.replace(/^#\/?/, "")) renderBoard(); });
route();
