// Draws the statistics tab: headline tiles, a player table, and three
// charts. Charts are plain SVG. Colors come from CSS variables on .viz-root,
// so the light and dark themes each get their own steps.

import { N, WALL_N, WALL_E, WALL_S, WALL_W } from './board.js';

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function secs(ms) {
  if (ms === null || ms === undefined) {
    return '–';
  }
  return `${(ms / 1000).toFixed(1)} s`;
}

function num(x, digits = 1) {
  return x === null || x === undefined ? '–' : x.toFixed(digits);
}

// Tooltip text rides on the mark as JSON: [strong value, label lines...].
function tip(lines) {
  return `data-tip="${esc(JSON.stringify(lines))}" tabindex="0"`;
}

function targetLabel(t) {
  return t ? `${t.color} ${t.symbol}` : '–';
}

function tile(label, value, note) {
  return `<div class="tile"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div>${
    note ? `<div class="note">${esc(note)}</div>` : ''
  }</div>`;
}

// ---------------------------------------------------------------------------
// When calls came in: one row per player, one dot per call, placed by how
// long after the first call of the round it was made.

function timingChart(stats, name, narrow) {
  const rows = stats.players
    .filter((p) => p.calls > 0)
    .sort((a, b) => (a.medianDelayMs ?? Infinity) - (b.medianDelayMs ?? Infinity));
  if (rows.length === 0) {
    return '<p class="empty">No calls yet.</p>';
  }
  const maxS = stats.timerMs / 1000;
  // On a phone the chart is drawn at its real width, so the text stays
  // readable. The "called first" column moves to the player table.
  const W = narrow ? 350 : 640;
  const left = narrow ? 76 : 110;
  const right = narrow ? 56 : 150;
  const maxName = narrow ? 8 : 13;
  const rowH = 34;
  const top = 26;
  const plotW = W - left - right;
  const bottomY = top + rows.length * rowH;
  const H = bottomY + 44;
  const x = (ms) => left + (Math.min(ms, stats.timerMs) / stats.timerMs) * plotW;
  const step = (maxS <= 12 ? 2 : maxS <= 30 ? 5 : 10) * (narrow ? 2 : 1);
  const col1 = left + plotW + (narrow ? 10 : 14);
  const col2 = left + plotW + 84;

  let grid = '';
  for (let s = 0; s <= maxS + 0.001; s += step) {
    const gx = left + (s / maxS) * plotW;
    grid += `<line class="grid" x1="${gx}" y1="${top}" x2="${gx}" y2="${bottomY}"/>`;
    grid += `<text class="tick" x="${gx}" y="${bottomY + 16}" text-anchor="middle">${s}</text>`;
  }
  grid += `<text class="tick" x="${left + plotW / 2}" y="${bottomY + 36}" text-anchor="middle">seconds after the first call</text>`;
  grid += `<text class="tick" x="${col1}" y="${top - 10}">median</text>`;
  if (!narrow) {
    grid += `<text class="tick" x="${col2}" y="${top - 10}">called first</text>`;
  }

  let body = '';
  rows.forEach((p, i) => {
    const cy = top + i * rowH + rowH / 2;
    const label = name(p.uid);
    body += `<text class="rowlabel" x="${left - 10}" y="${cy + 4}" text-anchor="end">${esc(
      label.length > maxName ? `${label.slice(0, maxName - 1)}…` : label,
    )}</text>`;
    body += `<line class="rowline" x1="${left}" y1="${cy}" x2="${left + plotW}" y2="${cy}"/>`;
    body += `<text class="rowvalue" x="${col1}" y="${cy + 4}">${secs(p.medianDelayMs)}</text>`;
    if (!narrow) {
      body += `<text class="rowvalue" x="${col2}" y="${cy + 4}">${p.firstCalls} of ${p.calls}</text>`;
    }
    if (p.medianDelayMs !== null) {
      // Median: a short ink tick, labeled once at the end of the row.
      const mx = x(p.medianDelayMs);
      body += `<line class="median" x1="${mx}" y1="${cy - 12}" x2="${mx}" y2="${cy + 12}"/>`;
    }
    p.points.forEach((pt, k) => {
      // Nudge dots up and down a little, so ones that land close together
      // can each be seen.
      const jitter = ((k * 7) % 5) - 2;
      const cx = x(pt.delayMs);
      const t = tip([secs(pt.delayMs), `${label} called ${pt.n}`, `Round ${pt.round + 1}`]);
      body += `<g class="pt" ${t}><circle class="hit" cx="${cx}" cy="${cy + jitter * 3}" r="13"/><circle class="dot" cx="${cx}" cy="${
        cy + jitter * 3
      }" r="5"/></g>`;
    });
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Seconds after the first call, per player">${grid}${body}</svg>`;
}

// ---------------------------------------------------------------------------
// Histogram: how many times each number of moves came up.

function histogram(hist, lo, hi, unitOne, unitMany, what) {
  const W = 300;
  const H = 170;
  const left = 30;
  const bottom = 26;
  const top = 10;
  const plotW = W - left - 8;
  const plotH = H - top - bottom;
  const count = hi - lo + 1;
  const band = plotW / count;
  const barW = Math.min(24, band - 2);
  const max = Math.max(1, ...hist.values());
  const tickStep = max <= 4 ? 1 : Math.ceil(max / 4);
  let out = '';
  for (let v = 0; v <= max; v += tickStep) {
    const y = top + plotH - (v / max) * plotH;
    out += `<line class="${v === 0 ? 'axis' : 'grid'}" x1="${left}" y1="${y}" x2="${W - 8}" y2="${y}"/>`;
    out += `<text class="tick" x="${left - 6}" y="${y + 4}" text-anchor="end">${v}</text>`;
  }
  const labelEvery = count > 12 ? 2 : 1;
  for (let k = lo; k <= hi; k++) {
    const v = hist.get(k) || 0;
    const cx = left + (k - lo + 0.5) * band;
    if ((k - lo) % labelEvery === 0) {
      out += `<text class="tick" x="${cx}" y="${H - 8}" text-anchor="middle">${k}</text>`;
    }
    if (v === 0) {
      continue;
    }
    const h = (v / max) * plotH;
    const x0 = cx - barW / 2;
    const y0 = top + plotH - h;
    const r = Math.min(4, h, barW / 2);
    // Rounded at the top, square at the baseline.
    const d = `M${x0} ${top + plotH}V${y0 + r}Q${x0} ${y0} ${x0 + r} ${y0}H${x0 + barW - r}Q${x0 + barW} ${y0} ${x0 + barW} ${
      y0 + r
    }V${top + plotH}Z`;
    const t = tip([`${v} ${v === 1 ? unitOne : unitMany}`, `${k} moves`]);
    out += `<g class="pt" ${t}><rect class="hit" x="${cx - band / 2}" y="${top}" width="${band}" height="${plotH}"/><path class="bar" d="${d}"/></g>`;
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(what)}">${out}</svg>`;
}

// ---------------------------------------------------------------------------
// Heatmap of the board: how often a robot passed over or stopped on each
// square while solutions were shown.

function heatBins(max) {
  const bins = Math.min(5, max);
  const ranges = [];
  for (let b = 1; b <= bins; b++) {
    const lo = Math.floor(((b - 1) * max) / bins) + 1;
    const hi = Math.floor((b * max) / bins);
    // Which of the five color steps this bin uses.
    const step = bins === 1 ? 3 : 1 + Math.round(((b - 1) * 4) / (bins - 1));
    ranges.push({ lo, hi, step });
  }
  return ranges;
}

function heatmap(stats) {
  if (stats.heatMax === 0) {
    return '<p class="empty">No solutions shown yet.</p>';
  }
  const c = 20;
  const W = N * c;
  const ranges = heatBins(stats.heatMax);
  const stepOf = (v) => ranges.find((r) => v >= r.lo && v <= r.hi).step;
  let cells = '';
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const v = stats.heat[y * N + x];
      if (v === 0) {
        continue;
      }
      const t = tip([`${v} ${v === 1 ? 'pass' : 'passes'}`, `Column ${x + 1}, row ${y + 1}`]);
      // A 2 px gap in the surface color separates neighboring squares.
      cells += `<rect class="cell s${stepOf(v)}" ${t} x="${x * c + 1}" y="${y * c + 1}" width="${c - 2}" height="${c - 2}" rx="2"/>`;
    }
  }
  let walls = '';
  const w = stats.board.walls;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const b = w[y * N + x];
      if (b & WALL_N) {
        walls += `M${x * c} ${y * c}h${c}`;
      }
      if (b & WALL_W) {
        walls += `M${x * c} ${y * c}v${c}`;
      }
      if (b & WALL_S && y === N - 1) {
        walls += `M${x * c} ${(y + 1) * c}h${c}`;
      }
      if (b & WALL_E && x === N - 1) {
        walls += `M${(x + 1) * c} ${y * c}v${c}`;
      }
    }
  }
  const center = `<rect class="center" x="${7 * c}" y="${7 * c}" width="${2 * c}" height="${2 * c}"/>`;
  const frame = `<rect class="frame" x="0" y="0" width="${W}" height="${W}"/>`;
  const legend = ranges
    .map((r) => `<span class="key"><span class="swatch s${r.step}"></span>${r.lo === r.hi ? r.lo : `${r.lo}–${r.hi}`}</span>`)
    .join('');
  return (
    `<div class="heat"><svg class="chart heatsvg" viewBox="-1 -1 ${W + 2} ${W + 2}" role="img" aria-label="How often each square was used">` +
    `${frame}${center}${cells}<path class="walls" d="${walls}"/></svg>` +
    `<div class="legend"><span class="muted">Passes per square</span>${legend}</div></div>`
  );
}

// ---------------------------------------------------------------------------

export function renderStats(stats, players, narrow) {
  const name = (uid) => (players[uid] && players[uid].name ? players[uid].name : 'Someone');
  const t = stats.totals;
  if (t.played === 0) {
    return '<div class="viz-root"><p class="empty">No rounds with calls yet. Statistics fill in as you play.</p></div>';
  }

  const tiles =
    tile('Rounds played', String(t.played), t.soloRounds ? `${t.soloRounds} with a single caller` : '') +
    tile('Targets won', String(t.won), t.nobody ? `${t.nobody} went back in the pile` : '') +
    tile('Average moves to win', num(t.avgWinMoves), t.longest ? `longest ${t.longest.moves}` : '') +
    tile('Median wait for the first call', secs(t.medianThinkMs), 'from a new target to the first call') +
    tile('Median gap to the second call', secs(t.medianGapMs), 'in rounds with two or more callers') +
    tile('Timed out while showing', String(t.timeouts), t.fives ? `${t.fives} calls of 5` : '');

  const notes = [];
  if (t.longest) {
    notes.push(`Longest solution: <b>${t.longest.moves} moves</b> by ${esc(name(t.longest.uid))} in round ${t.longest.round + 1}.`);
  }
  if (t.closest) {
    notes.push(
      `Closest race: <b>${secs(t.closest.gapMs)}</b> between ${esc(name(t.closest.a))} and ${esc(name(t.closest.b))} in round ${
        t.closest.round + 1
      }.`,
    );
  }
  if (t.nices) {
    notes.push(`<b>${t.nices}</b> ${t.nices === 1 ? 'Nice was' : 'Nices were'} sent.`);
  }

  const playerRows = [...stats.players]
    .sort((a, b) => b.tokens - a.tokens || b.calls - a.calls)
    .map(
      (p) =>
        `<tr><th scope="row">${esc(name(p.uid))}</th><td>${p.tokens}</td><td>${p.calls}</td><td>${p.firstCalls}</td><td>${
          p.lowestCalls
        }</td><td>${num(p.avgCall)}</td><td>${secs(p.medianDelayMs)}</td><td>${p.exact}</td><td>${p.gaveUp}</td><td>${
          p.timeouts
        }</td><td>${p.nices}</td></tr>`,
    )
    .join('');

  const roundRows = stats.rounds
    .map((r) => {
      const calls = r.calls.map((c) => `${esc(name(c.uid))} ${c.n}`).join(', ');
      const result =
        r.outcome === 'won'
          ? `${esc(name(r.winner))} in ${r.winMoves}`
          : r.outcome === 'open'
            ? 'in play'
            : 'nobody';
      return `<tr><th scope="row">${r.n + 1}</th><td>${esc(targetLabel(r.target))}</td><td>${secs(r.thinkMs)}</td><td>${esc(
        name(r.firstCaller),
      )}</td><td>${calls}</td><td>${result}</td></tr>`;
    })
    .join('');

  const keys = [...stats.winHist.keys(), ...stats.callHist.keys()];
  const lo = Math.min(...keys);
  const hi = Math.max(...keys);

  return (
    '<div class="viz-root">' +
    `<div class="tiles">${tiles}</div>` +
    (notes.length ? `<p class="notes">${notes.join(' ')}</p>` : '') +
    '<section class="viz-card"><h3>How soon the other calls came</h3>' +
    '<p class="sub">Each dot is one call that came after the round\'s first call, placed by how many seconds later it was made. The dark tick is the player\'s median.</p>' +
    `${timingChart(stats, name, narrow)}</section>` +
    '<div class="viz-split">' +
    '<section class="viz-card"><h3>Most used squares</h3>' +
    '<p class="sub">How often a robot passed over or stopped on each square while solutions were shown, failed tries included.</p>' +
    `${heatmap(stats)}</section>` +
    '<div class="viz-stack">' +
    '<section class="viz-card"><h3>Moves in winning solutions</h3><p class="sub">Rounds won, by the number of moves used.</p>' +
    `${stats.winHist.size ? histogram(stats.winHist, lo, hi, 'round', 'rounds', 'Rounds won by number of moves') : '<p class="empty">No wins yet.</p>'}</section>` +
    '<section class="viz-card"><h3>Calls made</h3><p class="sub">All standing calls, by the number called.</p>' +
    `${histogram(stats.callHist, lo, hi, 'call', 'calls', 'Calls by number called')}</section>` +
    '</div></div>' +
    '<section class="viz-card"><h3>Players</h3><div class="scroll"><table>' +
    '<thead><tr><th scope="col">Player</th><th scope="col">Tokens</th><th scope="col">Calls</th><th scope="col">Called first</th>' +
    '<th scope="col">Lowest call</th><th scope="col">Average call</th><th scope="col">Median delay</th><th scope="col">Exact</th>' +
    '<th scope="col">Gave up</th><th scope="col">Timed out</th><th scope="col">Nices sent</th></tr></thead>' +
    `<tbody>${playerRows}</tbody></table></div>` +
    '<p class="sub">Median delay is how long after the round\'s first call the player usually called, in rounds where someone else was first. Exact counts wins that used exactly the number called.</p></section>' +
    '<section class="viz-card"><h3>Rounds</h3><div class="scroll"><table>' +
    '<thead><tr><th scope="col">Round</th><th scope="col">Target</th><th scope="col">Wait for first call</th><th scope="col">First caller</th>' +
    '<th scope="col">Calls, in the order made</th><th scope="col">Won by</th></tr></thead>' +
    `<tbody>${roundRows}</tbody></table></div></section>` +
    '</div>'
  );
}

// One tooltip for every chart. Marks carry their text in data-tip.
export function attachTooltips(root) {
  const tipEl = document.getElementById('viz-tip');
  let current = null;

  function show(el, x, y) {
    let lines;
    try {
      lines = JSON.parse(el.dataset.tip);
    } catch {
      return;
    }
    tipEl.textContent = '';
    lines.forEach((line, i) => {
      const row = document.createElement(i === 0 ? 'strong' : 'span');
      row.textContent = line;
      tipEl.appendChild(row);
    });
    tipEl.hidden = false;
    const r = tipEl.getBoundingClientRect();
    const left = Math.min(window.innerWidth - r.width - 8, Math.max(8, x + 14));
    const topPos = y - r.height - 12 < 8 ? y + 18 : y - r.height - 12;
    tipEl.style.left = `${left}px`;
    tipEl.style.top = `${topPos}px`;
    if (current && current !== el) {
      current.classList.remove('hover');
    }
    current = el;
    el.classList.add('hover');
  }

  function hide() {
    tipEl.hidden = true;
    if (current) {
      current.classList.remove('hover');
      current = null;
    }
  }

  root.addEventListener('pointermove', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el) {
      show(el, e.clientX, e.clientY);
    } else {
      hide();
    }
  });
  root.addEventListener('pointerleave', hide);
  root.addEventListener('focusin', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el) {
      const r = el.getBoundingClientRect();
      show(el, r.left + r.width / 2, r.top);
    }
  });
  root.addEventListener('focusout', hide);
  window.addEventListener('scroll', hide, { passive: true });
}
