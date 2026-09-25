import { firebaseConfig } from './config.js';
import {
  N,
  COLORS,
  WALL_N,
  WALL_E,
  WALL_S,
  WALL_W,
  slide,
  slidePath,
  parseMoves,
  applyMoves,
  robotOnTarget,
  MAX_SHORT_MOVES,
} from './board.js';
import {
  DEFAULT_TIMER_MS,
  roundKey,
  attemptKey,
  deriveRound,
  makeNextRound,
  tokensWon,
  remainingTargets,
  moveCount,
  boardFor,
  diagQuadrantsOf,
  otherPlayableTarget,
  MIN_CALL,
  SOLO_MAX_MOVES,
} from './game.js';

// ---------------------------------------------------------------------------
// Setup

const params = new URLSearchParams(location.search);
const configured = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('PASTE');
const LOCAL = params.has('local') || !configured;

// In local test mode every tab is its own player, so identity lives in
// sessionStorage. Online, it lives in localStorage so it survives reloads.
const idStore = LOCAL ? window.sessionStorage : window.localStorage;

function storeGet(key) {
  try {
    return idStore.getItem(key);
  } catch {
    return null;
  }
}

function storeSet(key, value) {
  try {
    idStore.setItem(key, value);
  } catch {
    // Private mode or blocked storage. The game still works for this visit.
  }
}

const backend = LOCAL
  ? (await import('./backend-local.js')).createBackend()
  : (await import('./backend-firebase.js')).createBackend(firebaseConfig);

// A shorter timer is only allowed in local test mode (?local&timer=5).
const TIMER_MS = LOCAL && params.get('timer') ? Number(params.get('timer')) * 1000 : DEFAULT_TIMER_MS;

function randomId(len, alphabet) {
  let s = '';
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  for (const v of buf) {
    s += alphabet[v % alphabet.length];
  }
  return s;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let uid = storeGet('rr-uid');
if (!uid) {
  uid = randomId(12, 'abcdefghijklmnopqrstuvwxyz0123456789');
  storeSet('rr-uid', uid);
}

const $ = (sel) => document.querySelector(sel);

const S = {
  roomId: null,
  room: null,
  vm: null,
  confirm: null,
  confirmTimer: null,
  typed: '',
  lastBid: null,
  selected: null,
  drag: null,
  shown: null,
  to: null,
  anim: null,
  animRound: null,
  dirty: true,
  lastPhase: null,
  lastTimerStart: null,
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function getName() {
  return (storeGet('rr-name') || '').trim();
}

// ---------------------------------------------------------------------------
// Colors and symbols

const ROBOT_HEX = {
  red: '#d8433b',
  green: '#2f9e55',
  blue: '#2f6fd6',
  yellow: '#e2b21a',
  black: '#26262a',
  white: '#f4f3ef',
};

function starPath() {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 8.6 : 3.7;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(10 + r * Math.cos(a)).toFixed(2)} ${(10.6 + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

// Shapes in a 20x20 box. Used both for inline SVG and canvas Path2D.
const SHAPES = {
  circle: 'M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0Z',
  triangle: 'M10 2.2L18.2 17H1.8Z',
  square: 'M3.5 3.5H16.5V16.5H3.5Z',
  star: starPath(),
};
const VORTEX = [
  ['red', 'M10 10L10 1.5A8.5 8.5 0 0 1 18.5 10Z'],
  ['green', 'M10 10L18.5 10A8.5 8.5 0 0 1 10 18.5Z'],
  ['blue', 'M10 10L10 18.5A8.5 8.5 0 0 1 1.5 10Z'],
  ['yellow', 'M10 10L1.5 10A8.5 8.5 0 0 1 10 1.5Z'],
];

function symbolSVG(target, size = 18) {
  let body;
  if (target.symbol === 'vortex') {
    body = VORTEX.map(([c, d]) => `<path d="${d}" fill="${ROBOT_HEX[c]}"/>`).join('');
  } else {
    body = `<path d="${SHAPES[target.symbol]}" fill="${ROBOT_HEX[target.color]}"/>`;
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 20 20" aria-hidden="true">${body}</svg>`;
}

function targetName(t) {
  return t.symbol === 'vortex' ? 'vortex (any robot)' : `${t.color} ${t.symbol}`;
}

// ---------------------------------------------------------------------------
// Lobby and routing

function roomFromHash() {
  const m = location.hash.match(/^#([A-Za-z0-9]{5})$/);
  return m ? m[1].toUpperCase() : null;
}

function showLobby(id) {
  $('#game').hidden = true;
  $('#lobby').hidden = false;
  $('#name').value = getName();
  $('#lobby-create').hidden = !!id;
  $('#lobby-join').hidden = !id;
  $('#join-hash').textContent = id ? `Join room ${id}` : 'Join room';
  $('#lobby-note').textContent = LOCAL
    ? 'Local test mode. Open this page in more tabs to add players.'
    : 'Race your friends to the shortest robot path.';
}

function readName() {
  const name = $('#name').value.trim().slice(0, 16);
  if (!name) {
    $('#lobby-error').textContent = 'Pick a name first.';
    return null;
  }
  storeSet('rr-name', name);
  $('#lobby-error').textContent = '';
  return name;
}

function newGame(diagQuadrants, whiteRobot) {
  for (;;) {
    const game = {
      id: randomId(8, CODE_ALPHABET),
      seed: Math.floor(Math.random() * 2 ** 31),
      timerMs: TIMER_MS,
      diagQuadrants,
      whiteRobot: !!whiteRobot,
    };
    const first = makeNextRound({ ...game, rounds: {} }, Math.random);
    if (first) {
      game.rounds = { [roundKey(0)]: first };
      return game;
    }
  }
}

$('#create').addEventListener('click', async () => {
  if (!readName()) {
    return;
  }
  const id = randomId(5, CODE_ALPHABET);
  const diagQuadrants = Number($('#opt-diag').value);
  const white = $('#opt-white').checked;
  const ok = await backend.transaction(`rooms/${id}/game`, (cur) =>
    cur === null ? newGame(diagQuadrants, white) : undefined,
  );
  if (ok) {
    location.hash = id;
  } else {
    $('#lobby-error').textContent = 'Could not create a room. Try again.';
  }
});

function joinCode() {
  if (!readName()) {
    return;
  }
  const code = $('#code').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) {
    $('#lobby-error').textContent = 'Room codes have 5 characters.';
    return;
  }
  location.hash = code;
}

$('#join').addEventListener('click', joinCode);
$('#code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    joinCode();
  }
});
$('#join-hash').addEventListener('click', () => {
  if (readName()) {
    route();
  }
});
$('#name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (roomFromHash()) {
      $('#join-hash').click();
    } else {
      $('#create').click();
    }
  }
});

let unsubscribe = null;

function enterRoom(id) {
  if (S.roomId === id) {
    return;
  }
  if (unsubscribe) {
    unsubscribe();
  }
  S.roomId = id;
  S.room = null;
  S.shown = null;
  S.to = null;
  $('#lobby').hidden = true;
  $('#game').hidden = false;
  $('#room-code').textContent = id;
  $('#mode').textContent = LOCAL ? 'Local test mode' : '';
  backend.update(`rooms/${id}/players/${uid}`, { name: getName() });
  backend.trackOnline(`rooms/${id}/players/${uid}/online`);
  unsubscribe = backend.subscribe(`rooms/${id}`, (data) => {
    S.room = data;
    render();
  });
}

function route() {
  const id = roomFromHash();
  if (id && getName()) {
    enterRoom(id);
  } else {
    showLobby(id);
  }
}

window.addEventListener('hashchange', route);

// ---------------------------------------------------------------------------
// Actions

function roomPath(rest) {
  return `rooms/${S.roomId}/${rest}`;
}

function fresh() {
  const game = S.room && S.room.game;
  return game ? deriveRound(game, backend.now()) : null;
}

function roundPath(vm) {
  return roomPath(`game/rounds/${roundKey(vm.n)}`);
}

function placeBid(n) {
  const vm = fresh();
  if (!vm || !(vm.phase === 'thinking' || vm.phase === 'bidding')) {
    return;
  }
  if (!Number.isInteger(n) || n < MIN_CALL || n > 99) {
    return;
  }
  const mine = vm.bidding.bids.get(uid);
  if (mine && mine.n === n) {
    return;
  }
  // A tap fires both pointerdown and click. Only send one of them.
  if (S.lastBid && S.lastBid.n === n && Date.now() - S.lastBid.at < 1000) {
    return;
  }
  S.lastBid = { n, at: Date.now() };
  backend.push(`${roundPath(vm)}/bids`, { uid, n, t: backend.TS });
}

function retract() {
  const vm = fresh();
  if (!vm || vm.phase !== 'bidding' || !vm.bidding.bids.has(uid)) {
    return;
  }
  S.lastBid = null;
  backend.push(`${roundPath(vm)}/bids`, { uid, n: 0, t: backend.TS });
}

function canMove(vm) {
  return vm && vm.phase === 'demo' && vm.demonstrator === uid && !vm.reached;
}

// A single caller is not held to their number, so they get more room.
function moveLimit(vm) {
  return vm.solo ? SOLO_MAX_MOVES : vm.bid;
}

function doMove(idx, dir) {
  const vm = fresh();
  if (!canMove(vm) || moveCount(vm.moves) >= moveLimit(vm)) {
    return;
  }
  const p = slide(vm.board, vm.robots, idx, dir);
  if (p.x === vm.robots[idx].x && p.y === vm.robots[idx].y) {
    return;
  }
  const moves = vm.moves + idx + dir;
  const robots = applyMoves(vm.board, vm.start, moves);
  const a = `attempts/${attemptKey(vm.attemptIdx)}`;
  if (robotOnTarget(robots, vm.target)) {
    // A single caller of MIN_CALL cut everyone's timer short. If they needed
    // more moves, nobody scores and the target goes back in the pile,
    // unless no other target is left to play.
    const count = moveCount(moves);
    const missed =
      vm.solo &&
      vm.bid === MIN_CALL &&
      count > MIN_CALL &&
      otherPlayableTarget(S.room.game, vm.start, vm.target.id);
    if (missed) {
      backend.update(roundPath(vm), {
        [`${a}/moves`]: moves,
        [`${a}/result`]: 'miscount',
        [`${a}/bid`]: vm.bid,
        skippedBy: uid,
      });
    } else {
      backend.update(roundPath(vm), {
        [`${a}/moves`]: moves,
        [`${a}/result`]: 'success',
        [`${a}/bid`]: vm.bid,
        winner: uid,
        final: robots,
      });
      beep(880, 0.15);
    }
  } else {
    backend.set(`${roundPath(vm)}/${a}/moves`, moves);
  }
}

function setMoves(moves) {
  const vm = fresh();
  if (!canMove(vm)) {
    return;
  }
  backend.set(`${roundPath(vm)}/attempts/${attemptKey(vm.attemptIdx)}/moves`, moves);
}

function failAttempt() {
  const vm = fresh();
  if (!vm || vm.phase !== 'demo') {
    return;
  }
  const a = `attempts/${attemptKey(vm.attemptIdx)}`;
  backend.update(roundPath(vm), { [`${a}/moves`]: vm.moves, [`${a}/result`]: 'fail' });
}

function nextRound() {
  const game = S.room && S.room.game;
  const vm = fresh();
  if (!vm) {
    return;
  }
  const next = vm.phase === 'done' ? nextRoundFor(game, vm) : makeNextRound(game, Math.random);
  if (!next) {
    return;
  }
  S.selected = null;
  backend.transaction(roomPath(`game/rounds/${roundKey(vm.n + 1)}`), (cur) => (cur === null ? next : undefined));
}

function startNewGame(diagQuadrants, whiteRobot) {
  const currentId = S.room && S.room.game ? S.room.game.id : null;
  S.selected = null;
  S.newBoardMenu = false;
  backend.transaction(roomPath('game'), (cur) => (cur && cur.id !== currentId ? undefined : newGame(diagQuadrants, whiteRobot)));
}

// The next round, worked out once per finished round. Finding out which
// targets are too short takes a search, so it is not redone every frame.
function nextRoundFor(game, vm) {
  const key = `${game.id}:${vm.n}:${vm.winner || ''}`;
  if (!S.next || S.next.key !== key) {
    S.next = { key, value: makeNextRound(game, Math.random) };
  }
  return S.next.value;
}

// Buttons that need a second tap within 3 seconds.
function confirmOr(key, fn) {
  if (S.confirm === key) {
    S.confirm = null;
    clearTimeout(S.confirmTimer);
    fn();
  } else {
    S.confirm = key;
    clearTimeout(S.confirmTimer);
    S.confirmTimer = setTimeout(() => {
      S.confirm = null;
      render();
    }, 3000);
  }
  render();
}

const panel = $('#panel');

// Calls react on pointerdown so a fast tap counts at the earliest moment.
panel.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('[data-bid]');
  if (b && !b.disabled) {
    placeBid(Number(b.dataset.bid));
  }
});

panel.addEventListener('click', (e) => {
  const bidBtn = e.target.closest('[data-bid]');
  if (bidBtn && !bidBtn.disabled) {
    placeBid(Number(bidBtn.dataset.bid));
    return;
  }
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) {
    return;
  }
  const vm = fresh();
  switch (b.dataset.act) {
    case 'retract':
      retract();
      break;
    case 'skip':
      confirmOr('skip', nextRound);
      break;
    case 'undo':
      setMoves(vm.moves.slice(0, -2));
      break;
    case 'reset':
      setMoves('');
      break;
    case 'giveup':
      confirmOr('giveup', failAttempt);
      break;
    case 'markfail':
      confirmOr('markfail', failAttempt);
      break;
    case 'next':
      nextRound();
      break;
    case 'newgame':
    case 'start':
      startNewGame(
        Number(b.closest('#action').querySelector('select').value),
        b.closest('#action').querySelector('input[type=checkbox]').checked,
      );
      break;
  }
});

$('#new-board').addEventListener('click', () => {
  S.newBoardMenu = !S.newBoardMenu;
  $('#nb-diag').value = '2';
  $('#nb-white').checked = false;
  render();
});
$('#new-board-menu').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) {
    return;
  }
  if (b.dataset.newboard === 'cancel') {
    S.newBoardMenu = false;
    render();
  } else if (b.dataset.newboard === 'start') {
    startNewGame(Number($('#nb-diag').value), $('#nb-white').checked);
  }
});

$('#copy-link').addEventListener('click', async () => {
  const btn = $('#copy-link');
  try {
    await navigator.clipboard.writeText(location.href);
    btn.textContent = 'Copied';
  } catch {
    btn.textContent = `Code: ${S.roomId}`;
  }
  setTimeout(() => {
    btn.textContent = 'Copy invite link';
  }, 2000);
});

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || $('#game').hidden) {
    return;
  }
  const vm = fresh();
  if (!vm) {
    return;
  }
  if (vm.phase === 'thinking' || vm.phase === 'bidding') {
    if (/^[0-9]$/.test(e.key) && S.typed.length < 2) {
      S.typed += e.key;
    } else if (e.key === 'Backspace') {
      S.typed = S.typed.slice(0, -1);
    } else if (e.key === 'Escape') {
      S.typed = '';
    } else if (e.key === 'Enter' && S.typed) {
      placeBid(Number(S.typed));
      S.typed = '';
    } else {
      return;
    }
    e.preventDefault();
    render();
    return;
  }
  if (canMove(vm)) {
    const dirs = { ArrowUp: 'u', ArrowRight: 'r', ArrowDown: 'd', ArrowLeft: 'l', w: 'u', d: 'r', s: 'd', a: 'l' };
    if (/^[1-6]$/.test(e.key) && Number(e.key) <= vm.robots.length) {
      S.selected = Number(e.key) - 1;
      S.dirty = true;
    } else if (dirs[e.key] && S.selected !== null) {
      doMove(S.selected, dirs[e.key]);
    } else if (e.key === 'Backspace' || (e.key === 'z' && (e.ctrlKey || e.metaKey))) {
      setMoves(vm.moves.slice(0, -2));
    } else {
      return;
    }
    e.preventDefault();
  }
});

// ---------------------------------------------------------------------------
// Sound. A short beep when the timer starts and when it runs out.

let audio = null;
function beep(freq, dur) {
  try {
    audio = audio || new AudioContext();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.08, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + dur);
  } catch {
    // No audio available. Not important.
  }
}

// ---------------------------------------------------------------------------
// Panel rendering. Each section is only rewritten when its HTML changes,
// so buttons are not replaced under a finger in the middle of a tap.

const cache = new Map();
function setHTML(el, html) {
  if (cache.get(el) !== html) {
    cache.set(el, html);
    el.innerHTML = html;
  }
}

function playerName(players, id) {
  const p = players[id];
  return p && p.name ? p.name : 'Someone';
}

// Picker for how many quadrants get diagonal walls. Two by default.
function diagPickHTML() {
  const opts = [0, 1, 2, 3, 4].map((n) => `<option${n === 2 ? ' selected' : ''}>${n}</option>`).join('');
  return (
    `<label class="diag-pick muted">Diagonal quadrants <select>${opts}</select></label>` +
    '<label class="diag-pick muted"><input type="checkbox"> White robot</label>'
  );
}

function render() {
  if (!S.room || !S.roomId) {
    return;
  }
  const game = S.room.game;
  const players = S.room.players || {};
  if (!game) {
    setHTML($('#status'), 'No game in this room yet.');
    setHTML(
      $('#action'),
      `<div class="actions">${diagPickHTML()}<button class="primary" data-act="start">Start a game</button></div>`,
    );
    setHTML($('#calls'), '');
    setHTML($('#scores'), '');
    return;
  }
  const now = backend.now();
  const vm = deriveRound(game, now);
  S.vm = vm;

  // Sound cues on phase changes.
  if (S.lastPhase === 'thinking' && vm.phase === 'bidding') {
    beep(660, 0.12);
  } else if (S.lastPhase === 'bidding' && vm.phase !== 'bidding') {
    beep(440, 0.35);
    if (navigator.vibrate) {
      navigator.vibrate(150);
    }
  }
  S.lastPhase = vm.phase;
  if (vm.phase !== 'demo') {
    S.selected = null;
  }

  renderStatus(vm, players);
  renderAction(vm, players, game);
  renderCalls(vm, players);
  renderScores(game, players);
  renderTimer(vm, now);
  updateBoard(vm, game);
  $('#new-board').hidden = !!S.newBoardMenu;
  $('#new-board-menu').hidden = !S.newBoardMenu;
  const dq = diagQuadrantsOf(game);
  const kind = [];
  if (dq) {
    kind.push(`Diagonals in ${dq} quadrant${dq === 1 ? '' : 's'}`);
  }
  if (game.whiteRobot) {
    kind.push('White robot');
  }
  $('#board-kind').textContent = kind.join(' · ');
}

function renderStatus(vm, players) {
  const t = vm.target;
  let head;
  let sub;
  switch (vm.phase) {
    case 'thinking':
      head = `Find the ${targetName(t)}`;
      sub = 'Call a number to start the timer.';
      break;
    case 'bidding': {
      const best = vm.bidding.order[0];
      head = `Find the ${targetName(t)}`;
      sub = vm.bidding.fast
        ? `${esc(playerName(players, best.uid))} called ${MIN_CALL}. Nobody can beat that.`
        : `Lowest call: ${best.n} by ${esc(playerName(players, best.uid))}`;
      break;
    }
    case 'demo': {
      const who = esc(playerName(players, vm.demonstrator));
      head = `${who} shows ${vm.bid}`;
      if (vm.solo && vm.bid === MIN_CALL) {
        sub = `Only caller. More than ${MIN_CALL} moves sends the target back in the pile.`;
      } else if (vm.solo) {
        sub = 'Only caller, so any number of moves counts.';
      } else {
        sub = vm.demonstrator === uid ? 'Your turn to show the moves.' : 'Watch the robots move.';
      }
      break;
    }
    case 'done':
      if (vm.winner) {
        const k = moveCount(vm.moves);
        head = `${esc(playerName(players, vm.winner))} takes the ${targetName(t)}`;
        sub = `Solved in ${k} moves${vm.bid && vm.bid !== k ? ` after calling ${vm.bid}` : ''}.`;
      } else if (vm.skippedBy) {
        head = `${esc(playerName(players, vm.skippedBy))} needed ${moveCount(vm.moves)} moves`;
        sub = `That is more than the ${MIN_CALL} called, so nobody scores. The target goes back in the pile.`;
      } else {
        head = 'Nobody made it';
        sub = 'The target goes back in the pile.';
      }
      break;
  }
  setHTML($('#status'), `${symbolSVG(t, 30)}<div>${head}<span class="sub">${sub}</span></div>`);
}

function renderAction(vm, players, game) {
  const el = $('#action');
  if (vm.phase === 'thinking' || vm.phase === 'bidding') {
    const mine = vm.bidding.bids.get(uid);
    let pad = '';
    // Calls start at 5, since shorter targets are never drawn.
    for (let n = MIN_CALL; n < MIN_CALL + 24; n++) {
      pad += `<button data-bid="${n}" class="${mine && mine.n === n ? 'mine' : ''}">${n}</button>`;
    }
    const typed = S.typed ? ` Typing: <b>${esc(S.typed)}</b>` : '';
    const buttons = [];
    if (mine) {
      buttons.push('<button data-act="retract">Take back my call</button>');
    }
    if (vm.phase === 'thinking') {
      buttons.push(
        `<button data-act="skip">${S.confirm === 'skip' ? 'Tap again to skip' : 'Skip this target'}</button>`,
      );
    }
    setHTML(
      el,
      `<p class="hint">Tap how many moves you need. On a keyboard, type the number and press Enter.${typed}</p>` +
        `<div class="pad">${pad}</div><div class="actions">${buttons.join('')}</div>`,
    );
    return;
  }

  if (vm.phase === 'demo') {
    const k = moveCount(vm.moves);
    const count = vm.solo
      ? `<div class="big">${k} move${k === 1 ? '' : 's'}</div><p class="hint">Called ${vm.bid}.</p>`
      : `<div class="big">${k} / ${vm.bid}</div>`;
    if (vm.demonstrator === uid) {
      const out = k >= moveLimit(vm) ? '<p class="hint bad">Out of moves. Undo, start over, or give up.</p>' : '';
      setHTML(
        el,
        count +
          `<p class="hint">Drag a robot in the direction it should go. On a keyboard, press 1 to ${vm.robots.length} to pick a robot and use the arrow keys.</p>` +
          out +
          '<div class="actions">' +
          `<button data-act="undo" ${k === 0 ? 'disabled' : ''}>Undo</button>` +
          `<button data-act="reset" ${k === 0 ? 'disabled' : ''}>Start over</button>` +
          `<button data-act="giveup" class="danger">${S.confirm === 'giveup' ? 'Tap again to give up' : 'Give up'}</button>` +
          '</div>',
      );
    } else {
      const p = players[vm.demonstrator];
      const offline = !p || p.online === false;
      const mark = offline
        ? `<p class="hint">${esc(playerName(players, vm.demonstrator))} seems to be offline.</p>` +
          `<button data-act="markfail">${S.confirm === 'markfail' ? 'Tap again to confirm' : 'Move on to the next caller'}</button>`
        : '';
      setHTML(el, `${count}${mark}`);
    }
    return;
  }

  // Round is over.
  const left = remainingTargets(game);
  const next = nextRoundFor(game, vm);
  if (!next) {
    const won = tokensWon(game);
    let best = 0;
    for (const list of won.values()) {
      best = Math.max(best, list.length);
    }
    const winners = [...won.entries()].filter(([, l]) => l.length === best).map(([id]) => esc(playerName(players, id)));
    const why =
      left === 0
        ? 'All targets are taken.'
        : `The ${left} target${left === 1 ? '' : 's'} left can all be reached in ${MAX_SHORT_MOVES} moves or fewer.`;
    const result =
      winners.length === 0
        ? 'Nobody won a token.'
        : `${winners.join(' and ')} ${winners.length > 1 ? 'share the win' : 'wins'} with ${best} token${best === 1 ? '' : 's'}.`;
    setHTML(
      el,
      `<p class="big">Game over</p><p class="hint">${why}</p><p>${result}</p>` +
        `<div class="actions">${diagPickHTML()}<button class="primary" data-act="newgame">Play a new board</button></div>`,
    );
  } else {
    setHTML(
      el,
      `<div class="actions"><button class="primary" data-act="next">Next target</button></div>` +
        `<p class="hint">${left} target${left === 1 ? '' : 's'} left on this board.</p>`,
    );
  }
}

function renderCalls(vm, players) {
  const order = vm.bidding.order;
  if (order.length === 0) {
    setHTML($('#calls'), vm.phase === 'done' ? '' : '<h3>Calls</h3><p class="hint">No calls yet.</p>');
    return;
  }
  const items = order.map((b, i) => {
    const cls = [];
    if (b.uid === uid) {
      cls.push('me');
    }
    if (vm.failed.includes(b.uid)) {
      cls.push('failed');
    }
    if (vm.phase === 'demo' && vm.demonstrator === b.uid) {
      cls.push('active');
    }
    if (vm.phase === 'done' && vm.winner === b.uid) {
      cls.push('active');
    }
    return `<li class="${cls.join(' ')}"><span class="muted">${i + 1}.</span><span class="who">${esc(
      playerName(players, b.uid),
    )}</span><span class="n">${b.n}</span></li>`;
  });
  setHTML($('#calls'), `<h3>Calls</h3><ol class="calls">${items.join('')}</ol>`);
}

function renderScores(game, players) {
  const board = boardFor(game);
  const won = tokensWon(game);
  const ids = Object.keys(players);
  ids.sort((a, b) => (won.get(b) || []).length - (won.get(a) || []).length || playerName(players, a).localeCompare(playerName(players, b)));
  const items = ids.map((id) => {
    const list = won.get(id) || [];
    const chips = list.map((tid) => symbolSVG(board.targets.find((t) => t.id === tid), 14)).join('');
    const on = players[id].online !== false;
    return `<li class="${id === uid ? 'me' : ''}"><span class="dot ${on ? 'on' : ''}"></span><span class="who">${esc(
      playerName(players, id),
    )}</span><span class="tokens">${chips}<span class="count">${list.length}</span></span></li>`;
  });
  setHTML($('#scores'), `<h3>Players</h3><ul class="scores">${items.join('')}</ul>`);
}

function renderTimer(vm, now) {
  const bar = $('#timer-bar');
  let frac = 0;
  if (vm.phase === 'bidding') {
    frac = Math.max(0, (vm.bidding.timerEnd - now) / vm.bidding.windowMs);
  }
  bar.style.width = `${(frac * 100).toFixed(2)}%`;
  bar.classList.toggle('low', vm.phase === 'bidding' && (vm.bidding.fast || vm.bidding.timerEnd - now < 10000));
  const secs = vm.phase === 'bidding' ? Math.ceil((vm.bidding.timerEnd - now) / 1000) : null;
  document.title = secs !== null ? `${secs}s · Ricochet` : 'Ricochet';
}

setInterval(render, 100);

// ---------------------------------------------------------------------------
// Board drawing

const canvas = $('#board');
const ctx = canvas.getContext('2d');

function theme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name) => cs.getPropertyValue(name).trim();
  return {
    cell: v('--cell'),
    cellAlt: v('--cell-alt'),
    grid: v('--grid'),
    wall: v('--wall'),
    center: v('--center'),
    accent: v('--accent'),
  };
}

function resizeCanvas() {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const size = Math.max(1, Math.round(r.width * dpr));
  if (canvas.width !== size) {
    canvas.width = size;
    canvas.height = size;
  }
  S.dirty = true;
}

new ResizeObserver(resizeCanvas).observe(canvas);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  S.dirty = true;
});

const pathCache = new Map();
function path2d(d) {
  if (!pathCache.has(d)) {
    pathCache.set(d, new Path2D(d));
  }
  return pathCache.get(d);
}

function drawSymbol(t, cx, cy, size, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(size / 20, size / 20);
  if (t.symbol === 'vortex') {
    for (const [c, d] of VORTEX) {
      ctx.fillStyle = ROBOT_HEX[c];
      ctx.fill(path2d(d));
    }
  } else {
    ctx.fillStyle = ROBOT_HEX[t.color];
    ctx.fill(path2d(SHAPES[t.symbol]));
  }
  ctx.restore();
}

// Turns slidePath segments into straight pieces. A jump through the portal
// is a piece of length zero, so the robot pops from one end to the other.
function pathPieces(segments) {
  const pieces = [];
  let last = null;
  for (const seg of segments) {
    if (last) {
      pieces.push({ a: last, b: seg[0], len: 0 });
    }
    for (let i = 1; i < seg.length; i++) {
      const a = seg[i - 1];
      const b = seg[i];
      pieces.push({ a, b, len: Math.abs(b.x - a.x) + Math.abs(b.y - a.y) });
    }
    last = seg[seg.length - 1];
  }
  return pieces;
}

function pointAlong(pieces, dist) {
  let left = dist;
  for (const p of pieces) {
    if (p.len === 0) {
      if (left > 0) {
        continue;
      }
      return { x: p.a.x, y: p.a.y };
    }
    if (left <= p.len) {
      const f = left / p.len;
      return { x: p.a.x + (p.b.x - p.a.x) * f, y: p.a.y + (p.b.y - p.a.y) * f };
    }
    left -= p.len;
  }
  const end = pieces[pieces.length - 1].b;
  return { x: end.x, y: end.y };
}

function updateBoard(vm, game) {
  const target = vm.robots;
  // Snap on a new round. Animate when positions change within a round.
  if (!S.shown || S.animRound !== vm.n || S.animGame !== game.id) {
    S.shown = target.map((r) => ({ x: r.x, y: r.y }));
    S.to = target;
    S.anim = null;
    S.animRound = vm.n;
    S.animGame = game.id;
    S.animMoves = vm.moves;
    S.dirty = true;
  } else if (JSON.stringify(target) !== JSON.stringify(S.to)) {
    const from = S.shown.map((r) => ({ x: r.x, y: r.y }));
    const prev = S.animMoves || '';
    const added = vm.moves.startsWith(prev) && vm.moves.length === prev.length + 2;
    if (added) {
      // One new move: follow its real route, bends and portal included.
      const m = parseMoves(vm.moves.slice(prev.length))[0];
      const before = applyMoves(vm.board, vm.start, prev);
      const pieces = pathPieces(slidePath(vm.board, before, m.robot, m.dir).segments);
      const total = pieces.reduce((sum, p) => sum + p.len, 0);
      S.anim = {
        from: before,
        to: target,
        idx: m.robot,
        pieces,
        total,
        t0: performance.now(),
        dur: Math.min(900, Math.max(150, total * 45)),
      };
    } else {
      let dist = 0;
      target.forEach((r, i) => {
        dist = Math.max(dist, Math.abs(r.x - from[i].x) + Math.abs(r.y - from[i].y));
      });
      S.anim = { from, to: target, t0: performance.now(), dur: Math.min(450, Math.max(120, dist * 40)) };
    }
    S.to = target;
  }
  S.animMoves = vm.moves;
  const key = JSON.stringify([vm.n, vm.target.id, vm.moves, vm.phase, S.selected, game.id, [...tokensWon(game).values()]]);
  if (key !== S.drawKey) {
    S.drawKey = key;
    S.dirty = true;
  }
}

function frame() {
  const a = S.anim;
  if (a) {
    const t = Math.min(1, (performance.now() - a.t0) / a.dur);
    if (a.pieces) {
      const e = t < 1 ? 1 - (1 - t) * (1 - t) * 0.6 - 0.4 * (1 - t) : 1;
      S.shown = a.to.map((r, i) => (i === a.idx ? pointAlong(a.pieces, a.total * e) : { x: r.x, y: r.y }));
    } else {
      const e = 1 - (1 - t) * (1 - t);
      S.shown = a.from.map((f, i) => ({
        x: f.x + (a.to[i].x - f.x) * e,
        y: f.y + (a.to[i].y - f.y) * e,
      }));
    }
    if (t >= 1) {
      S.anim = null;
      S.shown = a.to.map((r) => ({ x: r.x, y: r.y }));
    }
    S.dirty = true;
  }
  if (S.dirty && S.vm && S.room && S.room.game) {
    S.dirty = false;
    draw(S.vm, S.room.game);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Black would vanish on the dark theme, so it borrows the wall color for
// lines and outlines.
function lineColor(i, th) {
  if (COLORS[i] === 'white') {
    return '#8f949a';
  }
  return COLORS[i] === 'black' ? th.wall : ROBOT_HEX[COLORS[i]];
}

function draw(vm, game) {
  const th = theme();
  const W = canvas.width;
  const c = W / N;
  const board = vm.board;
  ctx.clearRect(0, 0, W, W);

  // Cells.
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      ctx.fillStyle = (x + y) % 2 ? th.cellAlt : th.cell;
      ctx.fillRect(x * c, y * c, c, c);
    }
  }
  ctx.strokeStyle = th.grid;
  ctx.lineWidth = Math.max(1, c * 0.02);
  ctx.beginPath();
  for (let i = 1; i < N; i++) {
    ctx.moveTo(i * c, 0);
    ctx.lineTo(i * c, W);
    ctx.moveTo(0, i * c);
    ctx.lineTo(W, i * c);
  }
  ctx.stroke();

  // Targets. The current one gets a tinted cell, won ones fade out.
  const won = new Set();
  for (const list of tokensWon(game).values()) {
    list.forEach((id) => won.add(id));
  }
  for (const t of board.targets) {
    const isCur = t.id === vm.target.id;
    if (isCur) {
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = ROBOT_HEX[t.color];
      ctx.fillRect(t.x * c, t.y * c, c, c);
      ctx.restore();
    }
    const alpha = isCur ? 1 : won.has(t.id) ? 0.15 : 0.45;
    drawSymbol(t, (t.x + 0.5) * c, (t.y + 0.5) * c, c * 0.62, alpha);
  }

  // Portal ends.
  for (const p of board.portals) {
    const cx = (p.x + 0.5) * c;
    const cy = (p.y + 0.5) * c;
    drawSymbol({ symbol: 'vortex' }, cx, cy, c * 0.72, 0.9);
    ctx.beginPath();
    ctx.arc(cx, cy, c * 0.4, 0, Math.PI * 2);
    ctx.strokeStyle = th.wall;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = Math.max(1, c * 0.04);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Colored diagonals.
  if (board.diags) {
    ctx.lineCap = 'round';
    board.diags.forEach((d, k) => {
      if (!d) {
        return;
      }
      const x = k % N;
      const y = Math.floor(k / N);
      const lo = 0.14;
      const hi = 0.86;
      const [x1, y1, x2, y2] =
        d.dir === '/' ? [x + lo, y + hi, x + hi, y + lo] : [x + lo, y + lo, x + hi, y + hi];
      ctx.beginPath();
      ctx.moveTo(x1 * c, y1 * c);
      ctx.lineTo(x2 * c, y2 * c);
      ctx.strokeStyle = th.wall;
      ctx.lineWidth = c * 0.2;
      ctx.stroke();
      ctx.strokeStyle = ROBOT_HEX[d.color];
      ctx.lineWidth = c * 0.13;
      ctx.stroke();
    });
  }

  // Center block with the current target.
  ctx.fillStyle = th.center;
  ctx.fillRect(7 * c, 7 * c, 2 * c, 2 * c);
  drawSymbol(vm.target, 8 * c, 8 * c, c * 1.3, 1);

  // Trail of the moves shown so far, following bends and portal jumps.
  const moves = parseMoves(vm.moves);
  if (moves.length) {
    let robots = vm.start.map((r) => ({ x: r.x, y: r.y }));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    moves.forEach((m, k) => {
      const path = slidePath(board, robots, m.robot, m.dir);
      robots = robots.map((r, i) => (i === m.robot ? { x: path.x, y: path.y } : r));
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = lineColor(m.robot, th);
      ctx.lineWidth = c * 0.1;
      for (const seg of path.segments) {
        ctx.beginPath();
        seg.forEach((p, i) => {
          const px = (p.x + 0.5) * c;
          const py = (p.y + 0.5) * c;
          if (i === 0) {
            ctx.moveTo(px, py);
          } else {
            ctx.lineTo(px, py);
          }
        });
        ctx.stroke();
      }
      ctx.restore();
      const first = path.segments[0];
      const a = first[0];
      const b = first.length > 1 ? first[1] : first[0];
      ctx.save();
      ctx.fillStyle = th.wall;
      ctx.font = `600 ${Math.round(c * 0.3)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = 0.8;
      const mx = (a.x + b.x + 1) / 2;
      const my = (a.y + b.y + 1) / 2;
      ctx.fillText(String(k + 1), mx * c + c * 0.22, my * c - c * 0.22);
      ctx.restore();
    });
  }

  // Walls.
  ctx.strokeStyle = th.wall;
  ctx.lineWidth = Math.max(2, c * 0.12);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const w = board.walls[y * N + x];
      if (w & WALL_N) {
        ctx.moveTo(x * c, y * c);
        ctx.lineTo((x + 1) * c, y * c);
      }
      if (w & WALL_S) {
        ctx.moveTo(x * c, (y + 1) * c);
        ctx.lineTo((x + 1) * c, (y + 1) * c);
      }
      if (w & WALL_W) {
        ctx.moveTo(x * c, y * c);
        ctx.lineTo(x * c, (y + 1) * c);
      }
      if (w & WALL_E) {
        ctx.moveTo((x + 1) * c, y * c);
        ctx.lineTo((x + 1) * c, (y + 1) * c);
      }
    }
  }
  ctx.stroke();
  ctx.lineWidth = Math.max(2, c * 0.12);
  ctx.strokeRect(0, 0, W, W);

  // Robots.
  S.shown.forEach((r, i) => {
    const cx = (r.x + 0.5) * c;
    const cy = (r.y + 0.5) * c;
    if (S.selected === i && canMove(vm)) {
      ctx.beginPath();
      ctx.arc(cx, cy, c * 0.47, 0, Math.PI * 2);
      ctx.strokeStyle = th.accent;
      ctx.lineWidth = c * 0.08;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, c * 0.34, 0, Math.PI * 2);
    ctx.fillStyle = ROBOT_HEX[COLORS[i]];
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, c * 0.05);
    ctx.strokeStyle = COLORS[i] === 'black' ? th.wall : 'rgba(0,0,0,0.55)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx - c * 0.1, cy - c * 0.1, c * 0.09, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fill();
  });
}

// ---------------------------------------------------------------------------
// Dragging robots

function cellAt(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: Math.floor(((e.clientX - r.left) / r.width) * N),
    y: Math.floor(((e.clientY - r.top) / r.height) * N),
    cssCell: r.width / N,
  };
}

canvas.addEventListener('pointerdown', (e) => {
  const vm = fresh();
  if (!canMove(vm)) {
    return;
  }
  const { x, y } = cellAt(e);
  const idx = vm.robots.findIndex((r) => r.x === x && r.y === y);
  if (idx < 0) {
    return;
  }
  S.selected = idx;
  S.drag = { idx, x: e.clientX, y: e.clientY };
  S.dirty = true;
  canvas.setPointerCapture(e.pointerId);
  e.preventDefault();
});

canvas.addEventListener('pointermove', (e) => {
  if (!S.drag) {
    return;
  }
  const dx = e.clientX - S.drag.x;
  const dy = e.clientY - S.drag.y;
  const threshold = cellAt(e).cssCell * 0.35;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < threshold) {
    return;
  }
  const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'r' : 'l') : dy > 0 ? 'd' : 'u';
  const idx = S.drag.idx;
  S.drag = null;
  doMove(idx, dir);
});

function endDrag() {
  S.drag = null;
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

route();
