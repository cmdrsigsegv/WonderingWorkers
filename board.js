// Board generation and robot movement. Pure functions, no DOM.

export const N = 16;

export const WALL_N = 1;
export const WALL_E = 2;
export const WALL_S = 4;
export const WALL_W = 8;

export const DIRS = {
  u: { dx: 0, dy: -1, wall: WALL_N },
  r: { dx: 1, dy: 0, wall: WALL_E },
  d: { dx: 0, dy: 1, wall: WALL_S },
  l: { dx: -1, dy: 0, wall: WALL_W },
};
const DIR_KEYS = ['u', 'r', 'd', 'l'];

// Robots, in the order used by move strings. Black and white have no
// targets. Black has no diagonals of its own, so it bounces off all of them.
// White is optional and passes straight through every diagonal. Normal
// walls stop it like any other robot.
export const COLORS = ['red', 'green', 'blue', 'yellow', 'black', 'white'];
export const TARGET_COLORS = ['red', 'green', 'blue', 'yellow'];
export const SYMBOLS = ['circle', 'triangle', 'square', 'star'];

// Targets that can be reached in this many moves or fewer are never drawn.
export const MAX_SHORT_MOVES = 4;

// The lowest call that can be right.
export const MIN_CALL = MAX_SHORT_MOVES + 1;

// Small seeded PRNG so every client builds the same board from the same seed.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng, lo, hi) {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function shuffle(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const OPPOSITE = { [WALL_N]: WALL_S, [WALL_S]: WALL_N, [WALL_E]: WALL_W, [WALL_W]: WALL_E };
const STEP = {
  [WALL_N]: [0, -1],
  [WALL_S]: [0, 1],
  [WALL_E]: [1, 0],
  [WALL_W]: [-1, 0],
};

function addWall(walls, x, y, side) {
  walls[y * N + x] |= side;
  const [dx, dy] = STEP[side];
  const nx = x + dx;
  const ny = y + dy;
  if (nx >= 0 && ny >= 0 && nx < N && ny < N) {
    walls[ny * N + nx] |= OPPOSITE[side];
  }
}

// The two grid corners a wall segment runs between. Grid corners are
// numbered (N + 1) per row.
function wallEnds(x, y, side) {
  const p = (px, py) => py * (N + 1) + px;
  switch (side) {
    case WALL_N:
      return [p(x, y), p(x + 1, y)];
    case WALL_S:
      return [p(x, y + 1), p(x + 1, y + 1)];
    case WALL_W:
      return [p(x, y), p(x, y + 1)];
    default:
      return [p(x + 1, y), p(x + 1, y + 1)];
  }
}

export function isCenter(x, y) {
  return (x === 7 || x === 8) && (y === 7 || y === 8);
}

function nearCenter(x, y) {
  return x >= 6 && x <= 9 && y >= 6 && y <= 9;
}

function quadrantOf(x, y) {
  return (x >= 8 ? 1 : 0) + (y >= 8 ? 2 : 0);
}

const CORNERS = [
  [WALL_N, WALL_E],
  [WALL_E, WALL_S],
  [WALL_S, WALL_W],
  [WALL_W, WALL_N],
];

// Builds a board in the style of the physical game:
// - a walled 2x2 center,
// - four targets per quadrant, each in an L-shaped wall corner,
// - one multicolor portal end in an L-shaped corner, and its partner end on
//   an open cell in another quadrant,
// - two short walls on each quadrant's outer edges, never touching a
//   target's walls,
// - optionally two colored diagonal walls in each of a chosen number of
//   quadrants. Which quadrants get them is random.
// options.whiteRobot adds the sixth robot.
export function generateBoard(seed, options = {}) {
  const rng = mulberry32(seed);
  const robotCount = options.whiteRobot ? 6 : 5;
  // Placement can fail on unlucky draws. Retry with the same PRNG stream so
  // the result stays deterministic for a given seed.
  for (;;) {
    const built = tryBuild(rng, options);
    if (!built) {
      continue;
    }
    const board = { seed, options, robotCount, ...built };
    if (!hasEndlessLoop(board)) {
      return board;
    }
  }
}

function tryBuild(rng, options) {
  const walls = new Array(N * N).fill(0);
  const targets = [];
  const specials = [];
  // Grid corners touched by the L-walls around targets and the portal.
  const cornerPoints = new Set();

  // Center block.
  addWall(walls, 7, 7, WALL_N);
  addWall(walls, 8, 7, WALL_N);
  addWall(walls, 7, 8, WALL_S);
  addWall(walls, 8, 8, WALL_S);
  addWall(walls, 7, 7, WALL_W);
  addWall(walls, 7, 8, WALL_W);
  addWall(walls, 8, 7, WALL_E);
  addWall(walls, 8, 8, WALL_E);

  const portalQuadrant = randInt(rng, 0, 3);
  let portalA = null;

  for (let q = 0; q < 4; q++) {
    const ox = (q % 2) * 8;
    const oy = Math.floor(q / 2) * 8;

    // Candidate cells: not on the board edge, not next to the center.
    const cells = [];
    for (let ly = 1; ly <= 6; ly++) {
      for (let lx = 1; lx <= 6; lx++) {
        const x = ox + lx;
        const y = oy + ly;
        if (!nearCenter(x, y)) {
          cells.push([x, y]);
        }
      }
    }
    shuffle(rng, cells);

    const count = q === portalQuadrant ? 5 : 4;
    const placed = [];
    for (const [x, y] of cells) {
      if (placed.length === count) {
        break;
      }
      // Keep corners apart so their walls never touch.
      const clash = specials
        .concat(placed)
        .some((t) => Math.abs(t.x - x) < 2 && Math.abs(t.y - y) < 2);
      // Avoid two corners sharing a row or column inside a quadrant.
      const sameLine = placed.some((t) => t.x === x || t.y === y);
      if (!clash && !sameLine) {
        placed.push({ x, y });
      }
    }
    if (placed.length < count) {
      return null;
    }

    // Each quadrant gets one target of every color, and the symbols are
    // rotated per quadrant so every color/symbol pair appears exactly once.
    // The four target L's in a quadrant each face a different way. The
    // portal's L, if this quadrant has it, may face any way.
    const facings = shuffle(rng, [0, 1, 2, 3]);
    placed.forEach((p, k) => {
      const corner = CORNERS[k < 4 ? facings[k] : randInt(rng, 0, 3)];
      for (const side of corner) {
        addWall(walls, p.x, p.y, side);
        wallEnds(p.x, p.y, side).forEach((c) => cornerPoints.add(c));
      }
      specials.push(p);
      if (k < 4) {
        const color = TARGET_COLORS[k];
        const symbol = SYMBOLS[(k + q) % 4];
        targets.push({ id: `${color}-${symbol}`, color, symbol, x: p.x, y: p.y });
      } else {
        portalA = { x: p.x, y: p.y };
      }
    });

    // Edge walls: one on the quadrant's outer vertical edge and one on its
    // outer horizontal edge. Their inner end must not touch any corner
    // walls, or they would close off a pocket with a single way out.
    const edgeX = ox === 0 ? 0 : N - 1;
    const edgeY = oy === 0 ? 0 : N - 1;
    const vertical = shuffle(rng, [1, 2, 3, 4, 5]).find((ly) => {
      return !wallEnds(edgeX, oy + ly, WALL_S).some((c) => cornerPoints.has(c));
    });
    const horizontal = shuffle(rng, [1, 2, 3, 4, 5]).find((lx) => {
      return !wallEnds(ox + lx, edgeY, WALL_E).some((c) => cornerPoints.has(c));
    });
    if (vertical === undefined || horizontal === undefined) {
      return null;
    }
    addWall(walls, edgeX, oy + vertical, WALL_S);
    addWall(walls, ox + horizontal, edgeY, WALL_E);
  }

  // Far end of the portal: an open cell in another quadrant, not in the
  // same row or column as the first end, and away from targets.
  const isFree = (x, y, gap) =>
    !nearCenter(x, y) &&
    walls[y * N + x] === 0 &&
    specials.every((s) => Math.abs(s.x - x) >= gap || Math.abs(s.y - y) >= gap);
  const far = [];
  for (let y = 1; y < N - 1; y++) {
    for (let x = 1; x < N - 1; x++) {
      if (
        quadrantOf(x, y) !== portalQuadrant &&
        x !== portalA.x &&
        y !== portalA.y &&
        isFree(x, y, 2)
      ) {
        far.push({ x, y });
      }
    }
  }
  if (far.length === 0) {
    return null;
  }
  const portalB = far[randInt(rng, 0, far.length - 1)];
  specials.push(portalB);
  const portals = [portalA, portalB];

  // Colored diagonals. A robot of another color bounces off at a right
  // angle. A robot of the same color passes straight through.
  let diags = null;
  const diagCount = Math.max(0, Math.min(4, options.diagQuadrants | 0));
  const diagQuadrants = shuffle(rng, [0, 1, 2, 3]).slice(0, diagCount).sort();
  if (diagCount > 0) {
    diags = new Array(N * N).fill(null);
    const taken = [];
    for (const q of diagQuadrants) {
      const ox = (q % 2) * 8;
      const oy = Math.floor(q / 2) * 8;
      const cells = [];
      for (let ly = 1; ly <= 6; ly++) {
        for (let lx = 1; lx <= 6; lx++) {
          const x = ox + lx;
          const y = oy + ly;
          const apart = taken.every((s) => Math.abs(s.x - x) >= 2 || Math.abs(s.y - y) >= 2);
          if (isFree(x, y, 2) && apart) {
            cells.push({ x, y });
          }
        }
      }
      shuffle(rng, cells);
      const mine = [];
      for (const c of cells) {
        if (mine.length === 2) {
          break;
        }
        if (mine.every((s) => Math.abs(s.x - c.x) >= 2 || Math.abs(s.y - c.y) >= 2)) {
          mine.push(c);
        }
      }
      if (mine.length < 2) {
        return null;
      }
      for (const c of mine) {
        diags[c.y * N + c.x] = {
          color: TARGET_COLORS[randInt(rng, 0, 3)],
          dir: rng() < 0.5 ? '/' : '\\',
        };
        taken.push(c);
      }
    }
  }

  return { walls, targets, portals, diags, diagQuadrants };
}

// A board where some robot could bounce around forever is thrown away.
function hasEndlessLoop(board) {
  const away = { x: -10, y: -10 };
  for (let idx = 0; idx < board.robotCount; idx++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (isCenter(x, y)) {
          continue;
        }
        const robots = [];
        for (let i = 0; i < board.robotCount; i++) {
          robots.push(i === idx ? { x, y } : away);
        }
        for (const dir of DIR_KEYS) {
          if (move(board, robots, idx, dir, false).looped) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

export function targetById(board, id) {
  return board.targets.find((t) => t.id === id) || null;
}

function portalIndex(board, x, y) {
  const p = board.portals;
  if (!p) {
    return -1;
  }
  if (p[0].x === x && p[0].y === y) {
    return 0;
  }
  if (p[1].x === x && p[1].y === y) {
    return 1;
  }
  return -1;
}

export function isSpecialCell(board, x, y) {
  return (
    isCenter(x, y) ||
    portalIndex(board, x, y) >= 0 ||
    board.targets.some((t) => t.x === x && t.y === y) ||
    !!(board.diags && board.diags[y * N + x])
  );
}

// Random starting spots for the robots. Never on the center, a target, a
// portal, or a diagonal.
export function initialRobots(board, seed) {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const taken = new Set();
  const robots = [];
  while (robots.length < board.robotCount) {
    const x = randInt(rng, 0, N - 1);
    const y = randInt(rng, 0, N - 1);
    const k = y * N + x;
    if (taken.has(k) || isSpecialCell(board, x, y)) {
      continue;
    }
    taken.add(k);
    robots.push({ x, y });
  }
  return robots;
}

const TURN = {
  '/': { r: 'u', u: 'r', l: 'd', d: 'l' },
  '\\': { r: 'd', d: 'r', l: 'u', u: 'l' },
};

// Moves robot `idx` in direction `dir` until it stops.
//
// Portal: stepping onto one end moves the robot to the other end, and it
// keeps going in the same direction. If the next cell after the far end is
// blocked, it stops on the far end. If another robot sits on the far end,
// it stops on the end it entered. A robot that starts on a portal end just
// moves off it.
//
// Diagonals: stepping onto a diagonal of another color turns the robot 90
// degrees and it keeps going. A robot that starts on a diagonal moves off
// it in a straight line.
//
// White: passes straight through every diagonal.
//
// With withPath set, the result also holds the route as a list of
// polylines. A new polyline starts after each trip through the portal.
function move(board, robots, idx, dir, withPath) {
  const color = COLORS[idx];
  const ghost = color === 'white';
  let { x, y } = robots[idx];
  let d = dir;
  const segments = withPath ? [[{ x, y }]] : null;
  const seen = new Set();
  let looped = false;
  const occupied = (cx, cy) => {
    for (let i = 0; i < robots.length; i++) {
      if (i !== idx && robots[i].x === cx && robots[i].y === cy) {
        return true;
      }
    }
    return false;
  };

  for (;;) {
    const D = DIRS[d];
    if (board.walls[y * N + x] & D.wall) {
      break;
    }
    const nx = x + D.dx;
    const ny = y + D.dy;
    if (nx < 0 || ny < 0 || nx >= N || ny >= N || occupied(nx, ny)) {
      break;
    }
    x = nx;
    y = ny;

    const pi = portalIndex(board, x, y);
    if (pi >= 0) {
      const other = board.portals[1 - pi];
      if (occupied(other.x, other.y)) {
        break;
      }
      if (withPath) {
        segments[segments.length - 1].push({ x, y });
        segments.push([{ x: other.x, y: other.y }]);
      }
      x = other.x;
      y = other.y;
    } else {
      const diag = board.diags && !ghost ? board.diags[y * N + x] : null;
      if (diag && diag.color !== color) {
        if (withPath) {
          segments[segments.length - 1].push({ x, y });
        }
        d = TURN[diag.dir][d];
      }
    }

    const key = (y * N + x) * 4 + DIR_KEYS.indexOf(d);
    if (seen.has(key)) {
      looped = true;
      break;
    }
    seen.add(key);
  }

  if (withPath) {
    segments[segments.length - 1].push({ x, y });
  }
  return { x, y, segments, looped };
}

// Where robot `idx` stops when pushed in direction `dir`.
export function slide(board, robots, idx, dir) {
  const r = move(board, robots, idx, dir, false);
  return { x: r.x, y: r.y };
}

// Same as slide, plus the route for drawing and animation.
export function slidePath(board, robots, idx, dir) {
  const r = move(board, robots, idx, dir, true);
  return { x: r.x, y: r.y, segments: r.segments };
}

// Moves are stored as a compact string: robot index digit + direction char,
// for example "0u4l" means red up, then black left.
export function parseMoves(str) {
  const moves = [];
  const s = str || '';
  for (let i = 0; i + 1 < s.length; i += 2) {
    moves.push({ robot: Number(s[i]), dir: s[i + 1] });
  }
  return moves;
}

export function applyMoves(board, start, movesStr) {
  let robots = start.map((r) => ({ x: r.x, y: r.y }));
  for (const m of parseMoves(movesStr)) {
    const p = slide(board, robots, m.robot, m.dir);
    robots = robots.map((r, i) => (i === m.robot ? p : r));
  }
  return robots;
}

export function robotOnTarget(robots, target) {
  const r = robots[COLORS.indexOf(target.color)];
  return r.x === target.x && r.y === target.y;
}

// Ids of the targets that can be reached in `depth` moves or fewer, using
// any robots. One breadth-first search covers every target at once.
export function targetsWithin(board, robots, depth) {
  const reached = new Set();
  const cellKey = (i, p) => i * N * N + p.y * N + p.x;
  const stateKey = (rs) => rs.map((p) => p.y * N + p.x).join(',');
  robots.forEach((p, i) => reached.add(cellKey(i, p)));

  let frontier = [robots];
  const seen = new Set([stateKey(robots)]);
  for (let level = 0; level < depth; level++) {
    const next = [];
    for (const rs of frontier) {
      for (let i = 0; i < rs.length; i++) {
        for (const dir of DIR_KEYS) {
          const p = slide(board, rs, i, dir);
          if (p.x === rs[i].x && p.y === rs[i].y) {
            continue;
          }
          const nr = rs.slice();
          nr[i] = p;
          const k = stateKey(nr);
          if (seen.has(k)) {
            continue;
          }
          seen.add(k);
          reached.add(cellKey(i, p));
          if (level < depth - 1) {
            next.push(nr);
          }
        }
      }
    }
    frontier = next;
  }

  const ids = new Set();
  for (const t of board.targets) {
    if (reached.has(cellKey(COLORS.indexOf(t.color), t))) {
      ids.add(t.id);
    }
  }
  return ids;
}
