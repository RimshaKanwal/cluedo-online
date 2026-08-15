// Lightweight sound effects synthesized with the Web Audio API — no asset
// files needed. Sounds only play after a user gesture (browser policy), which
// is fine since the first sounds follow clicks.

let ctx = null;
let enabled = localStorage.getItem("cluedo-sound") !== "off";

function audioCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) ctx = new AC();
  }
  if (ctx && ctx.state === "suspended") ctx.resume();
  return ctx;
}

function beep(freq, start, dur, { type = "sine", gain = 0.08 } = {}) {
  const ac = audioCtx();
  if (!ac) return;
  const t0 = ac.currentTime + start;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(start, dur, gain = 0.06) {
  const ac = audioCtx();
  if (!ac) return;
  const t0 = ac.currentTime + start;
  const buf = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = gain;
  src.connect(g).connect(ac.destination);
  src.start(t0);
}

// Real audio clips (not synthesized) — one plays at random whenever
// someone's accusation turns out wrong.
const WRONG_ACCUSATION_CLIPS = ["/sounds/wrong-laugh-1.mp3", "/sounds/wrong-laugh-2.mp3", "/sounds/wrong-laugh-3.mp3"];
const WIN_CLIP = "/sounds/anime-wow.mp3";

function playClip(src, volume = 0.6) {
  const audio = new Audio(src);
  audio.volume = volume;
  audio.play().catch(() => {}); // ignore autoplay-policy rejections
}

export const sfx = {
  dice() {
    if (!enabled) return;
    noise(0, 0.12, 0.05);
    noise(0.09, 0.08, 0.04);
    beep(180, 0.16, 0.08, { type: "square", gain: 0.05 });
  },
  move() {
    if (!enabled) return;
    beep(520, 0, 0.07, { gain: 0.05 });
  },
  show() {
    if (!enabled) return;
    beep(660, 0, 0.1);
    beep(990, 0.09, 0.12);
  },
  pass() {
    if (!enabled) return;
    beep(300, 0, 0.14, { type: "sawtooth", gain: 0.05 });
    beep(200, 0.1, 0.16, { type: "sawtooth", gain: 0.05 });
  },
  turn() {
    if (!enabled) return;
    beep(540, 0, 0.1);
    beep(760, 0.1, 0.12);
  },
  win() {
    if (!enabled) return;
    [523, 659, 784, 1047].forEach((f, i) => beep(f, i * 0.12, 0.18, { gain: 0.09 }));
    setTimeout(() => playClip(WIN_CLIP, 0.7), 480); // right after the little fanfare
  },
  // Playful two-tone alarm sweep for the "your turn" nag popup.
  siren() {
    if (!enabled) return;
    for (let i = 0; i < 3; i++) {
      beep(700, i * 0.3, 0.15, { type: "square", gain: 0.06 });
      beep(1000, i * 0.3 + 0.15, 0.15, { type: "square", gain: 0.06 });
    }
  },
  wrongAccusation() {
    if (!enabled) return;
    const clip = WRONG_ACCUSATION_CLIPS[Math.floor(Math.random() * WRONG_ACCUSATION_CLIPS.length)];
    playClip(clip);
  },
};

export function soundEnabled() {
  return enabled;
}

export function toggleSound() {
  enabled = !enabled;
  localStorage.setItem("cluedo-sound", enabled ? "on" : "off");
  if (enabled) sfx.turn();
  return enabled;
}
