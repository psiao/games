// ===========================================================================
// common/audio.js — unified game audio: music (3 selectable styles) + SFX +
// winners celebration + a floating control panel (music/effects on-off, volume,
// style). All generated live with the Web Audio API — original & royalty-free.
// Settings persist across games via localStorage.
//
//   Audio.ensure()            resume context (call on a user gesture)
//   Audio.sfx(name)           'correct','wrong','tap','round','tick','reveal','join'
//   Audio.celebrate()         winners fanfare + victory loop
//   Audio.music.start()/stop()  gameplay music (respects the panel toggle)
//   Audio.mountPanel()        inject the floating control panel
//   Audio.toggleSfx()/sfxMuted()   (used by legacy mute shims)
// ===========================================================================
const LS = {
  musicOn:  () => localStorage.getItem("ls_aud_music") !== "0",
  sfxOn:    () => localStorage.getItem("ls_aud_sfx") !== "0",
  musicVol: () => { const v = parseFloat(localStorage.getItem("ls_aud_mvol")); return isNaN(v) ? 0.5 : v; },
  sfxVol:   () => { const v = parseFloat(localStorage.getItem("ls_aud_svol")); return isNaN(v) ? 0.8 : v; },
  style:    () => localStorage.getItem("ls_aud_style") || "chiptune",
  set: (k, v) => localStorage.setItem(k, v),
};

let ctx, master, musicBus, sfxBus, noiseBuf;
let schedTimer = null, step = 0, nextT = 0, STEP = 0, LOOP = 128;
let musicWanted = false, mode = "normal"; // normal | victory

function ensure() {
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return false; }
    master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.gain.value = LS.musicOn() ? LS.musicVol() : 0.0001; musicBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = LS.sfxOn() ? LS.sfxVol() : 0.0001; sfxBus.connect(master);
    const len = Math.floor(ctx.sampleRate * 0.5); noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") ctx.resume();
  return true;
}
document.addEventListener("click", () => ensure(), { once: true });
document.addEventListener("keydown", () => ensure(), { once: true });

const F = (m) => 440 * Math.pow(2, (m - 69) / 12);
function tone(bus, type, freq, t, dur, gain, glideTo) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
  o.connect(g); g.connect(bus);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t); o.stop(t + dur + 0.03);
}
function noise(bus, t, dur, gain, hp) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = hp || 6000;
  const g = ctx.createGain(); s.connect(f); f.connect(g); g.connect(bus);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.start(t); s.stop(t + dur + 0.02);
}

// ---- SFX ----
function sfx(name) {
  if (!LS.sfxOn() || !ensure()) return;
  const t = ctx.currentTime;
  switch (name) {
    case "correct": [72, 76, 79, 84].forEach((m, i) => tone(sfxBus, "square", F(m), t + i * 0.06, 0.14, 0.32)); tone(sfxBus, "triangle", F(84), t + 0.24, 0.28, 0.2); break;
    case "wrong":   tone(sfxBus, "sawtooth", F(55), t, 0.18, 0.32, F(50)); tone(sfxBus, "sawtooth", F(50), t + 0.13, 0.30, 0.32, F(43)); break;
    case "tap":     tone(sfxBus, "square", F(76), t, 0.06, 0.22); break;
    case "round":   tone(sfxBus, "square", F(67), t, 0.09, 0.2); tone(sfxBus, "square", F(74), t + 0.08, 0.12, 0.2); break;
    case "tick":    tone(sfxBus, "square", F(88), t, 0.04, 0.12); break;
    case "join":    tone(sfxBus, "sine", F(72), t, 0.09, 0.22); tone(sfxBus, "sine", F(79), t + 0.08, 0.12, 0.22); break;
    case "reveal":  tone(sfxBus, "sine", F(64), t, 0.09, 0.2); tone(sfxBus, "sine", F(71), t + 0.07, 0.09, 0.2); tone(sfxBus, "sine", F(76), t + 0.14, 0.18, 0.2); break;
    default:        tone(sfxBus, "square", F(72), t, 0.08, 0.2);
  }
}
function celebrate() {
  if (!ensure()) return;
  const t = ctx.currentTime;
  if (LS.sfxOn()) {
    [72, 76, 79, 84, 88, 91].forEach((m, i) => tone(sfxBus, "square", F(m), t + i * 0.085, 0.16, 0.28));
    [72, 76, 79, 84].forEach(m => { tone(sfxBus, "sawtooth", F(m), t + 0.6, 1.4, 0.16); tone(sfxBus, "triangle", F(m), t + 0.6, 1.4, 0.12); });
    for (let i = 0; i < 10; i++) noise(sfxBus, t + 0.6 + i * 0.03, 0.05, 0.10, 9000);
    noise(sfxBus, t + 0.6, 0.4, 0.14, 2000);
  }
  // victory loop
  musicWanted = true; mode = "victory"; startScheduler("victory");
}

// ---- music styles ----
const CH = { C: [60, 64, 67], G: [55, 59, 62], Am: [57, 60, 64], F: [53, 57, 60], Dm: [50, 53, 57], Em: [52, 55, 59] };
function kick(t) { tone(musicBus, "sine", 150, t, 0.16, 0.5, 45); }
function hat(t, g) { noise(musicBus, t, 0.03, g || 0.05, 7000); }
function snare(t) { noise(musicBus, t, 0.12, 0.16, 1500); tone(musicBus, "triangle", 180, t, 0.1, 0.12); }

function chiptuneStep(s, t) {
  const bar = Math.floor(s / 16) % 8, prog = [CH.C, CH.Am, CH.F, CH.G, CH.C, CH.Am, CH.F, CH.G][bar], inb = s % 16, root = prog[0];
  const arp = [prog[0], prog[1], prog[2], prog[1] + 12, prog[2], prog[1], prog[0] + 12, prog[2]];
  if ([0, 2, 3, 4, 6, 8, 10, 11, 12, 14].includes(inb)) tone(musicBus, "square", F(arp[Math.floor(inb / 2) % arp.length] + 12), t, STEP * 1.1, 0.13);
  if (inb % 2 === 0) { const oct = (inb === 6 || inb === 14) ? 12 : 0; tone(musicBus, "triangle", F(root - 24 + oct), t, STEP * 1.6, 0.22); }
  if (inb % 2 === 1) hat(t, 0.04);
  if (inb === 0 || inb === 8) noise(musicBus, t, 0.05, 0.06, 4000);
}
function technoStep(s, t) {
  const bar = Math.floor(s / 16) % 8, prog = [CH.Am, CH.Am, CH.F, CH.F, CH.C, CH.C, CH.G, CH.G][bar], inb = s % 16, root = prog[0];
  if (inb % 4 === 0) kick(t);
  if (inb === 4 || inb === 12) snare(t);
  if (inb % 2 === 1) hat(t, 0.045);
  if (inb % 2 === 0) { const oct = (inb === 6 || inb === 14) ? 12 : 0; tone(musicBus, "sawtooth", F(root - 24 + oct), t, STEP * 1.4, 0.14, F(root - 24 + oct)); }
  tone(musicBus, "square", F([prog[0] + 12, prog[1] + 12, prog[2] + 12, prog[1] + 24][s % 4]), t, STEP * 0.85, 0.05);
  if (inb % 4 === 0) prog.forEach(m => tone(musicBus, "triangle", F(m), t, 0.12, 0.045));
}
function synthwaveStep(s, t) {
  const bar = Math.floor(s / 16) % 8, prog = [CH.Am, CH.F, CH.C, CH.G, CH.Am, CH.Dm, CH.Em, CH.G][bar], inb = s % 16, root = prog[0];
  if (inb % 4 === 0) kick(t);
  if (inb === 4 || inb === 12) snare(t);
  if (inb % 2 === 1) hat(t, 0.035);
  if (inb % 2 === 0) tone(musicBus, "sawtooth", F(root - 24), t, STEP * 1.5, 0.16, F(root - 24));
  if (inb === 0) prog.forEach(m => tone(musicBus, "triangle", F(m), t, STEP * 15, 0.03));
  const mel = [root + 12, null, root + 15, root + 19, null, root + 15, root + 12, null, root + 17, null, root + 15, root + 12, null, root + 10, root + 12, null][inb];
  if (mel) tone(musicBus, "square", F(mel), t, STEP * 1.3, 0.09);
}
function victoryStep(s, t) { // bright celebratory loop
  const bar = Math.floor(s / 16) % 4, prog = [CH.C, CH.G, CH.Am, CH.F][bar], inb = s % 16, root = prog[0];
  if (inb % 4 === 0) kick(t);
  if (inb === 4 || inb === 12) snare(t);
  if (inb % 2 === 1) hat(t, 0.05);
  const arp = [prog[0] + 12, prog[1] + 12, prog[2] + 12, prog[0] + 24, prog[2] + 12, prog[1] + 12];
  tone(musicBus, "square", F(arp[s % arp.length]), t, STEP * 0.9, 0.11);
  if (inb % 2 === 0) tone(musicBus, "triangle", F(root - 24), t, STEP * 1.5, 0.2);
  if (inb === 0) prog.forEach(m => tone(musicBus, "triangle", F(m), t, 0.16, 0.05));
}
const STYLES = { chiptune: { bpm: 150, fn: chiptuneStep }, techno: { bpm: 128, fn: technoStep }, synthwave: { bpm: 116, fn: synthwaveStep }, victory: { bpm: 140, fn: victoryStep } };

function startScheduler(styleName) {
  if (!ensure()) return;
  if (schedTimer) { clearInterval(schedTimer); schedTimer = null; }
  const st = STYLES[styleName] || STYLES.chiptune; STEP = 60 / st.bpm / 4; const fn = st.fn;
  LOOP = styleName === "victory" ? 64 : 128; step = 0; nextT = ctx.currentTime + 0.06;
  schedTimer = setInterval(() => { if (!ctx) return; while (nextT < ctx.currentTime + 0.12) { fn(step, nextT); nextT += STEP; step = (step + 1) % LOOP; } }, 25);
}
function stopScheduler() { if (schedTimer) { clearInterval(schedTimer); schedTimer = null; } }
function refreshMusic() { // called when settings/lifecycle change
  const shouldPlay = musicWanted && LS.musicOn();
  if (shouldPlay && !schedTimer) startScheduler(mode === "victory" ? "victory" : LS.style());
  else if (!shouldPlay && schedTimer) stopScheduler();
}
function applyVol() {
  if (!ctx) return;
  musicBus.gain.setTargetAtTime(LS.musicOn() ? LS.musicVol() : 0.0001, ctx.currentTime, 0.03);
  sfxBus.gain.setTargetAtTime(LS.sfxOn() ? LS.sfxVol() : 0.0001, ctx.currentTime, 0.03);
}

const musicApi = {
  start() { musicWanted = true; mode = "normal"; ensure(); if (LS.musicOn()) startScheduler(LS.style()); },
  stop()  { musicWanted = false; stopScheduler(); },
};

// ---- control panel ----
let panelMounted = false;
function mountPanel() {
  if (panelMounted) return; panelMounted = true;
  const style = document.createElement("style");
  style.textContent = `
  #ls-audio-fab{position:fixed;right:16px;bottom:16px;width:46px;height:46px;border-radius:50%;border:none;cursor:pointer;background:#1948A3;color:#fff;font-size:20px;box-shadow:0 6px 18px rgba(20,40,80,.3);z-index:9998}
  #ls-audio-pop{position:fixed;right:16px;bottom:72px;width:250px;background:#fff;border:1px solid #e3e9f2;border-radius:14px;box-shadow:0 18px 44px rgba(20,40,80,.22);padding:14px;z-index:9999;display:none;font-family:'Segoe UI',system-ui,sans-serif;color:#0d0d0d}
  #ls-audio-pop.open{display:block}
  #ls-audio-pop h4{margin:0 0 10px;font-size:12px;text-transform:uppercase;letter-spacing:.09em;color:#6b7280}
  #ls-audio-pop .arow{display:flex;align-items:center;justify-content:space-between;margin:8px 0;font-size:14px;font-weight:600}
  #ls-audio-pop select,#ls-audio-pop input[type=range]{width:100%}
  #ls-audio-pop select{padding:7px;border:1px solid #e3e9f2;border-radius:8px;margin:2px 0 8px;font-size:13px}
  #ls-audio-pop .sw{position:relative;width:40px;height:22px;border-radius:999px;background:#cbd3de;cursor:pointer;transition:.15s;flex:0 0 auto}
  #ls-audio-pop .sw.on{background:#1f9d55}
  #ls-audio-pop .sw::after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:.15s}
  #ls-audio-pop .sw.on::after{left:20px}
  #ls-audio-pop hr{border:none;border-top:1px solid #eef2f8;margin:12px 0}
  #ls-audio-pop label{font-size:11px;color:#6b7280;font-weight:700}
  #ls-audio-pop input[type=range]{accent-color:#1948A3}`;
  document.head.appendChild(style);
  const fab = document.createElement("button"); fab.id = "ls-audio-fab"; fab.innerHTML = "&#9835;"; fab.title = "Sound settings";
  const pop = document.createElement("div"); pop.id = "ls-audio-pop";
  pop.innerHTML = `
    <h4>&#127925; Music</h4>
    <div class="arow"><span>Music</span><div class="sw" id="ls-sw-music"></div></div>
    <label>Style</label>
    <select id="ls-style"><option value="chiptune">Chiptune (Mario-ish)</option><option value="techno">Techno (arcade EDM)</option><option value="synthwave">Synthwave (retro)</option></select>
    <label>Volume</label><input type="range" id="ls-mvol" min="0" max="100">
    <hr>
    <h4>&#128266; Sound effects</h4>
    <div class="arow"><span>Effects</span><div class="sw" id="ls-sw-sfx"></div></div>
    <label>Volume</label><input type="range" id="ls-svol" min="0" max="100">`;
  document.body.appendChild(fab); document.body.appendChild(pop);
  const $ = (id) => pop.querySelector(id);
  const swM = $("#ls-sw-music"), swS = $("#ls-sw-sfx"), selStyle = $("#ls-style"), mvol = $("#ls-mvol"), svol = $("#ls-svol");
  const sync = () => { swM.classList.toggle("on", LS.musicOn()); swS.classList.toggle("on", LS.sfxOn()); selStyle.value = LS.style(); mvol.value = Math.round(LS.musicVol() * 100); svol.value = Math.round(LS.sfxVol() * 100); };
  sync();
  fab.addEventListener("click", () => { ensure(); pop.classList.toggle("open"); });
  swM.addEventListener("click", () => { LS.set("ls_aud_music", LS.musicOn() ? "0" : "1"); sync(); applyVol(); refreshMusic(); });
  swS.addEventListener("click", () => { LS.set("ls_aud_sfx", LS.sfxOn() ? "0" : "1"); sync(); applyVol(); if (LS.sfxOn()) sfx("tap"); });
  selStyle.addEventListener("change", () => { LS.set("ls_aud_style", selStyle.value); if (musicWanted && LS.musicOn() && mode === "normal") startScheduler(LS.style()); });
  mvol.addEventListener("input", () => { LS.set("ls_aud_mvol", (mvol.value / 100).toFixed(2)); applyVol(); });
  svol.addEventListener("input", () => { LS.set("ls_aud_svol", (svol.value / 100).toFixed(2)); applyVol(); });
  document.addEventListener("click", (e) => { if (!pop.contains(e.target) && e.target !== fab) pop.classList.remove("open"); });
}

// ---- legacy shim helpers ----
function toggleSfx() { LS.set("ls_aud_sfx", LS.sfxOn() ? "0" : "1"); applyVol(); return !LS.sfxOn(); }
function sfxMuted() { return !LS.sfxOn(); }

export const Audio = { ensure, sfx, celebrate, music: musicApi, mountPanel, toggleSfx, sfxMuted };
