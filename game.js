// Game rules on top of the shared room data. Everything here is derived
// from the database contents and the server clock, so every client reaches
// the same conclusion without anyone acting as the referee.

import {
  generateBoard,
  initialRobots,
  targetById,
  applyMoves,
  robotOnTarget,
  targetsWithin,
  parseMoves,
  MAX_SHORT_MOVES,
  MIN_CALL,
} from './board.js';

export { MIN_CALL };

export const DEFAULT_TIMER_MS = 60000;

// Round keys are "r0", "r1", ... so the database never turns them into arrays.
export function roundKey(n) {
  return `r${n}`;
}

export function roundNumbers(game) {
  return Object.keys((game && game.rounds) || {})
    .map((k) => Number(k.slice(1)))
    .sort((a, b) => a - b);
}

// Robot lists are written as arrays. Some database paths hand them back as
// objects with keys "0".."3", so accept both.
export function robotList(x) {
  if (Array.isArray(x)) {
    return x;
  }
  return Object.keys(x || {})
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => x[k]);
}

export function attemptKey(i) {
  return `a${i}`;
}

// A call of MIN_CALL cannot be beaten, so it shortens the wait to this.
export const FAST_MS = 5000;

// Upper bound on moves for someone with nobody behind them in line.
export const SOLO_MAX_MOVES = 40;

// Bids are an append-only log of { uid, n, t } where t is the server
// timestamp and n = 0 means "retract". Replaying the log in server order
// gives the current calls and the timer.
//
// Timer rule: the first call starts the timer. If every call is retracted,
// the timer stops and starts again on the next call. A call of MIN_CALL
// makes the timer run out FAST_MS after that call, unless it would run out
// sooner anyway. If that call is taken back, the normal timer applies again.
// Events that arrive after the timer has run out are ignored.
export function deriveBidding(bidsObj, now, timerMs) {
  const events = Object.entries(bidsObj || {})
    .map(([key, e]) => ({ key, uid: e.uid, n: e.n, t: e.t }))
    .filter((e) => typeof e.t === 'number')
    .sort((a, b) => a.t - b.t || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const bids = new Map();
  let timerStart = null;

  // Start of the short wait: the earliest call of MIN_CALL still standing.
  const fastStart = () => {
    let first = null;
    for (const b of bids.values()) {
      if (b.n === MIN_CALL && (first === null || b.t < first)) {
        first = b.t;
      }
    }
    return first;
  };
  const endTime = () => {
    if (timerStart === null) {
      return null;
    }
    const fast = fastStart();
    const normal = timerStart + timerMs;
    return fast === null ? normal : Math.min(normal, fast + FAST_MS);
  };

  for (const e of events) {
    const end = endTime();
    if (end !== null && e.t >= end) {
      break;
    }
    if (e.n > 0) {
      // A changed call gets a new timestamp, so it loses any earlier
      // priority. Whoever made a given call first keeps it.
      bids.set(e.uid, { uid: e.uid, n: e.n, t: e.t });
      if (timerStart === null) {
        timerStart = e.t;
      }
    } else {
      bids.delete(e.uid);
      if (bids.size === 0) {
        timerStart = null;
      }
    }
  }

  // Lowest call first. Equal calls: the earlier one wins.
  const order = [...bids.values()].sort((a, b) => a.n - b.n || a.t - b.t);
  const timerEnd = endTime();
  const fs = fastStart();
  const fast = fs !== null && fs + FAST_MS <= timerStart + timerMs;
  const expired = timerEnd !== null && now >= timerEnd;
  return {
    bids,
    order,
    timerStart,
    timerEnd,
    expired,
    fast,
    // Length of the countdown shown in the timer bar.
    windowMs: fast ? FAST_MS : timerMs,
  };
}

// How many quadrants hold diagonal walls. Games made by an earlier
// version stored a yes/no flag, which meant all four quadrants.
export function diagQuadrantsOf(game) {
  if (typeof game.diagQuadrants === 'number') {
    return game.diagQuadrants;
  }
  return game.diagonals ? 4 : 0;
}

const boardCache = new Map();
export function boardFor(game) {
  const options = { diagQuadrants: diagQuadrantsOf(game), whiteRobot: !!game.whiteRobot };
  const key = `${game.seed}:${options.diagQuadrants}:${options.whiteRobot ? 1 : 0}`;
  if (!boardCache.has(key)) {
    boardCache.set(key, generateBoard(game.seed, options));
  }
  return boardCache.get(key);
}

export function tokensWon(game) {
  const won = new Map();
  for (const n of roundNumbers(game)) {
    const r = game.rounds[roundKey(n)];
    if (r.winner) {
      if (!won.has(r.winner)) {
        won.set(r.winner, []);
      }
      won.get(r.winner).push(r.target);
    }
  }
  return won;
}

// Builds the view of the current round. Phases:
//   thinking  no calls yet
//   bidding   timer running
//   demo      timer ran out, someone is showing their moves
//   done      round finished (won, everyone failed, or skipped)
export function deriveRound(game, now) {
  const board = boardFor(game);
  const timerMs = game.timerMs || DEFAULT_TIMER_MS;
  const nums = roundNumbers(game);
  const n = nums[nums.length - 1];
  const round = game.rounds[roundKey(n)];
  const target = targetById(board, round.target);
  const start = robotList(round.robots);
  const bidding = deriveBidding(round.bids, now, timerMs);

  const view = {
    board,
    n,
    round,
    target,
    start,
    robots: start,
    timerMs,
    bidding,
    phase: 'thinking',
    attemptIdx: null,
    demonstrator: null,
    bid: null,
    moves: '',
    winner: round.winner || null,
    failed: [],
  };

  if (round.winner) {
    view.phase = 'done';
    view.robots = robotList(round.final);
    const a = Object.values(round.attempts || {}).find((x) => x.result === 'success');
    view.moves = a ? a.moves || '' : '';
    view.bid = a && a.bid ? a.bid : null;
    return view;
  }

  // A single caller of MIN_CALL who needed more moves. Nobody scores and the
  // target goes back in the pile.
  if (round.skippedBy) {
    const a = Object.values(round.attempts || {}).find((x) => x.result === 'miscount');
    view.phase = 'done';
    view.skippedBy = round.skippedBy;
    view.moves = a ? a.moves || '' : '';
    view.robots = applyMoves(board, start, view.moves);
    return view;
  }

  if (!bidding.expired) {
    view.phase = bidding.timerStart === null ? 'thinking' : 'bidding';
    return view;
  }

  // Timer has run out. Walk through the callers from lowest up, skipping
  // the ones who already failed.
  const attempts = round.attempts || {};
  let i = 0;
  while (attempts[attemptKey(i)] && attempts[attemptKey(i)].result === 'fail') {
    view.failed.push(bidding.order[i].uid);
    i++;
  }
  if (i >= bidding.order.length) {
    view.phase = 'done';
    return view;
  }
  const a = attempts[attemptKey(i)] || {};
  view.phase = 'demo';
  // A single caller keeps the point even if they miscounted, so they are
  // not held to their number.
  view.solo = bidding.order.length === 1;
  view.attemptIdx = i;
  view.demonstrator = bidding.order[i].uid;
  view.bid = bidding.order[i].n;
  // Move limit. Using more moves than you called is fine as long as you
  // still beat the next caller in line, so the limit is one less than their
  // call, and never below your own. Nobody behind you means no limit.
  //
  // A call of MIN_CALL is different, since it cut everyone's thinking time
  // short. That caller must make it in MIN_CALL moves. The only exception
  // is the single caller, who may go on, but then nobody scores and the
  // target goes back in the pile (handled in main.js).
  const next = bidding.order[i + 1];
  view.nextCall = next ? next.n : null;
  if (view.bid === MIN_CALL && !view.solo) {
    view.limit = MIN_CALL;
  } else {
    view.limit = next ? Math.max(view.bid, next.n - 1) : SOLO_MAX_MOVES;
  }
  view.unlimited = view.limit === SOLO_MAX_MOVES;
  view.moves = a.moves || '';
  view.robots = applyMoves(board, start, view.moves);
  view.reached = robotOnTarget(view.robots, target);
  return view;
}

export function moveCount(movesStr) {
  return parseMoves(movesStr).length;
}

// Picks the next target. Targets that can be reached in MAX_SHORT_MOVES
// moves or fewer are left out. Returns null when no playable target is
// left, which ends the game.
export function makeNextRound(game, rng) {
  const board = boardFor(game);
  const nums = roundNumbers(game);
  let robots;
  let lastTarget = null;
  if (nums.length === 0) {
    robots = initialRobots(board, game.seed);
  } else {
    const prev = game.rounds[roundKey(nums[nums.length - 1])];
    robots = robotList(prev.winner ? prev.final : prev.robots);
    lastTarget = prev.target;
  }
  const won = wonTargets(game);
  const short = targetsWithin(board, robots, MAX_SHORT_MOVES);
  const playable = board.targets.filter((t) => !won.has(t.id) && !short.has(t.id));
  if (playable.length === 0) {
    return null;
  }
  // Do not draw the target that was just skipped or failed if we can help it.
  const fresh = playable.filter((t) => t.id !== lastTarget);
  const choices = fresh.length > 0 ? fresh : playable;
  const target = choices[Math.floor(rng() * choices.length)];
  return { target: target.id, robots };
}

function wonTargets(game) {
  const won = new Set();
  for (const list of tokensWon(game).values()) {
    list.forEach((id) => won.add(id));
  }
  return won;
}

// True when some target other than `targetId` could still be drawn with
// the robots at `robots`. Used to decide whether a miscounted call of
// MIN_CALL can send its target back to the pile.
export function otherPlayableTarget(game, robots, targetId) {
  const board = boardFor(game);
  const won = wonTargets(game);
  const short = targetsWithin(board, robots, MAX_SHORT_MOVES);
  return board.targets.some((t) => t.id !== targetId && !won.has(t.id) && !short.has(t.id));
}

export function remainingTargets(game) {
  const won = wonTargets(game);
  return boardFor(game).targets.filter((t) => !won.has(t.id)).length;
}
