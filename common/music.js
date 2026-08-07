// ===========================================================================
// common/music.js — procedural, looping background music for game nights.
// Generated live with the Web Audio API (no audio files, nothing copyrighted).
// Upbeat game-show / arcade energy: four-on-the-floor kick, backbeat clap,
// driving bass, chord stabs, and a bright arpeggio lead over an 8-bar
// progression so it stays lively instead of looping into monotony.
//
//   Music.start()  – begin looping (call after a user gesture)
//   Music.stop()   – fade out and stop
//   Music.toggle() – mute/unmute, returns new muted state
//   Music.isMuted()
//
// Tweak MUSIC_VOLUME if you want it louder/quieter under the voices.
// ===========================================================================
const MUSIC_VOLUME = 0.22;            // overall backing-track level (0–1)
const BPM = 126;
const STEP = 60 / BPM / 4;            // one sixteenth note, in seconds
const LOOKAHEAD = 0.12;              // seconds of audio scheduled ahead
const TICK = 25;                     // scheduler wake-up interval (ms)

// note frequencies
const N = {
  C2: 65.41, F2: 87.31, G2: 98.00, A2: 110.00,
  F3: 174.61, G3: 196.00, A3: 220.00, B3: 246.94, C4: 261.63, D4: 293.66, E4: 329.63,
  F4: 349.23, G4: 392.00, A4: 440.00, C5: 523.25, E5: 659.25, G5: 783.99,
};
// 8-bar progression (chord per bar): C G Am F | Am F C G  → familiar & upbeat
const PROG = [
  { bass: N.C2, tri: [N.C4, N.E4, N.G4], arp: [N.C4, N.E4, N.G4, N.C5] },
  { bass: N.G2, tri: [N.G3, N.B3, N.D4], arp: [N.G3, N.B3, N.D4, N.G4] },
  { bass: N.A2, tri: [N.A3, N.C4, N.E4], arp: [N.A3, N.C4, N.E4, N.A4] },
  { bass: N.F2, tri: [N.F3, N.A3, N.C4], arp: [N.F3, N.A3, N.C4, N.F4] },
  { bass: N.A2, tri: [N.A3, N.C4, N.E4], arp: [N.A4, N.E4, N.C4, N.E4] },
  { bass: N.F2, tri: [N.F3, N.A3, N.C4], arp: [N.F4, N.C4, N.A3, N.C4] },
  { bass: N.C2, tri: [N.C4, N.E4, N.G4], arp: [N.G4, N.E4, N.C4, N.G4] },
  { bass: N.G2, tri: [N.G3, N.B3, N.D4], arp: [N.D4, N.G4, N.B3, N.D4] },
];
const LOOP_STEPS = PROG.length * 16;

let ctx = null, master = null, noiseBuf = null, timer = null;
let stepIdx = 0, nextTime = 0, running = false;
let muted = localStorage.getItem("ls_music_muted") === "1";

function ensure() {
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return false; }
    master = ctx.createGain();
    master.gain.value = muted ? 0.0001 : MUSIC_VOLUME;
    master.connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 0.4);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") ctx.resume();
  return true;
}
function tone(type, freq, t, dur, gain, glideTo) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
  o.connect(g); g.connect(master);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t); o.stop(t + dur + 0.02);
}
function noise(t, dur, gain, hpFreq) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = hpFreq;
  const g = ctx.createGain();
  s.connect(hp); hp.connect(g); g.connect(master);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.start(t); s.stop(t + dur + 0.02);
}
const kick = (t) => tone("sine", 150, t, 0.16, 0.55, 45);
const hat  = (t) => noise(t, 0.03, 0.05, 7000);
const clap = (t) => { noise(t, 0.11, 0.16, 1400); noise(t + 0.012, 0.09, 0.12, 1600); };

function scheduleStep(step, t) {
  const bar = Math.floor(step / 16) % PROG.length;
  const s = step % 16;             // 0..15 within the bar
  const ch = PROG[bar];
  // drums
  if (s % 4 === 0) kick(t);                       // four-on-the-floor
  if (s === 4 || s === 12) clap(t);               // backbeat
  if (s % 2 === 1) hat(t);                         // offbeat hats
  // bass — eighth notes, octave pops for bounce
  if (s % 2 === 0) {
    const oct = (s === 6 || s === 14) ? 2 : 1;
    tone("triangle", ch.bass * oct, t, STEP * 1.7, 0.16);
  }
  // chord stabs on each beat
  if (s % 4 === 0) ch.tri.forEach((f) => tone("triangle", f, t, 0.13, 0.05));
  // bright arpeggio lead every sixteenth
  const lead = ch.arp[step % ch.arp.length];
  tone("square", lead, t, STEP * 0.9, 0.045);
}
function scheduler() {
  if (!ctx) return;
  while (nextTime < ctx.currentTime + LOOKAHEAD) {
    scheduleStep(stepIdx, nextTime);
    nextTime += STEP;
    stepIdx = (stepIdx + 1) % LOOP_STEPS;
  }
}
function applyMute() {
  if (!master || !ctx) return;
  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), now);
  master.gain.exponentialRampToValueAtTime(muted ? 0.0001 : MUSIC_VOLUME, now + 0.25);
}

export const Music = {
  start() {
    if (running) return;
    if (!ensure()) return;
    running = true;
    stepIdx = 0; nextTime = ctx.currentTime + 0.06;
    applyMute();
    timer = setInterval(scheduler, TICK);
  },
  stop() {
    running = false;
    if (timer) { clearInterval(timer); timer = null; }
    if (master && ctx) { const now = ctx.currentTime; master.gain.cancelScheduledValues(now); master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), now); master.gain.exponentialRampToValueAtTime(0.0001, now + 0.3); }
  },
  toggle() { muted = !muted; localStorage.setItem("ls_music_muted", muted ? "1" : "0"); applyMute(); return muted; },
  isMuted() { return muted; },
};
