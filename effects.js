// Things that only exist on each player's own screen: confetti, poppers,
// the winner banner, and the thumbs up for a "Nice". Nothing here is stored.
// The shared data only says what happened, and every browser draws its own
// celebration from that.

import { pop, fanfare, nice as niceSound, stupid as stupidSound, angry as angrySound } from './sound.js';
import { REACTIONS } from './reactions.js';

const SOUNDS = { nice: niceSound, stupid: stupidSound, angry: angrySound };

const COLORS = ['#d8433b', '#2f9e55', '#2f6fd6', '#e2b21a', '#e87ba4', '#9085e9'];

const canvas = document.getElementById('fx');
const ctx = canvas.getContext('2d');
let particles = [];
let running = false;
let lastT = 0;
let spawnUntil = 0;
let spawnRate = 0;
let spawnCarry = 0;

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function fit() {
  // Cap the pixel ratio. Confetti does not need more, and phones stay smooth.
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h };
}

// Fewer and smaller pieces on a small screen, more on a big one.
function scale() {
  const area = window.innerWidth * window.innerHeight;
  return Math.max(0.4, Math.min(1.25, area / (1280 * 800)));
}

function piece(x, y, vx, vy, size) {
  return {
    x,
    y,
    vx,
    vy,
    w: size * (0.6 + Math.random() * 0.8),
    h: size * (0.35 + Math.random() * 0.4),
    rot: Math.random() * Math.PI * 2,
    vr: (Math.random() - 0.5) * 12,
    sway: Math.random() * Math.PI * 2,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    round: Math.random() < 0.25,
    life: 0,
    max: 3.5 + Math.random() * 2.5,
  };
}

// A popper in one corner, firing toward the middle of the screen.
function burst(corner, count) {
  const { w, h } = fit();
  const size = Math.max(6, Math.min(w, h) * 0.014);
  const x = corner.includes('l') ? 0 : w;
  const y = corner.includes('t') ? 0 : h;
  const aim = Math.atan2(h * 0.45 - y, w / 2 - x);
  const speed = Math.hypot(w, h) * 0.75;
  for (let i = 0; i < count; i++) {
    const a = aim + (Math.random() - 0.5) * 1.0;
    const v = speed * (0.35 + Math.random() * 0.75);
    particles.push(piece(x, y, Math.cos(a) * v, Math.sin(a) * v, size));
  }
}

function rain(count) {
  const { w, h } = fit();
  const size = Math.max(6, Math.min(w, h) * 0.014);
  for (let i = 0; i < count; i++) {
    particles.push(piece(Math.random() * w, -20, (Math.random() - 0.5) * 80, 60 + Math.random() * 160, size));
  }
}

function frame(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
  lastT = t;
  const { w, h } = fit();
  ctx.clearRect(0, 0, w, h);

  if (t < spawnUntil) {
    spawnCarry += spawnRate * dt;
    const n = Math.floor(spawnCarry);
    spawnCarry -= n;
    rain(n);
  }

  for (const p of particles) {
    p.life += dt;
    p.vy += 520 * dt;
    // Air drag, stronger for fast pieces, so popper pieces slow and drift.
    const drag = Math.exp(-1.6 * dt);
    p.vx *= drag;
    p.vy = Math.min(p.vy * Math.exp(-0.9 * dt), 380);
    p.sway += 4 * dt;
    p.x += (p.vx + Math.sin(p.sway) * 40) * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    const fade = Math.min(1, (p.max - p.life) / 0.6);
    ctx.save();
    ctx.globalAlpha = Math.max(0, fade);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    if (p.round) {
      ctx.beginPath();
      ctx.arc(0, 0, p.h * 0.7, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Squash the width as it turns, like paper flipping in the air.
      ctx.scale(Math.cos(p.sway), 1);
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    }
    ctx.restore();
  }
  particles = particles.filter((p) => p.life < p.max && p.y < h + 40);

  if (particles.length > 0 || t < spawnUntil) {
    requestAnimationFrame(frame);
  } else {
    running = false;
    ctx.clearRect(0, 0, w, h);
    canvas.hidden = true;
  }
}

function start() {
  canvas.hidden = false;
  if (!running) {
    running = true;
    lastT = performance.now();
    requestAnimationFrame(frame);
  }
}

let bannerTimer = null;

function hideBanner() {
  document.getElementById('winner-banner').hidden = true;
  clearTimeout(bannerTimer);
}

document.getElementById('winner-banner').addEventListener('click', hideBanner);

// The end of a board: the winner's name, poppers from all four corners, and
// confetti falling from the top.
export function celebrate(title, subtitle) {
  const banner = document.getElementById('winner-banner');
  banner.querySelector('.who').textContent = title;
  banner.querySelector('.what').textContent = subtitle;
  banner.hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(hideBanner, 9000);

  fanfare();
  if (reducedMotion()) {
    return;
  }
  const s = scale();
  const corners = ['bl', 'br', 'tl', 'tr'];
  [0, 500, 1100].forEach((delay, round) => {
    setTimeout(() => {
      corners.forEach((c) => burst(c, Math.round(34 * s)));
      start();
    }, delay);
    pop(delay / 1000);
    pop(delay / 1000 + 0.07 + round * 0.01);
  });
  spawnRate = 70 * s;
  spawnUntil = performance.now() + 4500;
  start();
}

// A reaction that pops up over the board and fades: the emoji, the phrase
// if the reaction has one, and who sent it.
export function showReaction(key, name) {
  const r = REACTIONS.find((x) => x.key === key);
  if (!r) {
    return;
  }
  if (SOUNDS[key]) {
    SOUNDS[key]();
  }
  const wrap = document.querySelector('.board-wrap');
  const el = document.createElement('div');
  el.className = `nice-pop react-${key}`;
  el.style.left = `${18 + Math.random() * 64}%`;
  el.style.top = `${28 + Math.random() * 40}%`;
  const face = document.createElement('span');
  face.className = 'thumb';
  face.textContent = r.emoji;
  el.append(face);
  if (r.phrase) {
    const phrase = document.createElement('span');
    phrase.className = 'phrase';
    phrase.textContent = r.phrase;
    el.append(phrase);
  }
  const who = document.createElement('span');
  who.className = 'by';
  who.textContent = name;
  el.append(who);
  wrap.appendChild(el);
  const remove = () => el.remove();
  el.addEventListener('animationend', remove);
  // In case animations are turned off.
  setTimeout(remove, 3200);
}
