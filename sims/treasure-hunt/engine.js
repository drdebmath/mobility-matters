/* Treasure hunt by exploration sequences of doubling size: the engine of the simulator.
   No DOM here, so the same file runs in the page (window.THEngine) and in Node (require).

   Model. A connected simple graph whose edges carry ports: at a node v of degree deg(v) the
   edges are numbered 0 .. deg(v)-1. ports[v][q] = {to: u, back: r} means that port q at v
   leads to u and arrives there by port r. The agent starts at s and stops on the treasure.

   Algorithm [Ta-Shma & Zwick 2014]. For N = 1, 2, 4, 8, ... (one phase per N) the agent follows
   the exploration sequence for size N from where it stands: if it entered its node by port p,
   with term x it leaves by port (p + x) mod deg. At the start it has entered by no port; as in
   the atlas figure it acts as if it had entered by port 0. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.THEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- seeded randomness (stateless hashing, so a term depends only on seed, N, i) ---------- */
  function mix(a) {
    a = (a ^ (a >>> 16)) >>> 0; a = Math.imul(a, 0x7feb352d) >>> 0;
    a = (a ^ (a >>> 15)) >>> 0; a = Math.imul(a, 0x846ca68b) >>> 0;
    return (a ^ (a >>> 16)) >>> 0;
  }
  function rng(seed) {                       // mulberry32: a small seeded generator for graphs
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0; let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const randInt = (r, k) => Math.floor(r() * k);
  function shuffle(r, arr) { for (let i = arr.length - 1; i > 0; i--) { const j = randInt(r, i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }

  /* ---------- graphs ---------- */
  // order[v] lists the neighbours of v in port order (port 0 first). Simple graphs only.
  function fromOrder(pos, order, names) {
    const n = pos.length;
    const ports = order.map((nb, v) => nb.map(u => {
      const r = order[u].indexOf(v);
      if (r < 0) throw new Error(`edge ${v}-${u} is missing at ${u}`);
      return { to: u, back: r };
    }));
    let m = 0; ports.forEach(p => { m += p.length; });
    return { n, m: m / 2, pos, ports, names: names || null };
  }
  // ports numbered by angle around each node, counter-clockwise from east (math coordinates, y up)
  function byAngle(pos, adj) {
    return adj.map((nb, v) => nb.slice().sort((a, b) => ang(pos[v], pos[a]) - ang(pos[v], pos[b])));
  }
  const ang = (p, q) => { const a = Math.atan2(q[1] - p[1], q[0] - p[0]); return a < 0 ? a + 2 * Math.PI : a; };
  function adjFromEdges(n, edges) {
    const adj = Array.from({ length: n }, () => []);
    edges.forEach(([a, b]) => { if (a !== b && !adj[a].includes(b)) { adj[a].push(b); adj[b].push(a); } });
    return adj;
  }
  // fit positions into the view [W, H] with a margin
  function fit(pos, W, H, margin) {
    const xs = pos.map(p => p[0]), ys = pos.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const sx = (W - 2 * margin) / Math.max(1e-9, x1 - x0), sy = (H - 2 * margin) / Math.max(1e-9, y1 - y0);
    // the same scale on both axes, except that the shorter side may stretch by up to 1.5 to fill the view
    const s = Math.min(sx, sy), kx = Math.min(sx, 1.5 * s), ky = Math.min(sy, 1.5 * s);
    const ox = (W - kx * (x1 - x0)) / 2, oy = (H - ky * (y1 - y0)) / 2;
    return pos.map(([x, y]) => [+(ox + kx * (x - x0)).toFixed(2), +(oy + ky * (y - y0)).toFixed(2)]);
  }

  const VIEW = [100, 56];
  // The graph of the atlas figure, with the same port numbers (checked against its frames).
  function figureGraph() {
    const names = ['s', 'a', 'b', 'c', 'd', 't', 'e', 'f'];
    const id = Object.fromEntries(names.map((k, i) => [k, i]));
    const pos = [[12, 28], [32, 44], [32, 12], [54, 30], [56, 50], [78, 40], [78, 14], [94, 28]];
    const order = { s: 'ab', a: 'scd', b: 'sc', c: 'bae', d: 'at', t: 'df', e: 'cf', f: 'et' };
    return fromOrder(pos, names.map(k => order[k].split('').map(c => id[c])), names);
  }
  function ring(n) {
    const pos = Array.from({ length: n }, (_, i) => { const a = Math.PI - 2 * Math.PI * i / n; return [Math.cos(a), Math.sin(a)]; });
    const edges = Array.from({ length: n }, (_, i) => [i, (i + 1) % n]);
    return { pos, adj: adjFromEdges(n, edges) };
  }
  function grid(n) {
    const r = Math.max(2, Math.round(Math.sqrt(n / 1.8))), c = Math.max(2, Math.round(n / r));
    const pos = [], edges = [];
    for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) {
      pos.push([j, r - 1 - i]); const v = i * c + j;
      if (j + 1 < c) edges.push([v, v + 1]);
      if (i + 1 < r) edges.push([v, v + c]);
    }
    return { pos, adj: adjFromEdges(r * c, edges) };
  }
  // a random recursive tree drawn in layers from node 0 (left) to the right
  function tree(n, seed) {
    const r = rng(seed), parent = [-1];
    for (let v = 1; v < n; v++) parent.push(randInt(r, v));
    const kids = Array.from({ length: n }, () => []);
    parent.forEach((p, v) => { if (p >= 0) kids[p].push(v); });
    const depth = [0], pos = new Array(n);
    let leaf = 0;
    (function place(v) {
      kids[v].forEach(k => { depth[k] = depth[v] + 1; place(k); });
      const y = kids[v].length ? kids[v].reduce((s, k) => s + pos[k][1], 0) / kids[v].length : -(leaf++);
      pos[v] = [depth[v], y];
    })(0);
    const maxd = Math.max(...depth), leaves = Math.max(1, leaf - 1);
    // stretch the depth axis so the drawing has the aspect of the view
    return { pos: pos.map(([d, y]) => [d * leaves * (VIEW[0] / VIEW[1]) / Math.max(1, maxd), y]), adj: adjFromEdges(n, parent.map((p, v) => [p, v]).filter(e => e[0] >= 0)) };
  }
  // a random connected graph: a random spanning tree plus about n/2 more edges, laid out by forces
  function random(n, seed) {
    const r = rng(seed), edges = [];
    const perm = shuffle(r, Array.from({ length: n }, (_, i) => i));
    for (let i = 1; i < n; i++) edges.push([perm[i], perm[randInt(r, i)]]);
    const extra = Math.max(1, Math.round(n / 2));
    for (let t = 0, added = 0; added < extra && t < 50 * n; t++) {
      const a = randInt(r, n), b = randInt(r, n);
      if (a !== b && !edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) { edges.push([a, b]); added++; }
    }
    const adj = adjFromEdges(n, edges);
    return { pos: stressLayout(adj, rng(seed ^ 0x9e3779b9)), adj };
  }
  // stress majorization: drawn distances follow graph distances; then the longest spread is turned horizontal
  function stressLayout(adj, r) {
    const n = adj.length;
    const D = adj.map((_, s) => { const d = new Array(n).fill(Infinity); d[s] = 0; const q = [s]; for (let h = 0; h < q.length; h++) { const v = q[h]; adj[v].forEach(u => { if (d[u] === Infinity) { d[u] = d[v] + 1; q.push(u); } }); } return d; });
    const far = (from, avoid) => { let b = 0, bv = -1; for (let i = 0; i < n; i++) { const v = avoid ? Math.min(D[from][i], D[avoid][i]) : D[from][i]; if (v > bv) { bv = v; b = i; } } return b; };
    const a = far(0), b = far(a), c = far(a, b);   // pivots: start from the distances to two far-apart nodes
    let X = Array.from({ length: n }, (_, i) => [D[a][i] - D[b][i] + 0.05 * r(), D[c][i] + 0.05 * r()]);
    for (let it = 0; it < 300; it++) for (let i = 0; i < n; i++) {
      let sx = 0, sy = 0, sw = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const dij = D[i][j], w = 1 / (dij * dij), dx = X[i][0] - X[j][0], dy = X[i][1] - X[j][1], L = Math.hypot(dx, dy) || 1e-6;
        sx += w * (X[j][0] + dij * dx / L); sy += w * (X[j][1] + dij * dy / L); sw += w;
      }
      X[i] = [sx / sw, sy / sw];
    }
    // principal axis to the horizontal
    const mx = X.reduce((s, p) => s + p[0], 0) / n, my = X.reduce((s, p) => s + p[1], 0) / n;
    let sxx = 0, syy = 0, sxy = 0; X.forEach(([x, y]) => { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); });
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), co = Math.cos(-th), si = Math.sin(-th);
    return X.map(([x, y]) => [(x - mx) * co - (y - my) * si, (x - mx) * si + (y - my) * co]);
  }

  /* ---------- import: the text format of the MobileAutomata workbench, "n start u-v,u-v,..." ----------
     n nodes numbered 0 .. n-1, the start node, then the edges (separated by commas or spaces).
     Ports follow the order of the edges: at each node, port 0 is its first edge in the list.
     Throws an Error whose message can be shown to the reader. */
  const MAX_IMPORT = 100;
  function parseGraphText(text) {
    const t = String(text == null ? '' : text).trim();
    if (!t) throw new Error('Paste a graph as: n start u-v,u-v,… with nodes 0 … n−1.');
    const m = t.match(/^(\S+)\s+(\S+)\s*([\s\S]*)$/);
    if (!m) throw new Error('Expected: n start u-v,u-v,… (for example 4 0 0-1,0-2,1-3).');
    const n = Number(m[1]), s = Number(m[2]);
    if (!Number.isInteger(n) || n < 2 || n > MAX_IMPORT) throw new Error(`n must be a whole number from 2 to ${MAX_IMPORT} (got "${m[1]}").`);
    if (!Number.isInteger(s) || s < 0 || s >= n) throw new Error(`The start must be a node from 0 to ${n - 1} (got "${m[2]}").`);
    const edges = [], seen = new Set(); let repeated = 0;
    for (const tok of m[3].split(/[\s,;]+/).filter(Boolean)) {
      const e = tok.match(/^(\d+)-(\d+)$/);
      if (!e) throw new Error(`Bad edge "${tok}": write u-v with nodes 0 … ${n - 1}.`);
      const u = +e[1], v = +e[2];
      if (u >= n || v >= n) throw new Error(`Edge ${tok} names a node outside 0 … ${n - 1}.`);
      if (u === v) throw new Error(`Edge ${tok} is a loop; the graph must be simple.`);
      const key = Math.min(u, v) + '-' + Math.max(u, v);
      if (seen.has(key)) { repeated++; continue; }
      seen.add(key); edges.push([u, v]);
    }
    if (!edges.length) throw new Error('No edges: list them after n and the start, as u-v,u-v,…');
    const adj = adjFromEdges(n, edges);
    const d = new Array(n).fill(false); d[s] = true; const q = [s];
    for (let h = 0; h < q.length; h++) adj[q[h]].forEach(u => { if (!d[u]) { d[u] = true; q.push(u); } });
    const out = []; d.forEach((x, v) => { if (!x) out.push(v); });
    if (out.length) throw new Error(`The graph is not connected: ${out.length} node${out.length > 1 ? 's' : ''} cannot be reached from the start (${out.slice(0, 8).join(', ')}${out.length > 8 ? ', …' : ''}). Treasure hunt needs a connected graph.`);
    return { n, start: s, edges, adj, repeated, text: `${n} ${s} ${edges.map(([u, v]) => u + '-' + v).join(',')}` };
  }

  const KINDS = ['figure', 'ring', 'grid', 'tree', 'random', 'import'];
  // opts: {kind, n, gseed, pseed, text}; pseed 0 keeps the default port numbers, otherwise they are shuffled
  function makeGraph(opts) {
    const kind = KINDS.includes(opts.kind) ? opts.kind : 'figure';
    const n = Math.max(3, Math.min(40, opts.n | 0 || 10)), gseed = opts.gseed >>> 0 || 1;
    let g;
    if (kind === 'figure') g = figureGraph();
    else if (kind === 'import') {
      const P = parseGraphText(opts.text);
      g = fromOrder(fit(stressLayout(P.adj, rng(0x51ed)), VIEW[0], VIEW[1], 6), P.adj);
      g.start = P.start; g.imported = P;
    } else {
      const raw = kind === 'ring' ? ring(n) : kind === 'grid' ? grid(n) : kind === 'tree' ? tree(n, gseed) : random(n, gseed);
      const pos = fit(raw.pos, VIEW[0], VIEW[1], 6);
      g = fromOrder(pos, byAngle(pos, raw.adj));
    }
    if (opts.pseed) {
      const r = rng(mix(opts.pseed >>> 0));
      const order = g.ports.map(ps => shuffle(r, ps.map(p => p.to)));
      const keep = { start: g.start, imported: g.imported };
      g = fromOrder(g.pos, order, g.names); Object.assign(g, keep);
    }
    g.kind = kind; g.view = VIEW.slice();
    return g;
  }

  /* ---------- distances and the cost yardsticks ---------- */
  function distances(g, s) {
    const d = new Array(g.n).fill(Infinity); d[s] = 0; const q = [s];
    for (let h = 0; h < q.length; h++) { const v = q[h]; g.ports[v].forEach(({ to }) => { if (d[to] === Infinity) { d[to] = d[v] + 1; q.push(to); } }); }
    return d;
  }
  // e(d): the number of edges with an endpoint at distance less than d from s
  function eOf(g, dist, d) {
    let c = 0;
    for (let v = 0; v < g.n; v++) g.ports[v].forEach(({ to }) => { if (v < to && (dist[v] < d || dist[to] < d)) c++; });
    return c;
  }

  /* ---------- exploration sequences ---------- */
  // The figure's short illustrative sequences (not universal); from N = 16 on, random ones.
  const FIGURE_SEQ = { 1: [2], 2: [1, 2], 4: [1, 1, 2, 0], 8: [1, 2, 1, 1, 1, 1, 2, 2] };
  const SEQ_KINDS = ['figure', 'n3', 'n2'];
  function sequence(mode, N, seed) {
    if (mode === 'figure' && FIGURE_SEQ[N]) { const a = FIGURE_SEQ[N]; return { length: a.length, term: i => a[i], illustrative: true }; }
    const len = mode === 'n2' ? N * N : N * N * N, base = mix(mix(seed >>> 0) ^ Math.imul(N, 0x9e3779b1));
    return { length: len, term: i => mix(base ^ mix(i + 1)) % N, illustrative: false };
  }

  /* ---------- a run ---------- */
  const MAX_MOVES = 5e6;
  function Run(g, opts) {
    this.g = g; this.start = opts.start; this.treasure = opts.treasure;
    this.mode = SEQ_KINDS.includes(opts.seq) ? opts.seq : 'figure'; this.seed = opts.seed >>> 0 || 1;
    this.dist = distances(g, this.start);
    this.d = this.dist[this.treasure]; this.ed = eOf(g, this.dist, this.d);
    this.reset();
  }
  Run.prototype.reset = function () {
    this.v = this.start; this.p = 0; this.k = 0; this.N = 1; this.i = 0; this.moves = 0;
    this.seq = sequence(this.mode, 1, this.seed);
    this.found = this.v === this.treasure; this.stopped = false; this.last = null;
    this.visited = new Set([this.v]); this.phaseEdges = new Map(); this.phaseNodes = new Set([this.v]);
    this.foundPhase = this.found ? 1 : null;
    this.log = [{ N: 1, len: this.seq.length, moves: 0 }];   // moves made in each phase so far
  };
  Run.prototype.done = function () { return this.found || this.stopped; };
  // one move; returns what happened (or null when the run is over)
  Run.prototype.step = function () {
    if (this.done()) return null;
    if (this.moves >= MAX_MOVES) { this.stopped = true; return null; }
    const v = this.v, deg = this.g.ports[v].length, x = this.seq.term(this.i);
    const out = (this.p + x) % deg, { to, back } = this.g.ports[v][out];
    const mv = { from: v, to, p: this.p, x, deg, out, back, N: this.N, i: this.i, len: this.seq.length };
    this.v = to; this.p = back; this.moves++; this.i++;
    this.visited.add(to); this.phaseNodes.add(to); this.log[this.log.length - 1].moves++;
    const key = v < to ? v + '-' + to : to + '-' + v; this.phaseEdges.set(key, (this.phaseEdges.get(key) || 0) + 1);
    if (to === this.treasure) { this.found = true; this.foundPhase = this.N; }
    else if (this.i >= this.seq.length) {
      this.k++; this.N = 2 ** this.k; this.i = 0; this.seq = sequence(this.mode, this.N, this.seed);
      this.phaseEdges = new Map(); this.phaseNodes = new Set([to]);
      this.log.push({ N: this.N, len: this.seq.length, moves: 0 });
      mv.phaseEnded = true;
    }
    this.last = mv;
    return mv;
  };
  // the first phase whose size N is at least n: from there a universal sequence must reach the treasure
  Run.prototype.guaranteedPhase = function () { let N = 1; while (N < this.g.n) N *= 2; return N; };

  return { makeGraph, parseGraphText, MAX_IMPORT, distances, eOf, sequence, Run, KINDS, SEQ_KINDS, FIGURE_SEQ, MAX_MOVES, rng, mix };
});
