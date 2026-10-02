// Statistics for the current board. Everything is worked out from the
// rounds already stored for the game, so nothing extra is saved, and it all
// goes away when a new board replaces the game.

import { N, slidePath, parseMoves } from './board.js';
import {
  DEFAULT_TIMER_MS,
  MIN_CALL,
  roundKey,
  roundNumbers,
  robotList,
  attemptKey,
  attemptView,
  deriveBidding,
  boardFor,
} from './game.js';

function median(list) {
  if (list.length === 0) {
    return null;
  }
  const s = [...list].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mean(list) {
  return list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;
}

// Who tried to show a solution in a round, in order, and how it went.
function roundAttempts(round, bidding, now) {
  const out = [];
  if (!bidding.expired) {
    return out;
  }
  const attempts = round.attempts || {};
  let startT = bidding.timerEnd;
  for (let i = 0; i < bidding.order.length; i++) {
    const call = bidding.order[i];
    const a = attempts[attemptKey(i)];
    if (a && (a.result === 'success' || a.result === 'miscount')) {
      out.push({ uid: call.uid, bid: call.n, moves: a.moves || '', result: a.result });
      break;
    }
    const v = attemptView(a, startT, now);
    if (v.result !== 'fail') {
      out.push({ uid: call.uid, bid: call.n, moves: v.moves, result: 'open' });
      break;
    }
    out.push({ uid: call.uid, bid: call.n, moves: v.moves, result: v.timedOut ? 'timeout' : 'gaveup' });
    startT = v.endT;
  }
  return out;
}

// Adds one to every square a robot passed over or stopped on.
function addToHeat(heat, board, start, movesStr) {
  let robots = start.map((r) => ({ x: r.x, y: r.y }));
  for (const m of parseMoves(movesStr)) {
    if (!robots[m.robot]) {
      return;
    }
    const path = slidePath(board, robots, m.robot, m.dir);
    for (const seg of path.segments) {
      for (let i = 1; i < seg.length; i++) {
        const a = seg[i - 1];
        const b = seg[i];
        const dx = Math.sign(b.x - a.x);
        const dy = Math.sign(b.y - a.y);
        let { x, y } = a;
        while (x !== b.x || y !== b.y) {
          x += dx;
          y += dy;
          heat[y * N + x] += 1;
        }
      }
      // A robot coming out of the portal also touches the square it lands on.
      if (seg !== path.segments[0]) {
        heat[seg[0].y * N + seg[0].x] += 1;
      }
    }
    robots = robots.map((r, i) => (i === m.robot ? { x: path.x, y: path.y } : r));
  }
}

export function gameStats(game, now) {
  const board = boardFor(game);
  const timerMs = game.timerMs || DEFAULT_TIMER_MS;
  const heat = new Array(N * N).fill(0);
  const rounds = [];
  const players = new Map();
  const player = (uid) => {
    if (!players.has(uid)) {
      players.set(uid, {
        uid,
        tokens: 0,
        calls: 0,
        callSum: 0,
        firstCalls: 0,
        lowestCalls: 0,
        shown: 0,
        exact: 0,
        gaveUp: 0,
        timeouts: 0,
        nices: 0,
        delays: [],
        points: [],
      });
    }
    return players.get(uid);
  };

  for (const n of roundNumbers(game)) {
    const round = game.rounds[roundKey(n)];
    const start = robotList(round.robots);
    const bidding = deriveBidding(round.bids, now, timerMs);
    const target = board.targets.find((t) => t.id === round.target) || null;

    Object.keys(round.nice || {}).forEach((uid) => {
      player(uid).nices += 1;
    });

    if (bidding.order.length === 0) {
      // Nobody called. Either skipped, or still open.
      continue;
    }

    // Calls in the order they were made, with the wait after the first one.
    const calls = [...bidding.bids.values()]
      .sort((a, b) => a.t - b.t)
      .map((c) => ({ uid: c.uid, n: c.n, t: c.t, delayMs: c.t - bidding.timerStart }));
    const firstEvent = Object.values(round.bids || {})
      .filter((e) => e.n > 0 && e.t === bidding.timerStart)
      .map((e) => e.uid)[0];
    const thinkMs = typeof round.started === 'number' ? bidding.timerStart - round.started : null;

    const attempts = roundAttempts(round, bidding, now);
    for (const a of attempts) {
      if (a.result !== 'open') {
        addToHeat(heat, board, start, a.moves);
      }
    }
    const last = attempts[attempts.length - 1];
    let outcome = 'open';
    if (round.winner) {
      outcome = 'won';
    } else if (round.skippedBy) {
      outcome = 'miscount';
    } else if (bidding.expired && attempts.length === bidding.order.length && last && last.result !== 'open') {
      outcome = 'nobody';
    }
    const winAttempt = attempts.find((a) => a.result === 'success') || null;
    const winMoves = winAttempt ? parseMoves(winAttempt.moves).length : null;

    rounds.push({
      n,
      target,
      started: round.started || null,
      thinkMs: thinkMs !== null && thinkMs >= 0 ? thinkMs : null,
      firstCaller: firstEvent || calls[0].uid,
      calls,
      lowest: bidding.order[0],
      fast: bidding.fast,
      attempts,
      outcome,
      winner: round.winner || null,
      winCall: winAttempt ? winAttempt.bid : null,
      winMoves,
    });

    // Per player.
    player(firstEvent || calls[0].uid).firstCalls += 1;
    player(bidding.order[0].uid).lowestCalls += 1;
    for (const c of calls) {
      const p = player(c.uid);
      p.calls += 1;
      p.callSum += c.n;
      // The call that started the timer has no delay to speak of. Only the
      // calls that came after it say something about timing.
      if (c.t !== bidding.timerStart) {
        p.delays.push(c.delayMs);
        p.points.push({ round: n, n: c.n, delayMs: c.delayMs });
      }
    }
    for (const a of attempts) {
      const p = player(a.uid);
      if (a.result === 'open') {
        continue;
      }
      p.shown += 1;
      if (a.result === 'gaveup') {
        p.gaveUp += 1;
      } else if (a.result === 'timeout') {
        p.timeouts += 1;
      } else if (a.result === 'success') {
        p.tokens += 1;
        if (parseMoves(a.moves).length === a.bid) {
          p.exact += 1;
        }
      }
    }
  }

  // Histograms.
  const winHist = new Map();
  const callHist = new Map();
  for (const r of rounds) {
    if (r.winMoves !== null) {
      winHist.set(r.winMoves, (winHist.get(r.winMoves) || 0) + 1);
    }
    for (const c of r.calls) {
      callHist.set(c.n, (callHist.get(c.n) || 0) + 1);
    }
  }

  // Headline numbers.
  const won = rounds.filter((r) => r.outcome === 'won');
  const gaps = rounds.filter((r) => r.calls.length >= 2).map((r) => r.calls[1].delayMs);
  const thinks = rounds.filter((r) => r.thinkMs !== null).map((r) => r.thinkMs);
  let closest = null;
  for (const r of rounds) {
    for (let i = 1; i < r.calls.length; i++) {
      const gap = r.calls[i].t - r.calls[i - 1].t;
      if (closest === null || gap < closest.gapMs) {
        closest = { gapMs: gap, round: r.n, a: r.calls[i - 1].uid, b: r.calls[i].uid };
      }
    }
  }
  let longest = null;
  for (const r of won) {
    if (longest === null || r.winMoves > longest.moves) {
      longest = { moves: r.winMoves, round: r.n, uid: r.winner };
    }
  }

  const playerList = [...players.values()].map((p) => ({
    ...p,
    avgCall: p.calls ? p.callSum / p.calls : null,
    medianDelayMs: median(p.delays),
  }));

  return {
    board,
    timerMs,
    rounds,
    players: playerList,
    heat,
    heatMax: Math.max(0, ...heat),
    winHist,
    callHist,
    totals: {
      played: rounds.length,
      won: won.length,
      nobody: rounds.filter((r) => r.outcome === 'nobody' || r.outcome === 'miscount').length,
      avgWinMoves: mean(won.map((r) => r.winMoves)),
      medianThinkMs: median(thinks),
      medianGapMs: median(gaps),
      soloRounds: rounds.filter((r) => r.calls.length === 1).length,
      fives: rounds.reduce((s, r) => s + r.calls.filter((c) => c.n === MIN_CALL).length, 0),
      timeouts: playerList.reduce((s, p) => s + p.timeouts, 0),
      nices: playerList.reduce((s, p) => s + p.nices, 0),
      closest,
      longest,
    },
  };
}
