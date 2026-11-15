// Placeholder sounds, made with the browser's audio engine so there are no
// sound files to load. Swap these for real samples later if you like.

let audio = null;

function ctx() {
  try {
    audio = audio || new AudioContext();
    if (audio.state === 'suspended') {
      audio.resume();
    }
    return audio;
  } catch {
    // No audio available. Not important.
    return null;
  }
}

function tone(freq, start, dur, gain = 0.08, type = 'sine') {
  const a = ctx();
  if (!a) {
    return;
  }
  const o = a.createOscillator();
  const g = a.createGain();
  const t0 = a.currentTime + start;
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0);
  o.stop(t0 + dur);
}

export function beep(freq, dur) {
  tone(freq, 0, dur);
}

// A party popper: a short burst of noise with a thump under it.
export function pop(delay = 0) {
  const a = ctx();
  if (!a) {
    return;
  }
  const len = Math.floor(a.sampleRate * 0.18);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  }
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1800;
  const g = a.createGain();
  g.gain.value = 0.25;
  src.connect(filter).connect(g).connect(a.destination);
  src.start(a.currentTime + delay);
  tone(140, delay, 0.12, 0.12, 'triangle');
}

// A short rising tune for the end of a board.
export function fanfare() {
  [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.13, 0.22, 0.09, 'triangle'));
  tone(1047, 0.6, 0.5, 0.08, 'triangle');
  tone(784, 0.6, 0.5, 0.05, 'triangle');
}

// Two quick rising notes for a "Nice".
export function nice() {
  tone(660, 0, 0.09, 0.07, 'triangle');
  tone(990, 0.08, 0.14, 0.07, 'triangle');
}

// A sad falling "wah wah wah" for "I am stupid".
export function stupid() {
  [392, 370, 349].forEach((f, i) => tone(f, i * 0.22, 0.24, 0.06, 'sawtooth'));
  tone(330, 0.66, 0.6, 0.06, 'sawtooth');
}

// A short low growl for the angry face.
export function angry() {
  const a = ctx();
  if (!a) {
    return;
  }
  const o = a.createOscillator();
  const wobble = a.createOscillator();
  const depth = a.createGain();
  const g = a.createGain();
  const t0 = a.currentTime;
  o.type = 'sawtooth';
  o.frequency.value = 95;
  // A fast wobble in pitch makes it sound like a growl.
  wobble.frequency.value = 28;
  depth.gain.value = 18;
  wobble.connect(depth).connect(o.frequency);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.09, t0 + 0.04);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);
  o.connect(g).connect(a.destination);
  o.start(t0);
  wobble.start(t0);
  o.stop(t0 + 0.46);
  wobble.stop(t0 + 0.46);
}
