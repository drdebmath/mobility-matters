/* Open Problems Catalogue — renderer.
   Vanilla JS, hash routing. Data lives in data/*.json; see AGENTS.md for the schema. */
(() => {
  'use strict';

  const state = { index: null, models: {}, problems: {}, refs: {}, overviews: {} };
  const app = document.getElementById('app');
  // Hash routes are slash-separated on a normal server. A single-file build may
  // set window.CATALOGUE_HASH_SEP to '.' to get dot-separated anchors, which
  // survive hosts that only pass plain anchors through.
  const SEP = (window.CATALOGUE_HASH_SEP === '.') ? '.' : '/';
  const L = (...parts) => '#' + (SEP === '/' ? '/' : '') + parts.filter(x => x !== undefined && x !== null && x !== '').join(SEP);

  /* ---------- utilities ---------- */
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const stripP = h => h.replace(/^<p>|<\/p>\s*$/g, '');

  function tex(src, display = false) {
    if (!src) return '';
    try { return katex.renderToString(src, { throwOnError: false, displayMode: display, strict: 'ignore' }); }
    catch (e) { return `<code>${esc(src)}</code>`; }
  }

  // Text with $...$ math only (no Markdown): used for labels and chips.
  function fmt(text) {
    if (!text) return '';
    return esc(text).replace(/\$([^$]+?)\$/g, (m, x) => tex(x.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')));
  }

  function shortCite(key) {
    const r = state.refs[key];
    if (!r) return key;
    if (r.short) return r.short;
    const last = name => {
      const parts = name.trim().split(/\s+/);
      let s = parts[parts.length - 1];
      let i = parts.length - 1;
      if (/^(Jr\.?|Sr\.?|II|III)$/.test(s) && parts.length > 1) { i -= 1; s = parts[i] + ' ' + s; }
      while (i > 1 && /^(de|De|di|Di|van|von|der|den|da|Da|du|Du|del|Del|della|Della|le|Le|la|La|dos|auf)$/.test(parts[i - 1])) { i -= 1; s = parts[i] + ' ' + s; } // particles: De Marco, Di Luna, van Renssen
      if (parts[i] === 'auf' && i > 1) s = parts[i - 1] + ' ' + s; // Meyer auf der Heide
      return s;
    };
    const a = (r.authors || []).map(last);
    const who = a.length <= 1 ? (a[0] || '?') : a.length === 2 ? `${a[0]} & ${a[1]}` : `${a[0]} et al.`;
    return `${who} ${r.year || ''}`.trim();
  }

  function isOwn(key) {
    const r = state.refs[key], o = state.index && state.index.owner;
    return !!(r && o && (r.authors || []).some(a => a.trim() === o.trim()));
  }

  function citeLink(key) {
    const r = state.refs[key];
    const title = r ? esc(r.title) : 'unknown reference';
    return `<a class="cite" href="${L('references', key)}" title="${title}">${esc(shortCite(key))}</a>`;
  }

  // Markdown + math + [Key] citations.
  function md(text) {
    if (!text) return '';
    const maths = [];
    let t = String(text)
      .replace(/\$\$([\s\S]+?)\$\$/g, (m, x) => { maths.push([x, true]); return `@@M${maths.length - 1}@@`; })
      .replace(/\$([^$\n]+?)\$/g, (m, x) => { maths.push([x, false]); return `@@M${maths.length - 1}@@`; });
    t = t.replace(/\[([A-Z][A-Za-z]*\d{4}[A-Za-z0-9]*)\]/g, (m, key) => state.refs[key] ? `@@C${key}@@` : m);
    let html = marked.parse(t);
    html = html.replace(/@@M(\d+)@@/g, (m, i) => tex(maths[i][0], maths[i][1]));
    html = html.replace(/@@C([A-Za-z0-9]+)@@/g, (m, key) => citeLink(key));
    return html;
  }
  const mdInline = text => stripP(md(text));

  const STATUS_LABEL = { tight: 'tight', near: 'near-optimal', gap: 'polynomial gap', unknown: 'unknown', impossible: 'impossible' };
  const ROLE_LABEL = { introductory: 'introductory', best: 'current best', other: 'also', disputed: 'disputed proof' };

  /* ---------- data ---------- */
  async function loadJSON(path) {
    const r = await fetch(path, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.json();
  }

  async function loadAll() {
    const bundle = window.CATALOGUE_DATA; // set by scripts/build-artifact.py
    const idx = bundle ? bundle.index : await loadJSON('data/index.json');
    state.index = idx;
    const [models, problems, refs] = bundle
      ? [idx.models.map(id => bundle.models[id]), idx.problems.map(id => bundle.problems[id]), bundle.references]
      : await Promise.all([
        Promise.all(idx.models.map(id => loadJSON(`data/models/${id}.json`))),
        Promise.all(idx.problems.map(id => loadJSON(`data/problems/${id}.json`))),
        loadJSON('data/references.json'),
      ]);
    state.refs = refs;
    state.notation = bundle ? (bundle.notation || null) : await loadJSON('data/notation.json').catch(() => null);
    state.acks = bundle ? (bundle.acknowledgements || null) : await loadJSON('data/acknowledgements.json').catch(() => null);
    const ovIds = idx.overviews || [];
    const ovs = bundle ? ovIds.map(id => bundle.overviews && bundle.overviews[id]).filter(Boolean)
      : await Promise.all(ovIds.map(id => loadJSON(`data/overviews/${id}.json`)));
    ovs.forEach(o => { state.overviews[o.id] = o; });
    models.forEach(m => { state.models[m.id] = m; });
    problems.forEach(p => { prepareProblem(p); state.problems[p.id] = p; });
    const ft = document.getElementById('footer-text');
    const ver = (idx.citation || {}).version;
    if (ft) ft.innerHTML = `${esc(idx.title)}${ver ? ` · version ${esc(ver)}` : ''}${idx.owner ? ' · maintained by ' + (idx.owner_url ? `<a href="${esc(idx.owner_url)}" rel="noopener">${esc(idx.owner)}</a>` : esc(idx.owner)) : ''}${idx.license ? ' · ' + (idx.license_url ? `<a href="${esc(idx.license_url)}" rel="noopener">${esc(idx.license)}</a>` : esc(idx.license)) : ''}
      <div class="foot-links">${idx.repo ? `<a href="${esc(issueUrl('new-result.yml', {}))}" rel="noopener">Suggest a result</a> · <a href="${esc(issueUrl('error.yml', {}))}" rel="noopener">Report an error</a> · <a href="${esc(issueUrl('new-problem.yml', {}))}" rel="noopener">Suggest a problem</a> · ` : ''}<a href="about.html">About</a> · <a href="${L('acknowledgements')}">Acknowledgements</a>${idx.changelog_url ? ` · <a href="${esc(idx.changelog_url)}" rel="noopener">Changelog</a>` : ''}${idx.repo ? ` · <a href="${esc(idx.repo)}" rel="noopener">Source</a>` : ''}</div>`;
    if (idx.repo) { const l = document.getElementById('repo-link'); l.href = idx.repo; l.hidden = false; }
  }

  /* ---------- the assumption tree ----------
     Every axis value has a level; level 0 means "nothing assumed" on that axis. A
     variant lists the assumptions it makes. The tree is computed: its root assumes
     nothing, every node is an assumption set, and every edge adds assumptions in the
     problem's axis order. Nodes that host no variant but where branches split are
     kept as branch points (named after the axis that splits them), so the tree shows every logical combination on the
     way from no assumptions to each catalogued variant. */
  function prepareProblem(p) {
    const model = state.models[p.model];
    p.axes_local = p.axes || [];
    const merged = new Map();
    [...(model ? model.axes : []), ...(p.axes || [])].forEach(a => merged.set(a.id, a));
    (p.ignore_axes || []).forEach(id => merged.delete(id)); // model axes that do not apply to this problem
    const order = (p.axis_order || [...merged.keys()]).filter(id => merged.has(id));
    p.axes = [...order, ...[...merged.keys()].filter(id => !order.includes(id))].map(id => merged.get(id));
    p.axisById = Object.fromEntries(p.axes.map(a => [a.id, a]));
    p.axisIndex = Object.fromEntries(p.axes.map((a, i) => [a.id, i]));
    p.zero = Object.fromEntries(p.axes.map(a => [a.id, (a.values.find(x => !x.level) || a.values[0]).id]));
    const atomsOf = asm => p.axes.filter(a => levelOf(p, a.id, asm[a.id]) > 0).map(a => [a.id, asm[a.id]]);
    const key = atoms => atoms.map(([a, x]) => `${a}=${x}`).join('|');
    const raw = new Map();
    const ensure = atoms => { const k = key(atoms); if (!raw.has(k)) raw.set(k, { atoms, kids: new Set(), variant: null }); return raw.get(k); };
    ensure([]);
    p.byId = {};
    p.variants.forEach(v => {
      v.given = v.given || { ...(v.assumptions || {}) };
      v.assumptions = { ...p.zero, ...v.given };
      v.atoms = atomsOf(v.assumptions);
      for (let i = 1; i <= v.atoms.length; i++) { ensure(v.atoms.slice(0, i)); raw.get(key(v.atoms.slice(0, i - 1))).kids.add(key(v.atoms.slice(0, i))); }
      const r = ensure(v.atoms);
      if (!r.variant) r.variant = v;
      p.byId[v.id] = v;
    });
    const kept = k => k === '' || raw.get(k).variant || raw.get(k).kids.size >= 2;
    const keptKids = k => [...raw.get(k).kids].flatMap(c => kept(c) ? [c] : keptKids(c));
    p.nodes = {};
    const build = (k, parent) => {
      const r = raw.get(k);
      const n = { atoms: r.atoms, variant: r.variant, parent, depth: parent ? parent.depth + 1 : 0 };
      n.id = r.variant ? r.variant.id : (k === '' ? 'root' : 'at_' + r.atoms.map(x => x[1]).join('_'));
      if (p.nodes[n.id]) n.id = 'at_' + r.atoms.map(x => x.join('-')).join('_');
      n.assumptions = { ...p.zero, ...Object.fromEntries(r.atoms) };
      n.path = parent ? [...parent.path, n] : [n];
      p.nodes[n.id] = n;
      if (r.variant) r.variant.node = n;
      n.children = keptKids(k).map(c => build(c, n));
      n.size = (n.variant ? 1 : 0) + n.children.reduce((s, c) => s + c.size, 0);
      return n;
    };
    p.root = build('', null);
    // edge labels: the assumptions a child adds, plus the "nothing assumed" values on
    // axes where a sibling branch does assume something (so every branch says what it is)
    const label = n => {
      const kids = n.children;
      kids.forEach(c => {
        const added = c.atoms.slice(n.atoms.length);
        const first = added.length ? p.axisIndex[added[0][0]] : Infinity;
        const sibAxes = new Set();
        kids.forEach(s => { if (s !== c) s.atoms.slice(n.atoms.length).forEach(([a]) => { if (p.axisIndex[a] < first) sibAxes.add(a); }); });
        c.edge = { zeros: p.axes.filter(a => sibAxes.has(a.id)).map(a => [a.id, p.zero[a.id]]), added };
      });
      kids.sort((a, b) => b.size - a.size || (a.variant ? 0 : 1) - (b.variant ? 0 : 1));
      kids.forEach(label);
    };
    p.root.edge = { zeros: [], added: [] };
    label(p.root);
    // the axes on which a node's branches part: the first axis of each child's edge
    const splitOf = n => {
      const ids = new Set(n.children.map(c => { const e = c.edge; const f = e.zeros[0] || e.added[0]; return f ? f[0] : null; }).filter(Boolean));
      n.split = p.axes.filter(a => ids.has(a.id));
      n.children.forEach(splitOf);
    };
    splitOf(p.root);
    p.order = [];
    const walk = n => { p.order.push(n); n.children.forEach(walk); };
    walk(p.root);
    p.base = (p.variants.find(v => v.standard) || p.variants[0] || {}).node || p.root;
  }

  function levelOf(p, axisId, valueId) {
    const ax = p.axisById[axisId];
    const v = ax && ax.values.find(x => x.id === valueId);
    return v ? (v.level || 0) : 0;
  }
  // A is at most as strong as B (every assumption of A is implied by B)
  const weakerOrEqual = (p, A, B) => p.axes.every(a => A[a.id] === B[a.id] || levelOf(p, a.id, A[a.id]) < levelOf(p, a.id, B[a.id]));
  function implied(p, node) {
    const others = p.variants.filter(v => v.node !== node);
    const weaker = others.filter(v => weakerOrEqual(p, v.assumptions, node.assumptions));
    const stronger = others.filter(v => weakerOrEqual(p, node.assumptions, v.assumptions));
    const maximal = weaker.filter(v => !weaker.some(w => w !== v && weakerOrEqual(p, v.assumptions, w.assumptions)));
    const minimal = stronger.filter(v => !stronger.some(w => w !== v && weakerOrEqual(p, w.assumptions, v.assumptions)));
    return { weaker: maximal, stronger: minimal };
  }

  function valueOf(p, axisId, valueId) {
    const ax = p.axisById[axisId];
    const fallback = { id: valueId, label: valueId, level: 0 };
    return ax ? (ax.values.find(x => x.id === valueId) || fallback) : fallback;
  }

  const statusOf = (v, m) => (v && v.optimality && v.optimality[m] && v.optimality[m].status) || 'unknown';
  const lowerBounds = (v, m) => (v.lower_bounds || []).filter(b => b.measure === m);
  const lowerBound = (v, m) => lowerBounds(v, m)[0] || null;
  const introResult = (v, m) => (v.results || []).filter(r => r[m]).find(r => r.role === 'introductory') || null;
  function bestResult(v, m) {
    // The 'best' entry for this measure; if no 'best' entry carries the measure,
    // the most recent result that does (results are listed chronologically).
    const rs = (v.results || []).filter(r => r[m] && r.role !== 'disputed');
    return rs.find(r => r.role === 'best') || rs[rs.length - 1] || null;
  }

  /* ---------- pieces ---------- */
  // level 0 = nothing assumed on this axis (muted); level > 0 = an assumption (marked +)
  function chip(p, axisId, valueId, changed, withAxis = true) {
    const ax = p.axisById[axisId] || { name: axisId };
    const val = valueOf(p, axisId, valueId);
    const cls = val.level > 0 ? 'stronger' : 'base';
    const title = val.description ? ` title="${esc(val.description.replace(/\$/g, ''))}"` : '';
    return `<span class="chip ${cls}${changed ? ' changed' : ''}"${title}>${val.level > 0 ? '<b>+</b>' : ''}${withAxis ? `<span class="ax">${esc(ax.name)}</span>` : ''}${fmt(val.label)}</span>`;
  }
  const shortOf = (p, a, x) => { const v = valueOf(p, a, x); return v.short || v.label; };
  function edgeChips(p, n) {
    const e = n.edge || { zeros: [], added: [] };
    return [...e.zeros.map(([a, x]) => `<span class="chip base" title="${esc(p.axisById[a].name)}: nothing assumed">${fmt(shortOf(p, a, x))}</span>`),
      ...e.added.map(([a, x]) => `<span class="chip stronger"><b>+</b>${fmt(shortOf(p, a, x))}</span>`)].join('');
  }
  function edgeText(p, n) {
    if (!n.parent) return 'no assumptions';
    const e = n.edge;
    return [...e.zeros.map(([a, x]) => shortOf(p, a, x)), ...e.added.map(([a, x]) => '+ ' + shortOf(p, a, x))].join(', ');
  }
  const nodeTitle = (p, n) => n.variant ? n.variant.title : (n.parent ? (n.split.map(a => a.name).join(' · ') || 'Branch point') : 'No assumptions');
  function settingText(p, n) {
    const xs = n.atoms.map(([a, x]) => shortOf(p, a, x));
    return xs.length ? xs.join(' · ') : 'nothing assumed on any axis';
  }
  function dots(p, n) {
    if (!n.variant) return `<span class="dots">${p.measures.map(m => `<span class="dot hollow" title="${esc(m.name)}: no variant catalogued here"></span>`).join('')}</span>`;
    return `<span class="dots">${p.measures.map(m => `<span class="dot ${statusOf(n.variant, m.id)}" title="${esc(m.name)}: ${STATUS_LABEL[statusOf(n.variant, m.id)]}"></span>`).join('')}</span>`;
  }
  function statusStrip(p, v) {
    return `<div class="strip">${p.measures.map(m => { const st = statusOf(v, m.id); return `<span class="pill ${st}"><span class="dot ${st}"></span>${esc(m.name)}: ${STATUS_LABEL[st]}</span>`; }).join('')}</div>`;
  }

  function meter(v, measure) {
    const st = statusOf(v, measure);
    const note = v.optimality && v.optimality[measure] && v.optimality[measure].note;
    return `<div class="meter ${st}"><span class="badge ${st}">${STATUS_LABEL[st]}</span><div class="bar" title="${STATUS_LABEL[st]}"></div>
      <span class="gapnote">${note ? mdInline(note) : ''}</span></div>`;
  }

  function lbCell(v, m) {
    const lbs = lowerBounds(v, m.id);
    if (!lbs.length) return `<div class="kcell"><small>lower bound</small><span class="muted">none known</span></div>`;
    return `<div class="kcell">
      <small>lower bound${lbs.length > 1 ? 's' : ''}</small>
      ${lbs.map(lb => `<div class="lb">
        <div class="bound">${tex(lb.bound)}${lb.ref ? ` <span class="cite-after">${citeLink(lb.ref)}</span>` : ''}</div>
        ${lb.bottleneck ? `<div class="lb-row"><span class="lbl">bottleneck</span><span class="bottleneck">${fmt(lb.bottleneck)}</span></div>` : ''}
        ${lb.preconditions && lb.preconditions.length ? `<div class="lb-row"><span class="lbl">holds when</span><ul class="pre">${lb.preconditions.map(x => `<li>${mdInline(x)}</li>`).join('')}</ul></div>` : ''}
        ${lb.note ? `<div class="small muted">${mdInline(lb.note)}</div>` : ''}
      </div>`).join('')}
    </div>`;
  }

  function ubCell(label, r, m) {
    if (!r) return `<div class="kcell"><small>${label}</small><span class="muted">—</span></div>`;
    return `<div class="kcell"><small>${label}</small>
      <div class="bound">${tex(r[m.id])}</div>
      <div>${citeLink(r.ref)}</div>
      ${r.assumes && r.assumes.length ? `<div class="chips tiny">${r.assumes.map(a => `<span class="chip assume">${fmt(a)}</span>`).join('')}</div>` : ''}
    </div>`;
  }

  function knownBlock(p, v, m) {
    return `<div class="known">
      <div class="kname">${esc(m.name)}<span class="muted small"> · ${fmt(m.description)}</span></div>
      ${meter(v, m.id)}
      <div class="kgrid">${lbCell(v, m)}${ubCell('introductory', introResult(v, m.id), m)}${ubCell('current best', bestResult(v, m.id), m)}</div>
    </div>`;
  }

  // Compact outline (sidebar): one line per node, the edge as text under the title.
  function tree(p, selected) {
    const node = n => `<li><a class="${n.id === selected ? 'active' : ''}${n.variant ? '' : ' gapnode'}" href="${L('problem', p.id, n.id)}"><span class="t">${fmt(nodeTitle(p, n))}${n.parent ? `<span class="delta">${fmt(edgeText(p, n))}</span>` : ''}</span>${dots(p, n)}</a>
        ${n.children.length ? `<ul>${n.children.map(node).join('')}</ul>` : ''}</li>`;
    return `<ul class="tree">${node(p.root)}</ul>`;
  }

  // Full drawn tree (problem home): connectors, edge chips, summaries.
  function bigTree(p) {
    const node = n => {
      const v = n.variant;
      return `<li class="${v ? 'named' : 'gap'}${v && v.standard ? ' standard' : ''}">
        ${n.parent ? `<div class="edge chips tiny">${edgeChips(p, n)}</div>` : ''}
        <a class="node" href="${L('problem', p.id, n.id)}">
          <span class="nt">${fmt(nodeTitle(p, n))}${!v ? `<span class="split"> · ${n.children.length} branches${n.parent ? '' : ` by ${n.split.map(x => x.name.toLowerCase()).join(', ')}`}</span>` : ''}${v && v.standard ? ' <span class="badge std">standard setting</span>' : ''}${v && v.status === 'draft' ? ' <span class="badge draft">draft</span>' : ''}</span>
          ${dots(p, n)}
          ${v ? `<span class="ns">${fmt(v.summary)}</span>` : (n.parent ? '' : '<span class="ns">Nothing is assumed on any axis.</span>')}
        </a>
        ${n.children.length ? `<ul>${n.children.map(node).join('')}</ul>` : ''}</li>`;
    };
    return `<ul class="bigtree">${node(p.root)}</ul>`;
  }

  /* ---------- pages ---------- */
  const familyOf = pid => (state.index.families || []).find(f => (f.problems || []).includes(pid)) || null;
  const problemCard = p => `<a class="card" href="${L('problem', p.id)}">
          <h3>${esc(p.name)}</h3><div class="summary">${fmt(p.summary)}</div>
          <div class="small muted">${p.variants.length} variant${p.variants.length === 1 ? '' : 's'} · ${(q => `${q} open question${q === 1 ? '' : 's'}`)(p.variants.reduce((n, v) => n + (v.open || []).length, 0))}</div></a>`;
  // A problem may be derived from another (derived_from.problem): a solution of the
  // derived problem solves the parent under the same assumptions, so lower bounds
  // flow from the parent to the derived problem and algorithms flow back.
  const parentOf = p => p.derived_from && state.problems[p.derived_from.problem] || null;
  const derivedOf = p => state.index.problems.map(id => state.problems[id]).filter(q => q && parentOf(q) === p);
  // related problems (no hierarchy): listed on both sides
  const relatedOf = p => {
    const out = (p.related || []).filter(r => state.problems[r.problem]).map(r => ({ q: state.problems[r.problem], relation: r.relation }));
    state.index.problems.map(id => state.problems[id]).filter(q => q && q !== p).forEach(q => (q.related || []).forEach(r => {
      if (r.problem === p.id && !out.some(x => x.q === q)) out.push({ q, relation: r.relation });
    }));
    return out;
  };
  // derived problems grouped by the kind of link, in order of first appearance
  const kindGroups = kids => { const g = new Map(); kids.forEach(q => { const k = q.derived_from.kind || 'derived from'; if (!g.has(k)) g.set(k, []); g.get(k).push(q); }); return [...g.entries()]; };
  function familyTree(ps) {
    const inFam = new Set(ps.map(p => p.id));
    const roots = ps.filter(p => !parentOf(p) || !inFam.has(parentOf(p).id));
    const branch = p => {
      const kids = derivedOf(p).filter(q => inFam.has(q.id));
      const rel = relatedOf(p);
      const deep = q => derivedOf(q).some(r => inFam.has(r.id));
      return `<div class="fnode${kids.length ? ' has-kids' : ''}">${problemCard(p)}${rel.length ? `<div class="frel">related to ${rel.map(r => `<a href="${L('problem', r.q.id)}">${esc(r.q.name)}</a>`).join(', ')}</div>` : ''}${kids.length ? `<div class="fkids${kids.length > 1 ? ' many' : ''}"><div class="fgrid">${kindGroups(kids).map(([kind, qs]) => qs.map((q, i) => `<div class="fderived${deep(q) ? ' deep' : ''}"><span class="eyebrow${i ? ' rep' : ''}">${esc(kind)} ${esc(p.name)}</span>${branch(q)}</div>`).join('')).join('')}</div></div>` : ''}</div>`;
    };
    return `<div class="ftree">${roots.map(branch).join('')}</div>`;
  }
  function familiesHtml(probs) {
    const fams = (state.index.families || []).map(f => ({ f, ps: probs.filter(p => (f.problems || []).includes(p.id)) })).filter(x => x.ps.length);
    const loose = probs.filter(p => !familyOf(p.id));
    return fams.map(({ f, ps }) => `<div class="family"><h3 class="fam-h"><span class="eyebrow">Problem family</span>${esc(f.name)}</h3>
        ${f.summary ? `<p class="muted small">${mdInline(f.summary)}</p>` : ''}
        ${(f.related || []).filter(r => state.problems[r.problem]).map(r => `<div class="frel">this family is related to <a href="${L('problem', r.problem)}">${esc(state.problems[r.problem].name)}</a>: ${mdInline(r.relation)}</div>`).join('')}
        ${familyTree(ps)}</div>`).join('')
      + (loose.length ? `<div class="family"><h3 class="fam-h">Other problems</h3><div class="cards">${loose.map(problemCard).join('')}</div></div>` : '');
  }

  // status counts over every (variant, measure) pair of a list of problems
  function statusTally(probs) {
    const t = { tight: 0, near: 0, gap: 0, unknown: 0, impossible: 0 };
    probs.forEach(p => p.variants.forEach(v => p.measures.forEach(m => { const st = statusOf(v, m.id); if (st in t) t[st]++; })));
    return t;
  }
  const STATUS_ORDER = [['tight', 'tight'], ['near', 'near-optimal'], ['gap', 'polynomial gap'], ['unknown', 'unknown'], ['impossible', 'impossible']];
  function statusBar(t, legend) {
    const total = Object.values(t).reduce((a, b) => a + b, 0) || 1;
    return `<div class="sbar" role="img" aria-label="${STATUS_ORDER.map(([k, l]) => `${t[k]} ${l}`).join(', ')}">${STATUS_ORDER.filter(([k]) => t[k]).map(([k, l]) => `<span class="sb-${k}" style="flex:${t[k]}" title="${t[k]} ${l}"></span>`).join('')}</div>
      ${legend ? `<div class="sbar-legend">${STATUS_ORDER.map(([k, l]) => `<span><i class="sb-${k}"></i><b>${t[k]}</b> ${l}</span>`).join('')}</div>` : ''}`;
  }

  function homePage() {
    const idx = state.index;
    const probsAll = idx.problems.map(id => state.problems[id]).filter(Boolean);
    const nVar = probsAll.reduce((n, p) => n + p.variants.length, 0);
    const nOpen = probsAll.reduce((n, p) => n + p.variants.reduce((k, v) => k + (v.open || []).length, 0), 0);
    const nRefs = Object.keys(state.refs).length;
    const modelCard = (mid, i) => {
      const m = state.models[mid];
      const probs = probsAll.filter(p => p.model === mid);
      const fams = (idx.families || []).map(f => ({ f, ps: (f.problems || []).map(id => state.problems[id]).filter(p => p && p.model === mid) })).filter(x => x.ps.length);
      const open = probs.reduce((n, p) => n + p.variants.reduce((k, v) => k + (v.open || []).length, 0), 0);
      const inFam = ps => new Set(ps.map(p => p.id));
      const famHtml = fams.map(({ f, ps }) => {
        const ids = inFam(ps);
        const roots = ps.filter(p => !parentOf(p) || !ids.has(parentOf(p).id));
        const walk = (p, d) => [`<a class="plink${d ? ' derived' : ''}" href="${L('problem', p.id)}" title="${esc(p.summary.replace(/\$/g, ''))}">${esc(p.name)}</a>`]
          .concat(derivedOf(p).filter(q => ids.has(q.id)).flatMap(q => walk(q, d + 1)));
        return `<div class="mfam"><h4>${esc(f.name)}</h4><div class="plinks">${roots.flatMap(r => walk(r, 0)).join('')}</div></div>`;
      }).join('');
      return `<article class="mcard m${i % 4}">
        <header><span class="eyebrow">Model ${i + 1}</span><h3><a href="${L('model', m.id)}">${esc(m.name)}</a></h3>
          <p class="muted">${fmt(m.summary)}</p></header>
        <div class="mstats"><span><b>${probs.length}</b> problems</span><span><b>${probs.reduce((n, p) => n + p.variants.length, 0)}</b> settings</span><span><b>${open}</b> open questions</span></div>
        ${statusBar(statusTally(probs), false)}
        <div class="mfams">${famHtml}</div>
        <a class="mmore" href="${L('model', m.id)}">Axes, definitions and problem trees →</a>
      </article>`;
    };
    const ovs = (idx.overviews || []).map(id => state.overviews[id]).filter(Boolean);
    return `<section class="home-hero">
        <div class="hh-text">
          <h1>${esc(idx.title)}</h1>
          ${idx.subtitle ? `<p class="subtitle">${esc(idx.subtitle)}</p>` : ''}
          <p class="tagline">${esc(idx.tagline)}</p>
          ${aiNote('sub')}
          <p class="hh-intro">${mdInline(idx.intro || 'Every problem is a tree of settings. Its root assumes nothing; each edge adds one assumption, until it reaches the settings studied in the literature. Each setting records the proven lower bounds and what forces them, the paper that introduced it, the current best result, and the gap between them.')}</p>
          <div class="hh-links"><a class="btn" href="${L('explore')}">Explore by assumptions</a><a class="btn" href="${L('open')}">Open questions</a><a class="btn ghost" href="${L('timeline')}">Timeline</a><a class="btn ghost" href="${L('references')}">References</a><a class="btn ghost" href="${esc((idx.citation || {}).pdf || 'mobility-matters.pdf')}">PDF</a></div>
        </div>
        <aside class="hh-glance panel">
          <span class="eyebrow">At a glance</span>
          <div class="glance-nums"><div><b>${probsAll.length}</b><span>problems</span></div><div><b>${nVar}</b><span>settings</span></div><div><b>${nOpen}</b><span>open questions</span></div><div><b>${nRefs}</b><span>papers</span></div></div>
          <span class="eyebrow">How close the bounds are</span>
          ${statusBar(statusTally(probsAll), true)}
          <p class="small muted">One count per setting and measure: the best upper bound against the best lower bound.</p>
        </aside>
      </section>
      ${homeSwitch('logical')}
      <div class="mgrid">${idx.models.map(modelCard).join('')}</div>
      ${ovs.length ? `<div class="section-title"><h2>Perspectives</h2><span class="muted small">Essays that connect problems across models, in reading order</span></div>
      <div class="ovgrid">${ovs.map(o => `<a class="ovitem" href="${L('overview', o.id)}"><h4>${esc(o.title)}</h4><p>${fmt(o.summary)}</p></a>`).join('')}</div>` : ''}`;
  }

  const homeSwitch = cur => `<div class="section-title viewhead"><h2>${cur === 'logical' ? 'Four models' : 'How the problems evolved'}</h2><nav class="viewswitch" aria-label="View"><a class="${cur === 'logical' ? 'on' : ''}" href="${L()}">Logical</a><a class="${cur === 'chrono' ? 'on' : ''}" href="${L('timeline')}">Chronological</a></nav></div>`;
  const refYear = k => { const r = state.refs[k]; return r ? (r.first_year || r.year) : null; };
  // citation labelled with the year of first appearance (journal year in the tooltip)
  const citeFirst = k => {
    const r = state.refs[k]; if (!r || !r.first_year || r.first_year === r.year) return citeLink(k);
    const label = shortCite(k).replace(new RegExp(String(r.year) + '$'), String(r.first_year));
    return `<a class="cite" href="${L('references', k)}" title="${esc(r.title)} (journal version ${r.year})">${esc(label)}</a>`;
  };

  // Chronological view: when each problem was posed, and the papers that moved it
  // (introductory and current-best results, first lower bounds), by year of first appearance.
  function timelinePage() {
    const probs = state.index.problems.map(id => state.problems[id]).filter(Boolean);
    const events = new Map(); // year -> {origins: [], papers: Map(ref -> [{p, v, role}])}
    const at = y => { if (!events.has(y)) events.set(y, { origins: [], papers: new Map() }); return events.get(y); };
    probs.forEach(p => {
      if (p.origin) at(p.origin.year).origins.push(p);
      p.variants.forEach(v => {
        const add = (ref, role) => { const y = refYear(ref); if (!y) return; const m = at(y).papers; if (!m.has(ref)) m.set(ref, []); m.get(ref).push({ p, v, role }); };
        (v.results || []).filter(r => r.role !== 'other' && r.role !== 'disputed').forEach(r => add(r.ref, r.role));
        (v.lower_bounds || []).forEach(l => l.ref && add(l.ref, 'lb'));
      });
    });
    const years = [...events.keys()].sort((a, b) => a - b);
    const ROLE = { introductory: 'introduced', best: 'current best', lb: 'lower bound' };
    const originCard = p => {
      const par = parentOf(p), fam = familyOf(p.id), m = state.models[p.model];
      const when = par && par.origin ? (par.origin.year < p.origin.year ? `which was posed earlier (${par.origin.year})` : par.origin.year === p.origin.year ? 'posed the same year' : `but was posed before it (${par.origin.year})`) : '';
      const order = par && par.origin ? `In the logical view: ${esc(p.derived_from.kind || 'derived from')} <a href="${L('problem', par.id)}">${esc(par.name)}</a>, ${when}.` : '';
      return `<div class="tl-origin"><span class="eyebrow">${esc(m ? m.name : '')}${fam ? ' · ' + esc(fam.name) : ''}</span>
        <a class="tl-pname" href="${L('problem', p.id)}">${esc(p.name)}</a> is posed in ${citeFirst(p.origin.ref)}
        ${p.origin.note ? `<div class="small muted">${mdInline(p.origin.note)}</div>` : ''}${order ? `<div class="small">${order}</div>` : ''}</div>`;
    };
    const paperRow = (ref, items) => {
      const byProb = new Map();
      items.forEach(it => { const k = it.p.id; if (!byProb.has(k)) byProb.set(k, []); byProb.get(k).push(it); });
      return `<li>${citeFirst(ref)} <span class="muted">—</span> ${[...byProb.values()].map(its => `<a href="${L('problem', its[0].p.id)}">${esc(its[0].p.name)}</a>: ${[...new Map(its.map(it => [it.v.id + it.role, it])).values()].map(it => `<a class="tl-var" href="${L('problem', it.p.id, it.v.node.id)}">${fmt(it.v.title)}</a> <span class="tl-role ${it.role}">${ROLE[it.role] || it.role}</span>`).join(', ')}`).join('; ')}</li>`;
    };
    const decade = y => Math.floor(y / 10) * 10;
    let lastDec = null;
    const rows = years.map(y => {
      const e = events.get(y);
      const dec = decade(y) !== lastDec ? (lastDec = decade(y), `<div class="tl-decade">${decade(y)}s</div>`) : '';
      return `${dec}<div class="tl-year"><div class="tl-y">${y}</div><div class="tl-body">
        ${e.origins.map(originCard).join('')}
        ${e.papers.size ? `<ul class="tl-papers">${[...e.papers.entries()].map(([r, it]) => paperRow(r, it)).join('')}</ul>` : ''}
      </div></div>`;
    }).join('');
    const idx = state.index;
    return `<div class="hero"><h1>${esc(idx.title)}</h1><p class="tagline">${esc(idx.tagline)}</p>${aiNote('sub')}</div>
      ${homeSwitch('chrono')}
      <p class="muted small">Each year lists the problems first posed then (highlighted) and the papers that introduced a setting, gave the current best result, or proved a lower bound, dated by their first appearance (usually the conference version). The logical view arranges the same problems by reduction; the two orders can disagree, and where a derived problem was posed before its logical parent the entry says so.</p>
      <section class="panel timeline">${rows}</section>`;
  }

  function overviewCards(problemId) {
    const list = Object.values(state.overviews).filter(o => !problemId || (o.problems || []).includes(problemId));
    if (!list.length) return '';
    return `<section class="panel overviews"><h3 class="eyebrow">Perspectives</h3><div class="cards">${list.map(o => `<a class="card" href="${L('overview', o.id)}">
      <h3>${esc(o.title)}</h3><div class="summary">${fmt(o.summary)}</div>
      <div class="small muted">${(o.problems || []).map(p => state.problems[p] ? esc(state.problems[p].name) : esc(p)).join(' · ')}</div></a>`).join('')}</div></section>`;
  }

  function overviewNav(o) {
    const ids = (state.index.overviews || []).filter(x => state.overviews[x]);
    const i = ids.indexOf(o.id), prev = i > 0 ? state.overviews[ids[i - 1]] : null, next = i >= 0 && i < ids.length - 1 ? state.overviews[ids[i + 1]] : null;
    const probs = (o.problems || []).filter(p => state.problems[p]);
    return `<nav class="essay-nav" aria-label="Perspective navigation">
      <div class="essay-nav-row">
        ${prev ? `<a class="essay-nav-link prev" href="${L('overview', prev.id)}"><span class="small muted">← Previous perspective</span><span>${esc(prev.title)}</span></a>` : '<span></span>'}
        <span class="essay-nav-mid"><a href="${L()}">Home</a><span class="small muted">${i + 1} of ${ids.length}</span></span>
        ${next ? `<a class="essay-nav-link next" href="${L('overview', next.id)}"><span class="small muted">Next perspective →</span><span>${esc(next.title)}</span></a>` : '<span></span>'}
      </div>
      ${probs.length ? `<div class="essay-nav-probs"><span class="small muted">Problems discussed:</span> ${probs.map(p => `<a class="chip assume" href="${L('problem', p)}">${esc(state.problems[p].name)}</a>`).join('')}</div>` : ''}
    </nav>`;
  }

  function overviewPage(id) {
    const o = state.overviews[id];
    if (!o) return notFound('overview', id);
    const slug = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const toc = (o.sections || []).map(sct => `<li><a href="#" data-jump="${slug(sct.heading)}">${esc(sct.heading)}</a></li>`).join('');
    return `<div class="crumbs"><a href="${L()}">Home</a><span class="sep">›</span><span>Perspective</span></div>
      <article class="essay">
        <header><h1>${esc(o.title)}</h1><p class="lead muted">${fmt(o.summary)}</p>
          <div class="chips">${(o.problems || []).map(p => state.problems[p] ? `<a class="chip assume" href="${L('problem', p)}">${esc(state.problems[p].name)}</a>` : '').join('')}</div>
          ${o.status ? `<span class="badge ${esc(o.status)}">${esc(o.status)}</span>` : ''}</header>
        ${toc ? `<nav class="toc"><h3 class="eyebrow">Contents</h3><ol>${toc}</ol></nav>` : ''}
        ${(o.sections || []).map(sct => `<section id="sec-${slug(sct.heading)}"><h2>${esc(sct.heading)}</h2><div class="prose">${md(sct.body)}</div></section>`).join('')}
        ${o.further ? `<section><h2>Further reading</h2><div class="prose">${md(o.further)}</div></section>` : ''}
      </article>${overviewNav(o)}<a href="#" class="to-top" data-jump="top" aria-label="Back to top" title="Back to top">↑</a>`;
  }

  function axesTable(axes, note) {
    // one block per axis: its values as chips (level 0 first), where the assumption comes from, and the formal definitions
    return `<section class="panel axis-list">${axes.map(a => { const vs = [...a.values].sort((x, y) => (x.level || 0) - (y.level || 0)); return `<div class="axis-block" id="axis-${esc(a.id)}">
        <div class="axis-head"><h3>${esc(a.name)}</h3><div class="chips">${vs.map(v => `<span class="chip ${v.level ? 'stronger' : 'base'}" ${v.description ? `title="${esc(v.description.replace(/\$/g, ''))}"` : ''}><span class="lvl">${v.level || 0}</span>${fmt(v.label)}</span>`).join('')}</div></div>
        ${note && note(a) ? `<div class="small muted">${note(a)}</div>` : ''}
        ${a.origin ? `<div class="prose axis-origin">${md(a.origin)}</div>` : ''}
        ${vs.some(v => v.definition) ? `<details class="defs"><summary>Formal definitions</summary><dl>${vs.map(v => v.definition ? `<dt><span class="lvl">${v.level || 0}</span>${fmt(v.short || v.label)}</dt><dd>${mdInline(v.definition)}</dd>` : '').join('')}</dl></details>` : ''}</div>`; }).join('')}
      </section>`;
  }

  function modelPage(id) {
    const m = state.models[id];
    if (!m) return notFound('model', id);
    const probs = state.index.problems.map(pid => state.problems[pid]).filter(p => p && p.model === id);
    return `<div class="crumbs"><a href="${L()}">Home</a><span class="sep">›</span><span>Model</span></div>
      <h1>${esc(m.name)}</h1><p class="muted lead">${fmt(m.summary)}</p>
      ${m.focus ? `<section class="panel focus"><span class="eyebrow">What is optimised</span>${md(m.focus)}</section>` : ''}
      <section class="panel">${md(m.description)}</section>
      ${(m.story || []).length ? `<h2 id="story">How the assumptions fit together</h2>${m.story.map(sct => `<section class="panel story"><h3>${esc(sct.heading)}</h3><div class="prose">${md(sct.body)}</div></section>`).join('')}` : ''}
      ${modelSymbols(id) ? `<h2 id="symbols">Notation</h2><p class="muted small">Symbols of this model; the <a href="${L('notation')}">notation page</a> has every model and the general conventions.</p>${modelSymbols(id)}` : ''}
      <h2>Assumption axes</h2>
      <p class="muted small">Each axis below says where the assumption comes from and why the community studies it. Every axis is a scale. Level 0 assumes nothing; each higher level is a stronger assumption, which makes a problem easier. Values on the same level are alternatives that do not imply each other. An algorithm designed for weaker assumptions works under stronger ones; a lower bound proved under stronger assumptions holds under weaker ones.</p>
      ${axesTable(m.axes)}
      ${m.landscape ? `<h2 id="landscape">${esc(m.landscape.title || 'Model landscape')}</h2>${landscapeHtml(m)}` : ''}
      <h2>Problems in this model</h2>
      ${probs.length ? familiesHtml(probs) : '<p class="empty">None yet.</p>'}`;
  }

  /* ---------- problem figures: an animated scene (site) whose first and last frames are the TikZ figures (PDF) ---------- */
  // Scene format (problem.figure): view [w, h] in math coordinates (y up); optional lattice unit;
  // graph {nodes: {id: [x, y]}, edges: [[a, b]], directed}; static shapes; frames [{label, ents, marks}].
  const FIG_COLORS = { accent: 'var(--accent)', tight: 'var(--tight)', gap: 'var(--gap)', near: 'var(--near)', muted: 'var(--muted)', fg: 'var(--fg)', disputed: 'var(--disputed)', l1: '#e4572e', l2: '#17bebb', l3: '#ffc914', l4: '#76b041', soft: 'var(--bg-sunken)', line: 'var(--line-strong)' };
  const figCol = c => FIG_COLORS[c] || c || 'var(--accent)';
  // plain-text rendering of short labels inside SVG (no HTML there): drop $, map a few TeX macros
  const TEXSYM = { varepsilon: 'ε', epsilon: 'ε', ell: 'ℓ', delta: 'δ', Delta: 'Δ', lambda: 'λ', pi: 'π', le: '≤', ge: '≥', leq: '≤', geq: '≥', infty: '∞', cdot: '·', times: '×', to: '→', rightarrow: '→', alpha: 'α', beta: 'β', varphi: 'φ', phi: 'φ', rho: 'ρ', mu: 'μ', sqrt: '√' };
  const svgText = t => esc(String(t || '').replace(/\$/g, '').replace(/\\([A-Za-z]+)/g, (m, w) => TEXSYM[w] || w).replace(/_\{?([A-Za-z0-9]+)\}?/g, '$1').replace(/\^\{?([A-Za-z0-9]+)\}?/g, '^$1'));
  function figPoint(fig, e) {
    if (e.at && fig.graph && fig.graph.nodes[e.at]) return fig.graph.nodes[e.at];
    if (e.lat) { const u = fig.unit || 8, o = fig.origin || [0, 0]; return [o[0] + u * (e.lat[0] + e.lat[1] / 2), o[1] + u * e.lat[1] * Math.sqrt(3) / 2]; }
    return e.p || [0, 0];
  }
  function figShape(fig, sh, H) {
    const P = q => { const [x, y] = Array.isArray(q) ? q : figPoint(fig, q); return [x, H - y]; };
    const st = `stroke="${figCol(sh.c || 'line')}" stroke-width="${sh.w || 0.6}" ${sh.dash ? 'stroke-dasharray="1.6 1.2"' : ''} fill="${sh.fill ? figCol(sh.fill) : 'none'}" ${sh.op ? `opacity="${sh.op}"` : ''}`;
    if (sh.t === 'circle') { const [x, y] = P(sh.p); return `<circle cx="${x}" cy="${y}" r="${sh.r}" ${st}/>`; }
    if (sh.t === 'line' || sh.t === 'path' || sh.t === 'poly') {
      const pts = sh.p.map(P).map(q => q.join(',')).join(' ');
      const mk = sh.arrow ? 'marker-end="url(#fig-arrow)"' : '';
      return sh.t === 'poly' ? `<polygon points="${pts}" ${st}/>` : `<polyline points="${pts}" ${st} ${mk}/>`;
    }
    if (sh.t === 'node') { const [x, y] = P(fig.graph.nodes[sh.n]); return `<circle cx="${x}" cy="${y}" r="${sh.r || 2.2}" fill="${figCol(sh.fill || 'fg')}" stroke="none"/>`; }
    if (sh.t === 'text') { const [x, y] = P(sh.p); return `<text x="${x}" y="${y}" font-size="${sh.size || 3.2}" fill="${figCol(sh.c || 'muted')}" text-anchor="${sh.anchor || 'middle'}" dominant-baseline="middle">${svgText(sh.s)}</text>`; }
    if (sh.t === 'star') { const [x, y] = P(sh.p); const r = sh.r || 2.4; const pts = Array.from({ length: 10 }, (_, i) => { const a = Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; return `${x + rr * Math.cos(a)},${y - rr * Math.sin(a)}`; }).join(' '); return `<polygon points="${pts}" fill="${figCol(sh.c || 'near')}"/>`; }
    if (sh.t === 'rect') { const [x, y] = P(sh.p); return `<rect x="${x - (sh.wd || 3) / 2}" y="${y - (sh.ht || 3) / 2}" width="${sh.wd || 3}" height="${sh.ht || 3}" ${st}/>`; }
    return '';
  }
  function figEntity(e) {
    const k = e.k || 'robot', c = figCol(e.c), r = e.r || (k === 'particle' ? 2.6 : k === 'tile' ? 3.2 : 1.9);
    if (k === 'tile') { const pts = Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 6 + i * Math.PI / 3; return `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`; }).join(' '); return `<polygon points="${pts}" fill="${c}" stroke="var(--bg-elev)" stroke-width="0.4"/>`; }
    if (k === 'agent') return `<circle r="${r}" fill="${c}" stroke="var(--bg-elev)" stroke-width="0.6"/><circle r="${r + 0.7}" fill="none" stroke="${c}" stroke-width="0.35"/>${e.l ? `<text font-size="2.4" fill="#fff" text-anchor="middle" dominant-baseline="central">${esc(e.l)}</text>` : ''}`;
    if (k === 'crashed') return `<circle r="${r}" fill="var(--bg-elev)" stroke="${c}" stroke-width="0.5"/><path d="M${-r * .6},${-r * .6}L${r * .6},${r * .6}M${-r * .6},${r * .6}L${r * .6},${-r * .6}" stroke="${c}" stroke-width="0.5"/>`;
    if (k === 'target') return `<polygon points="${Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.5 : r * 1.3; return `${(rr * Math.cos(a)).toFixed(2)},${(rr * Math.sin(a)).toFixed(2)}`; }).join(' ')}" fill="${c}"/>`;
    if (k === 'exit') return `<rect x="${-r}" y="${-r}" width="${2 * r}" height="${2 * r}" fill="${c}"/>`;
    return `<circle r="${r}" fill="${c}" stroke="var(--bg-elev)" stroke-width="0.5"/>${e.l ? `<text font-size="2.4" fill="#fff" text-anchor="middle" dominant-baseline="central">${esc(e.l)}</text>` : ''}`;
  }
  function figureSvg(fig, uid) {
    const [W, H] = fig.view || [100, 60], F = fig.frames || [], n = F.length;
    if (!n) return '';
    // a labelled frame is a key moment and is held longer; unlabelled frames are single steps
    const many = n > 5, move = fig.move || (many ? 0.55 : 1.2);
    const holds = F.map(f => f.hold || (f.label ? (many ? 1.6 : 1.4) : (many ? 0.25 : 0.8)));
    const starts = holds.map((h, i) => holds.slice(0, i).reduce((a, b) => a + b, 0) + i * move);
    const T = starts[n - 1] + holds[n - 1] + 0.8;
    // times of the hold intervals of each frame, as fractions of the loop
    const t0 = i => starts[i] / T, t1 = i => (starts[i] + holds[i]) / T;
    const key = vals => { const kt = [], vv = []; vals.forEach((v, i) => { kt.push(t0(i), t1(i)); vv.push(v, v); }); kt.push(1); vv.push(vals[0]); return { kt: kt.map(x => x.toFixed(4)).join(';'), vv }; };
    const ids = [...new Set(F.flatMap(f => (f.ents || []).map(e => e.id)))];
    // entities on the same graph node (or lattice point) in a frame are arranged in a small ring around it
    const clusterOf = F.map(f => { const by = {}; (f.ents || []).forEach(e => { if (e.at || e.lat) { const key = e.at || e.lat.join(','); (by[key] = by[key] || []).push(e.id); } }); return by; });
    const P = (e, fi) => {
      let [x, y] = figPoint(fig, e);
      if (fi !== undefined && (e.at || e.lat) && !e.p) { const grp = clusterOf[fi][e.at || e.lat.join(',')] || []; if (grp.length > 1) { const j = grp.indexOf(e.id), rad = fig.cluster || 3.2, a = Math.PI / 2 + 2 * Math.PI * j / grp.length; x += rad * Math.cos(a); y += rad * Math.sin(a); } }
      return [x, H - y];
    };
    const graph = fig.graph ? (fig.graph.edges || []).map(([a, b]) => { const [x1, y1] = [fig.graph.nodes[a][0], H - fig.graph.nodes[a][1]], [x2, y2] = [fig.graph.nodes[b][0], H - fig.graph.nodes[b][1]]; return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--line-strong)" stroke-width="0.6" ${fig.graph.directed ? 'marker-end="url(#fig-arrow-s)"' : ''}/>`; }).join('') + Object.entries(fig.graph.nodes).map(([k, [x, y]]) => `<circle cx="${x}" cy="${H - y}" r="${fig.graph.r || 1.3}" fill="var(--bg-elev)" stroke="var(--muted)" stroke-width="0.5"/>`).join('') : '';
    const statics = (fig.static || []).map(sh => figShape(fig, sh, H)).join('');
    const marks = F.map((f, i) => (f.marks || []).length ? `<g opacity="${n > 1 ? 0 : 1}">${f.marks.map(sh => figShape(fig, sh, H)).join('')}${n > 1 ? `<animate attributeName="opacity" dur="${T}s" repeatCount="indefinite" calcMode="discrete" keyTimes="0;${t0(i).toFixed(4)};${Math.min(1, t1(i) + move / T * 0.999).toFixed(4)}" values="0;1;0"/>` : ''}</g>` : '').join('');
    const ents = ids.map(id => {
      const pos = F.map((f, fi) => { const e = (f.ents || []).find(x => x.id === id); return e ? P(e, fi) : null; });
      const first = F.map(f => (f.ents || []).find(x => x.id === id)).find(Boolean);
      const filled = pos.map((q, i) => q || pos.slice(0, i).reverse().find(Boolean) || pos.find(Boolean));
      const present = pos.map(q => q ? 1 : 0);
      const k = key(filled.map(q => `${q[0].toFixed(2)},${q[1].toFixed(2)}`)), o = key(present);
      const looks = F.map(f => (f.ents || []).find(x => x.id === id));
      const variants = [...new Set(looks.map(e => e ? JSON.stringify({ k: e.k, c: e.c, l: e.l, r: e.r }) : null).filter(Boolean))];
      const body = variants.length <= 1 ? figEntity(first) : variants.map(v => { const vis = looks.map(e => e && JSON.stringify({ k: e.k, c: e.c, l: e.l, r: e.r }) === v ? 1 : 0); const ko = key(vis); return `<g>${figEntity(JSON.parse(v))}<animate attributeName="opacity" dur="${T}s" repeatCount="indefinite" calcMode="discrete" keyTimes="0;${ko.kt}" values="${[vis[0]].concat(ko.vv).join(';')}"/></g>`; }).join('');
      // expanded particles: a second end q drawn as a capsule from p to q
      const ext = looks.some(e => e && (e.q || e.qlat)) ? (() => { const qs = looks.map(e => e && e.qlat ? P({ lat: e.qlat }) : e && e.q ? P({ p: e.q }) : null); const vis = qs.map(q => q ? 1 : 0); const ko = key(vis); const dx = qs.map((q, i) => q ? `${(q[0] - filled[i][0]).toFixed(2)},${(q[1] - filled[i][1]).toFixed(2)}` : '0,0'); const kd = key(dx); return `<g><line x1="0" y1="0" x2="0" y2="0" stroke="${figCol(first.c)}" stroke-width="${(first.r || 2.6) * 2}" stroke-linecap="round"><animate attributeName="x2" dur="${T}s" repeatCount="indefinite" keyTimes="0;${kd.kt}" values="${[dx[0]].concat(kd.vv).map(s => s.split(',')[0]).join(';')}"/><animate attributeName="y2" dur="${T}s" repeatCount="indefinite" keyTimes="0;${kd.kt}" values="${[dx[0]].concat(kd.vv).map(s => s.split(',')[1]).join(';')}"/></line></g>`; })() : '';
      return `<g transform="translate(${filled[0][0]},${filled[0][1]})">${n > 1 ? `<animateTransform attributeName="transform" type="translate" dur="${T}s" repeatCount="indefinite" keyTimes="0;${k.kt}" values="${[k.vv[0]].concat(k.vv).join(';')}"/>` : ''}${ext}${body}${n > 1 && present.some(x => !x) ? `<animate attributeName="opacity" dur="${T}s" repeatCount="indefinite" calcMode="discrete" keyTimes="0;${o.kt}" values="${[o.vv[0]].concat(o.vv).join(';')}"/>` : ''}</g>`;
    }).join('');
    const nextLab = i => { for (let j = i + 1; j < n; j++) if (F[j].label) return j; return n; };
    const labels = F.map((f, i) => f.label ? `<text x="2" y="4" font-size="3.4" fill="var(--muted)" opacity="${n > 1 ? 0 : 1}">${svgText(f.label)}${n > 1 ? `<animate attributeName="opacity" dur="${T}s" repeatCount="indefinite" calcMode="discrete" keyTimes="0;${t0(i).toFixed(4)};${(nextLab(i) < n ? t0(nextLab(i)) : 0.9999).toFixed(4)}" values="0;1;0"/>` : ''}</text>` : '').join('');
    return `<svg class="figsvg" viewBox="-2 -2 ${W + 4} ${H + 4}" role="img" aria-label="${esc((fig.caption || '').replace(/[$*\[\]]/g, ''))}">
      <defs><marker id="fig-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0,0L6,3L0,6z" fill="var(--muted)"/></marker><marker id="fig-arrow-s" viewBox="0 0 6 6" refX="9" refY="3" markerWidth="3" markerHeight="3" orient="auto"><path d="M0,0L6,3L0,6z" fill="var(--line-strong)"/></marker></defs>
      ${statics}${graph}${marks}${ents}${labels}</svg>`;
  }
  const figurePanel = p => p.figure ? `<figure class="pfig">${figureSvg(p.figure, p.id)}<figcaption>${mdInline(p.figure.caption || '')}</figcaption></figure>` : '';

  /* ---------- model landscape: which robot model is stronger ---------- */
  const landState = { view: null, sel: null };
  const lmLabel = (L, id) => { const [mm, sc] = id.split('^'); const s = (L.schedulers.find(x => x.id === sc) || { label: sc }).label; return `<span class="lm">${esc(mm)}<sup>${esc(s)}</sup></span>`; };
  // reachability over 'at least as strong' edges; strict if some edge on the path is strict
  function landClosure(L, view) {
    const ids = []; L.memories.forEach(mm => L.schedulers.forEach(sc => ids.push(mm.id + '^' + sc.id)));
    const ix = new Map(ids.map((x, i) => [x, i])), n = ids.length;
    const ge = ids.map(() => new Array(n).fill(0)), gt = ids.map(() => new Array(n).fill(0)), how = ids.map(() => new Array(n).fill(''));
    const put = (a, b, strict, src) => { const i = ix.get(a), j = ix.get(b); if (i === undefined || j === undefined) return; ge[i][j] = 1; if (strict) gt[i][j] = 1; if (!how[i][j] || src === 'proved') how[i][j] = src; };
    const memLe = [['LUMI', 'FCOM'], ['LUMI', 'FSTA'], ['FCOM', 'OBLOT'], ['FSTA', 'OBLOT']];
    const schLe = [['F', 'S'], ['R', 'S'], ['S', 'A_LC'], ['S', 'A_CM'], ['S', 'A_M'], ['A_LC', 'A'], ['A_CM', 'A'], ['A_M', 'A']];
    L.schedulers.forEach(sc => memLe.forEach(([x, y]) => put(x + '^' + sc.id, y + '^' + sc.id, false, 'trivial')));
    L.memories.forEach(mm => schLe.forEach(([x, y]) => put(mm.id + '^' + x, mm.id + '^' + y, false, 'trivial')));
    const inc = new Set();
    view.relations.forEach(r => {
      if (r.rel === '>' ) put(r.a, r.b, true, 'proved');
      else if (r.rel === '≥') put(r.a, r.b, false, 'proved');
      else if (r.rel === '≡') { put(r.a, r.b, false, 'proved'); put(r.b, r.a, false, 'proved'); }
      else if (r.rel === '⊥') { inc.add(r.a + '|' + r.b); inc.add(r.b + '|' + r.a); }
    });
    ids.forEach((_, i) => { ge[i][i] = 1; });
    for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) if (ge[i][k]) for (let j = 0; j < n; j++) if (ge[k][j]) {
      const st = gt[i][k] || gt[k][j];
      if (!ge[i][j]) { ge[i][j] = 1; how[i][j] = 'derived'; }
      if (st && !gt[i][j]) gt[i][j] = 1;
    }
    const rel = (x, y) => { // relation of x to y
      const i = ix.get(x), j = ix.get(y);
      if (i === undefined || j === undefined) return { r: '?' };
      if (i === j) return { r: 'self' };
      if (ge[i][j] && ge[j][i]) return { r: '≡', how: how[i][j] === 'proved' || how[j][i] === 'proved' ? 'proved' : 'derived' };
      if (ge[i][j]) return { r: gt[i][j] ? '>' : '≥', how: how[i][j] };
      if (ge[j][i]) return { r: gt[j][i] ? '<' : '≤', how: how[j][i] };
      if (inc.has(x + '|' + y)) return { r: '⊥', how: 'proved' };
      return { r: '?' };
    };
    return { ids, rel };
  }
  function landscapeHtml(m) {
    const L = m.landscape;
    if (!landState.view || !L.views.some(v => v.id === landState.view)) landState.view = L.views[0].id;
    return `<section class="panel landscape" data-landscape="${esc(m.id)}">
      <div class="prose">${md(L.intro)}</div>
      <div id="land-body">${landBody(m)}</div>
      ${(L.problems || []).length ? `<details class="defs"><summary>Separating problems (${L.problems.length})</summary><dl class="seps">${L.problems.map(p => `<dt id="sep-${esc(p.abbrev.replace(/[^A-Za-z0-9]/g, ''))}"><b>${fmt(p.abbrev)}</b> ${fmt(p.name)}</dt><dd>${mdInline(p.definition)} ${(p.refs || []).map(citeLink).join(' ')}</dd>`).join('')}</dl></details>` : ''}
      ${(L.other || []).length ? `<h3>Other settings</h3><ul>${L.other.map(t => `<li>${mdInline(t)}</li>`).join('')}</ul>` : ''}
      ${(L.conflicts || []).length ? `<h3>Where the papers disagree</h3><ul class="conflicts">${L.conflicts.map(t => `<li>${mdInline(t)}</li>`).join('')}</ul>` : ''}
      ${(L.open || []).length ? `<h3>Open questions</h3><ol>${L.open.map(t => `<li>${mdInline(t)}</li>`).join('')}</ol>` : ''}
    </section>`;
  }
  function landBody(m) {
    const L = m.landscape, view = L.views.find(v => v.id === landState.view) || L.views[0];
    const { ids, rel } = landClosure(L, view);
    const sel = ids.includes(landState.sel) ? landState.sel : null;
    const sepDef = a => { const p = (L.problems || []).find(q => q.abbrev === a); return p ? `<a href="#" class="sep" data-jump-sep="${esc(a.replace(/[^A-Za-z0-9]/g, ''))}" title="${esc(p.name + ': ' + p.definition.replace(/\$/g, ''))}">${esc(a)}</a>` : esc(a); };
    const cls = { '>': 'st-strong', '≥': 'st-strong', '<': 'st-weak', '≤': 'st-weak', '≡': 'st-eq', '⊥': 'st-inc', '?': 'st-unk', self: 'st-self' };
    const word = { '>': 'stronger', '≥': 'at least as strong', '<': 'weaker', '≤': 'at most as strong', '≡': 'equivalent', '⊥': 'incomparable', '?': 'unknown' };
    const grid = `<div class="land-scroll"><table class="landgrid"><thead><tr><th></th>${L.schedulers.map(s => `<th>${esc(s.label)}</th>`).join('')}</tr></thead><tbody>
      ${L.memories.map(mm => `<tr><th><b>${esc(mm.label)}</b><span>${esc(mm.name)}</span></th>${L.schedulers.map(s => {
        const id = mm.id + '^' + s.id; const r = sel ? rel(id, sel) : { r: null };
        const c = sel ? cls[r.r] + (r.how === 'derived' || r.how === 'trivial' ? ' derived' : '') : '';
        const sym = sel && r.r !== 'self' ? (r.r === '?' ? '?' : r.r) : '';
        return `<td><button class="lcell ${c}" data-lcell="${esc(id)}" title="${esc(mm.label + ' under ' + s.label)}${sel && r.r !== 'self' ? ': ' + word[r.r] + (r.how ? ' (' + r.how + ')' : '') : ''}">${sym ? `<span class="lsym">${esc(sym)}</span>` : (sel && r.r === 'self' ? '●' : '')}</button></td>`;
      }).join('')}</tr>`).join('')}</tbody></table></div>`;
    const legend = `<div class="land-legend">${sel ? `<span>Compared with ${lmLabel(L, sel)}:</span>` : '<span>Choose a model in the grid to compare every other model with it.</span>'}
      <span><i class="st-strong"></i>stronger</span><span><i class="st-weak"></i>weaker</span><span><i class="st-eq"></i>equivalent</span><span><i class="st-inc"></i>incomparable</span><span><i class="st-unk"></i>unknown</span><span><i class="st-strong derived"></i>dashed: follows from other results</span></div>`;
    const relRow = r => `<tr><td>${lmLabel(L, r.a)}</td><td class="lrel">${esc(r.rel)}</td><td>${lmLabel(L, r.b)}</td><td>${(r.sep || []).map(sepDef).join(', ') || '<span class="muted">simulation</span>'}</td><td>${citeLink(r.ref)}${r.thm ? ` <span class="muted small">${mdInline(r.thm)}</span>` : ''}${(r.also || []).length ? ` <span class="small">also ${r.also.map(citeLink).join(', ')}</span>` : ''}${r.unread ? ' <span class="small muted">(as reported)</span>' : ''}${r.caveat ? `<div class="caveat">⚠ ${mdInline(r.caveat)}</div>` : ''}${r.note ? `<div class="small muted">${mdInline(r.note)}</div>` : ''}</td></tr>`;
    const inGrid = r => ids.includes(r.a) && ids.includes(r.b);
    const mine = sel ? view.relations.filter(r => r.a === sel || r.b === sel) : [];
    const table = rs => `<div class="land-scroll"><table class="landrel"><thead><tr><th>Model</th><th></th><th>Model</th><th>Separator</th><th>Source</th></tr></thead><tbody>${rs.map(relRow).join('')}</tbody></table></div>`;
    return `<div class="land-tabs">${L.views.map(v => `<button class="${v.id === view.id ? 'on' : ''}" data-lview="${esc(v.id)}">${esc(v.title)}</button>`).join('')}</div>
      <p class="small muted">${mdInline(view.assumptions)}</p>
      ${legend}${grid}
      <p class="small muted">${mdInline(L.trivial)}</p>
      ${sel ? `<h3>Proved relations of ${lmLabel(L, sel)}</h3>${mine.length ? table(mine) : '<p class="muted">None proved directly; the colours above follow from other results.</p>'}` : ''}
      <details class="defs"><summary>All proved relations in this view (${view.relations.length})</summary>${table(view.relations.filter(inGrid).concat(view.relations.filter(r => !inGrid(r))))}</details>`;
  }

  function problemPage(id, nodeId, view) {
    const p = state.problems[id];
    if (!p) return notFound('problem', id);
    const m = state.models[p.model];
    const fam = familyOf(p.id);
    const n = nodeId ? p.nodes[nodeId] : null;
    if (nodeId && !n && !view) return notFound('variant', nodeId);
    const onRoot = !nodeId && view !== 'map';
    const switcher = cur => `<nav class="viewswitch" aria-label="View"><a class="${cur === 'tree' ? 'on' : ''}" href="${L('problem', p.id)}">Tree</a><a class="${cur === 'graph' ? 'on' : ''}" href="${L('problem', p.id, 'graph')}">Graph</a><a class="${cur === 'map' ? 'on' : ''}" href="${L('problem', p.id, 'map')}">Progress map</a></nav>`;
    const crumbs = `<div class="crumbs"><a href="${L()}">Home</a><span class="sep">›</span><a href="${L('model', m.id)}">${esc(m.name)}</a>${(() => { const chain = []; let q = parentOf(p); while (q && !chain.includes(q)) { chain.unshift(q); q = parentOf(q); } const top = chain[0] || p; return (fam && top.name !== fam.name ? `<span class="sep">›</span><span>${esc(fam.name)}</span>` : '') + chain.map(q => `<span class="sep">›</span><a href="${L('problem', q.id)}">${esc(q.name)}</a>`).join(''); })()}<span class="sep">›</span>${onRoot ? `<span>${esc(p.name)}</span>` : `<a href="${L('problem', p.id)}">${esc(p.name)}</a>`}</div>`;
    const head = `${crumbs}<h1>${esc(p.name)}</h1><p class="muted lead">${fmt(p.summary)}</p>
      <details class="statement"${onRoot && view !== 'graph' ? ' open' : ''}><summary><span>Problem statement and measures</span><span class="hint">${onRoot && view !== 'graph' ? 'collapse' : 'expand'}</span></summary>
        <div class="statement-body">${onRoot ? figurePanel(p) : ''}${md(p.statement)}
        <p class="small muted">Measures: ${p.measures.map(x => `<b>${esc(x.name)}</b>, ${fmt(x.description)}`).join('; ')}.</p></div></details>`;
    if (view === 'graph') {
      return `${head}<div class="section-title viewhead"><h2>Assumption graph</h2>${switcher('graph')}</div>${graphView(p)}`;
    }
    if (onRoot) {
      const probAxes = (p.axes_local || []);
      const par = parentOf(p), kids = derivedOf(p), rels = relatedOf(p);
      const famRels = (state.index.families || []).filter(f => (f.related || []).some(r => r.problem === p.id));
      const rel = (par || kids.length || rels.length || famRels.length) ? `<section class="panel relation">
          ${par ? `<h3 class="eyebrow">${esc((p.derived_from.kind || 'derived from').replace(/^./, c => c.toUpperCase()))} <a href="${L('problem', par.id)}">${esc(par.name)}</a></h3><div class="prose">${md(p.derived_from.relation)}</div>` : ''}
          ${kids.length ? `<h3 class="eyebrow">Derived problems</h3>${kids.map(q => `<p><a href="${L('problem', q.id)}"><b>${esc(q.name)}</b></a>: ${mdInline(q.derived_from.relation)}</p>`).join('')}` : ''}
          ${famRels.map(f => `<h3 class="eyebrow">Related family: ${esc(f.name)}</h3><p>${mdInline(f.related.find(r => r.problem === p.id).relation)} Problems: ${f.problems.filter(q => state.problems[q]).map(q => `<a href="${L('problem', q)}">${esc(state.problems[q].name)}</a>`).join(', ')}.</p>`).join('')}
          ${rels.length ? `<h3 class="eyebrow">Related problems</h3>${rels.map(r => `<p><a href="${L('problem', r.q.id)}"><b>${esc(r.q.name)}</b></a>: ${mdInline(r.relation)}</p>`).join('')}` : ''}
        </section>` : '';
      const KIND = { algorithm: 'Algorithm', impossibility: 'Impossibility', 'lower-bound': 'Lower bound' };
      const primer = p.primer ? `<details class="panel primer" open><summary><h3 class="eyebrow">A first look</h3><span class="small muted">the basic problem, a simple algorithm and why some things cannot be done, for a newcomer</span></summary>
          <div class="prose">${md(p.primer.intro)}</div>
          ${(p.primer.ideas || []).map((x, i) => `<div class="idea ${esc(x.kind)}"><div class="idea-head"><span class="idea-n">${i + 1}</span><span class="badge ${x.kind === 'algorithm' ? 'tight' : 'gap'}">${KIND[x.kind] || esc(x.kind)}</span><b>${fmt(x.title)}</b>${x.variant && p.byId[x.variant] ? ` <a class="small" href="${L('problem', p.id, p.byId[x.variant].node.id)}">${fmt(p.byId[x.variant].title)} →</a>` : ''}${x.ref ? ` <span class="small">${citeLink(x.ref)}</span>` : ''}</div>
            <div class="prose">${md(x.idea)}</div>
            <div class="prose idea-analysis"><b>${x.kind === 'algorithm' ? 'Why it works and what it costs.' : 'Why it holds.'}</b> ${mdInline(x.analysis)}</div>
            ${x.why_it_matters ? `<p class="small muted"><b>Why it matters.</b> ${mdInline(x.why_it_matters)}</p>` : ''}</div>`).join('')}
        </details>` : '';
      const hist = p.history ? `<section class="panel history"><h3 class="eyebrow">What the community started looking at</h3><div class="prose">${md(p.history)}</div></section>` : '';
      return `${head}${primer}${hist}${rel}${overviewCards(p.id)}${(p.further || []).length ? `<section class="panel further"><h3 class="eyebrow">Further reading</h3><p class="small muted">Papers on this problem that are not yet placed in a setting.</p><ul>${p.further.map(f => `<li>${citeLink(f.ref)} ${state.refs[f.ref] ? `<span class="small">${fmt(state.refs[f.ref].title)}.</span>` : ''} <span class="small muted">${mdInline(f.note || '')}</span></li>`).join('')}</ul></section>` : ''}
        <section class="panel">
          <div class="section-title"><h2>Assumption tree</h2>${switcher('tree')}</div>
          <p class="muted small">The root assumes nothing. Going down, each edge adds the assumptions on its chips (<span class="chip stronger"><b>+</b>blue</span>); a grey chip names the branch that leaves that axis unassumed while a sibling assumes something. Solid nodes are catalogued variants with their status per measure (${p.measures.map(x => esc(x.name)).join(', ')}); dashed nodes are branch points with no catalogued variant, named after the axis on which their branches differ. Axis order: ${p.axes.map(a => esc(a.name)).join(' › ')}.</p>
          <div class="legend"><span><span class="dot tight"></span> tight</span><span><span class="dot near"></span> near-optimal</span><span><span class="dot gap"></span> polynomial gap</span><span><span class="dot"></span> unknown</span><span><span class="dot impossible"></span> impossible</span><span><span class="dot hollow"></span> no variant</span></div>
          ${bigTree(p)}
        </section>
        ${probAxes.length ? `<h2>Axes specific to this problem</h2>${axesTable(probAxes)}` : ''}
        ${contributeBox(p, null)}`;
    }
    const sel = view === 'map' ? null : n;
    const main = view === 'map' ? `<div class="section-title viewhead"><h2>Progress map</h2>${switcher('map')}</div>${mapView(p)}` : nodeView(p, n);
    return `${head}
      <div class="layout">
        <aside class="sidebar"><details class="sidenav"${window.innerWidth > 900 ? ' open' : ''}><summary><div class="sidehead"><h4>Assumption tree</h4><a class="maplink" href="${L('problem', p.id, 'map')}">progress map →</a><span class="current">${sel ? fmt(nodeTitle(p, sel)) : 'Progress map'}</span></div></summary>${tree(p, sel ? sel.id : null)}</details></aside>
        <div class="main">${main}${view === 'map' ? contributeBox(p, null) : contributeBox(p, n && n.variant)}</div>
      </div>`;
  }

  function impliedPanel(p, n) {
    const { weaker, stronger } = implied(p, n);
    if (!weaker.length && !stronger.length) return '';
    const row = (v, kind) => `<div class="imp"><a href="${L('problem', p.id, v.node.id)}">${fmt(v.title)}</a>
      <div class="bounds-inline">${p.measures.map(mm => {
        const b = kind === 'ub' ? bestResult(v, mm.id) : lowerBound(v, mm.id);
        return b ? `<span>${esc(mm.name)} <b>${tex(kind === 'ub' ? b[mm.id] : b.bound)}</b></span>` : '';
      }).join('')}</div></div>`;
    return `<section class="panel">
      <h3 class="eyebrow">What carries over from neighbouring settings</h3>
      <p class="small muted">Read off the order of assumptions, not checked case by case: results may carry extra assumptions (shown on their pages), and asynchronous time is measured in epochs.</p>
      <div class="imp-grid">
        <div><h4>Algorithms from weaker settings work here</h4>${weaker.length ? weaker.map(v => row(v, 'ub')).join('') : '<p class="empty">No catalogued weaker setting.</p>'}</div>
        <div><h4>Lower bounds from stronger settings hold here</h4>${stronger.length ? stronger.map(v => row(v, 'lb')).join('') : '<p class="empty">No catalogued stronger setting.</p>'}</div>
      </div></section>`;
  }

  function nodeCrumbs(p, n) {
    return `<div class="crumbs path">${n.path.map((a, i) => `${i ? '<span class="sep">›</span>' : ''}<a href="${L('problem', p.id, a.id)}" title="${esc(nodeTitle(p, a).replace(/\$/g, ''))}">${fmt(a.parent ? edgeText(p, a) : 'no assumptions')}</a>`).join('')}</div>`;
  }

  function branchCards(p, n) {
    if (!n.children.length) return '';
    return `<h3 class="eyebrow" style="margin-top:1.6rem">Branches from here</h3><div class="cards">${n.children.map(c => `<a class="card${c.variant ? '' : ' gapcard'}" href="${L('problem', p.id, c.id)}">
          <h3>${fmt(nodeTitle(p, c))}</h3><div class="chips tiny">${edgeChips(p, c)}</div>
          <div class="summary">${c.variant ? fmt(c.variant.summary) : `splits into ${c.children.length} branches`}</div>${dots(p, c)}</a>`).join('')}</div>`;
  }

  function nodeView(p, n) {
    const v = n.variant;
    const added = new Set(((n.edge && n.edge.added) || []).map(x => x[0]));
    const assumed = p.axes.filter(a => levelOf(p, a.id, n.assumptions[a.id]) > 0);
    const free = p.axes.filter(a => !levelOf(p, a.id, n.assumptions[a.id]));
    const asmHtml = `<h3 class="eyebrow">Assumed <span class="muted">(added on the last edge are outlined)</span></h3>
        <div class="chips">${assumed.map(a => chip(p, a.id, n.assumptions[a.id], added.has(a.id))).join('') || '<span class="muted small">nothing</span>'}</div>
        <h3 class="eyebrow">Not assumed</h3><div class="chips">${free.map(a => chip(p, a.id, n.assumptions[a.id], false)).join('')}</div>
        <details class="defs"><summary>Formal definitions of this setting</summary><dl>${p.axes.map(a => { const v = valueOf(p, a.id, n.assumptions[a.id]); return v.definition ? `<dt>${esc(a.name)}: ${fmt(v.short || v.label)}</dt><dd>${mdInline(v.definition)}</dd>` : ''; }).join('')}</dl></details>`;
    if (!v) {
      return `${nodeCrumbs(p, n)}
      <section class="panel head">
        <div class="section-title"><h2>${fmt(nodeTitle(p, n))}</h2><span class="badge unknown">no variant</span></div>
        <p class="lead">${n.parent ? `No variant is catalogued for exactly these assumptions. Here the tree branches ${n.children.length} ways by ${n.split.map(a => a.name.toLowerCase()).join(', ')}.` : 'The root of the tree: nothing is assumed on any axis. Every catalogued variant adds assumptions to this setting.'}</p>
        ${asmHtml}
      </section>
      ${impliedPanel(p, n)}
      ${branchCards(p, n)}`;
    }
    const results = v.results || [];
    return `${nodeCrumbs(p, n)}
      <section class="panel head">
        <div class="section-title"><h2>${fmt(v.title)}</h2>${v.standard ? '<span class="badge std">standard setting</span>' : ''}<span class="badge ${v.status || 'draft'}" title="${v.status === 'verified' ? 'bounds checked against the papers' : 'some entries are not yet checked against the papers'}">${esc(v.status || 'draft')}</span></div>
        ${statusStrip(p, v)}
        <p class="lead">${fmt(v.summary)}</p>
        ${asmHtml}
        ${v.statement ? `<h3 class="eyebrow">Statement for this variant</h3><div class="prose">${md(v.statement)}</div>` : ''}
      </section>
      <section class="panel">
        <h3 class="eyebrow">What is known</h3>
        ${p.measures.map(m => knownBlock(p, v, m)).join('')}
      </section>
      <section class="panel">
        <h3 class="eyebrow">Results, in order of publication</h3>
        ${results.length ? results.map(r => `<div class="result">
            <div class="who">${citeLink(r.ref)} <span class="badge ${r.role}">${ROLE_LABEL[r.role] || esc(r.role)}</span></div>
            <div class="bounds-inline">${p.measures.filter(mm => r[mm.id]).map(mm => `<span>${esc(mm.name)} <b>${tex(r[mm.id])}</b></span>`).join('')}</div>
            ${(r.assumes && r.assumes.length) || r.note ? `<div class="note">${r.assumes && r.assumes.length ? `<div class="chips tiny">${r.assumes.map(a => `<span class="chip assume">${fmt(a)}</span>`).join('')}</div>` : ''}${md(r.note)}</div>` : ''}
          </div>`).join('') : '<p class="empty">No result recorded yet.</p>'}
      </section>
      <section class="panel">
        <h3 class="eyebrow">Open questions</h3>
        ${(v.open || []).length ? `<ol class="open">${v.open.map(q => `<li>${md(q)}</li>`).join('')}</ol>` : '<p class="empty">None recorded for this variant.</p>'}
      </section>
      ${v.notes ? `<section class="panel"><h3 class="eyebrow">Notes</h3><div class="prose">${md(v.notes)}</div></section>` : ''}
      ${impliedPanel(p, n)}
      ${branchCards(p, n)}`;
  }

  /* ---------- graph view: the order of assumption sets (Hasse diagram) ----------
     Axes are independent, so a setting can strengthen several others at once. An
     arrow A → B means B makes every assumption of A and more, with no catalogued
     setting in between; the arrow is labelled with what B adds. Layers are the
     longest chain from "no assumptions"; within a layer nodes are ordered by the
     barycentre of their neighbours to reduce crossings. */
  const GW = 172, GH = 58, GX = 92, GY = 14, PH = 30, PY = 6;
  let graphPapers = true;
  const ROLE_RANK = { best: 0, introductory: 1, lb: 2, other: 3, disputed: 4 };
  function graphModel(p) {
    const cacheKey = graphPapers ? '_graphP' : '_graph';
    if (p[cacheKey]) return p[cacheKey];
    const sum = asm => p.axes.reduce((s, a) => s + levelOf(p, a.id, asm[a.id]), 0);
    const nodes = [];
    if (!p.root.variant) nodes.push({ key: p.root.id, asm: p.root.assumptions, node: p.root, variant: null });
    p.variants.forEach(v => nodes.push({ key: v.node.id, asm: v.assumptions, node: v.node, variant: v }));
    nodes.forEach(g => { g.rank = sum(g.asm); g.tidx = p.order.indexOf(g.node); g.h = GH; });
    nodes.sort((a, b) => a.rank - b.rank || a.tidx - b.tidx);
    const same = (A, B) => p.axes.every(a => A[a.id] === B[a.id]);
    const less = (a, b) => a !== b && !same(a.asm, b.asm) && weakerOrEqual(p, a.asm, b.asm);
    nodes.forEach(b => {
      const below = nodes.filter(a => less(a, b));
      b.parents = below.filter(a => !below.some(c => c !== a && less(a, c)));
    });
    nodes.forEach(g => { g.layer = g.parents.length ? Math.max(...g.parents.map(a => a.layer)) + 1 : 0; });
    const edges = [];
    nodes.forEach(b => b.parents.forEach(a => {
      const diff = p.axes.filter(ax => a.asm[ax.id] !== b.asm[ax.id]).map(ax => [ax.id, b.asm[ax.id]]);
      edges.push({ a, b, diff });
    }));
    // papers: one leaf per reference, joined to every setting where it gives a result or a lower bound
    if (graphPapers) {
      const papers = new Map();
      nodes.filter(g => g.variant).forEach(g => {
        const roles = new Map();
        (g.variant.results || []).forEach(r => { if (r.ref) (roles.get(r.ref) || roles.set(r.ref, new Set()).get(r.ref)).add(r.role); });
        (g.variant.lower_bounds || []).forEach(l => { if (l.ref) (roles.get(l.ref) || roles.set(l.ref, new Set()).get(l.ref)).add('lb'); });
        roles.forEach((rs, ref) => {
          if (!papers.has(ref)) papers.set(ref, { key: 'ref-' + ref, ref, paper: true, parents: [], h: PH, tidx: 1e6, roles: new Map() });
          const pn = papers.get(ref); pn.parents.push(g); pn.roles.set(g.key, rs);
        });
      });
      papers.forEach(pn => {
        pn.layer = Math.max(...pn.parents.map(a => a.layer)) + 1;
        pn.parents.forEach(a => {
          const rs = [...pn.roles.get(a.key)].sort((x, y) => ROLE_RANK[x] - ROLE_RANK[y]);
          edges.push({ a, b: pn, paper: true, role: rs[0], roles: rs });
        });
        nodes.push(pn);
      });
    }
    nodes.forEach(g => { g.children = edges.filter(e => e.a === g).map(e => e.b); });
    const layers = [];
    nodes.forEach(g => (layers[g.layer] = layers[g.layer] || []).push(g));
    layers.forEach(L => L.forEach((g, i) => { g.pos = i; }));
    const bary = (g, nb) => nb.length ? nb.reduce((s, x) => s + x.pos / Math.max(1, layers[x.layer].length), 0) / nb.length : g.pos / Math.max(1, layers[g.layer].length);
    for (let it = 0; it < 16; it++) {
      const down = it % 2 === 0;
      (down ? layers.slice(1) : layers.slice(0, -1).reverse()).forEach(L => {
        L.forEach(g => { g.key2 = bary(g, down ? g.parents : g.children); });
        L.sort((a, b) => a.key2 - b.key2 || (a.paper ? 1 : 0) - (b.paper ? 1 : 0) || a.tidx - b.tidx);
        L.forEach((g, i) => { g.pos = i; });
      });
    }
    const gap = g => g.paper ? PY : GY;
    const tall = L => L.reduce((s, g) => s + g.h + gap(g), 0) - (L.length ? gap(L[L.length - 1]) : 0);
    const maxH = Math.max(...layers.map(tall));
    layers.forEach((L, li) => {
      let y = (maxH - tall(L)) / 2;
      L.forEach(g => { g.x = li * (GW + GX); g.y = y; y += g.h + gap(g); });
    });
    const reach = (g, dir) => { const out = new Set(); const st = [g]; while (st.length) { const x = st.pop(); x[dir].forEach(y => { if (!out.has(y.key)) { out.add(y.key); st.push(y); } }); } return out; };
    nodes.forEach(g => { g.up = reach(g, 'parents'); g.down = reach(g, 'children'); });
    p[cacheKey] = { nodes, edges, layers, width: layers.length * (GW + GX) - GX, height: maxH };
    return p[cacheKey];
  }

  function graphView(p) {
    const G = graphModel(p);
    const label = e => {
      const parts = e.diff.map(([a, x]) => '+ ' + shortOf(p, a, x));
      return parts.length <= 2 ? parts.join(', ') : `+ ${parts.length}`;
    };
    const full = e => e.diff.map(([a, x]) => `${p.axisById[a].name}: ${valueOf(p, a, x).label}`).join('\n').replace(/\$/g, '');
    const ROLE_NAME = { best: 'current best', introductory: 'introductory', lb: 'lower bound', other: 'also cited', disputed: 'disputed proof' };
    const paths = G.edges.map(e => {
      const x1 = e.a.x + GW, y1 = e.a.y + e.a.h / 2, x2 = e.b.x, y2 = e.b.y + e.b.h / 2, dx = Math.max(40, (x2 - x1) / 2);
      if (e.paper) return `<path class="gedge gpe ${e.role}" data-a="${esc(e.a.key)}" data-b="${esc(e.b.key)}" d="M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}"><title>${esc(e.roles.map(r => ROLE_NAME[r]).join(', '))}</title></path>`;
      return `<path class="gedge" data-a="${esc(e.a.key)}" data-b="${esc(e.b.key)}" d="M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}"><title>${esc(full(e))}</title></path>`;
    }).join('');
    // label in the gap just before the target, on the curve
    const labels = G.edges.filter(e => !e.paper).map(e => {
      const x1 = e.a.x + GW, y1 = e.a.y + e.a.h / 2, x2 = e.b.x, y2 = e.b.y + e.b.h / 2, dx = Math.max(40, (x2 - x1) / 2);
      const t = Math.max(0.5, 1 - (GX * 0.5) / Math.max(x2 - x1, 1));
      const bz = (a, b, c, d) => (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t * t * c + t ** 3 * d;
      const x = bz(x1, x1 + dx, x2 - dx, x2), y = bz(y1, y1, y2, y2);
      return `<span class="glabel${e.a.variant ? '' : ' many'}" data-a="${esc(e.a.key)}" data-b="${esc(e.b.key)}" style="left:${x}px;top:${y}px" title="${esc(full(e))}">${fmt(label(e))}</span>`;
    }).join('');
    const boxes = G.nodes.map(g => g.paper
      ? `<a class="gnode gpaper" data-key="${esc(g.key)}" data-up="${esc([...g.up].join(' '))}" data-down="" href="${L('references', g.ref)}" title="${esc(state.refs[g.ref] ? state.refs[g.ref].title : g.ref)}" style="left:${g.x}px;top:${g.y}px;width:${GW}px;height:${g.h}px"><span class="gt">${esc(shortCite(g.ref))}</span></a>`
      : `<a class="gnode${g.variant ? '' : ' groot'}${g.variant && g.variant.standard ? ' standard' : ''}" data-key="${esc(g.key)}" data-up="${esc([...g.up].join(' '))}" data-down="${esc([...g.down].join(' '))}" href="${L('problem', p.id, g.node.id)}" style="left:${g.x}px;top:${g.y}px;width:${GW}px;height:${GH}px">
        <span class="gt">${fmt(nodeTitle(p, g.node))}</span>${dots(p, g.node)}</a>`).join('');
    return `<section class="panel gpanel">
      <p class="muted small">Assumptions on different axes are independent, so a setting can have several parents. An arrow from A to B means that B makes every assumption of A and also those written on the arrow; no catalogued setting lies in between. Arrows that add more than two assumptions show only a count; arrows leaving <i>no assumptions</i> are labelled only while a node at either end is highlighted. Hover a label for the full list. Columns count the longest chain of strengthenings from <i>no assumptions</i>. Hover a node to highlight everything it implies and everything implied by it.</p>
      <div class="legend"><span><span class="dot tight"></span> tight</span><span><span class="dot near"></span> near-optimal</span><span><span class="dot gap"></span> polynomial gap</span><span><span class="dot"></span> unknown</span><span><span class="dot impossible"></span> impossible</span><span class="muted">· dots: ${p.measures.map(x => esc(x.name)).join(', ')}</span></div>
      ${graphPapers ? `<div class="legend"><span class="muted">Papers are leaves, joined to every setting where they give</span><span><span class="pline best"></span> the current best</span><span><span class="pline introductory"></span> the introductory result</span><span><span class="pline lb"></span> a lower bound</span><span><span class="pline other"></span> another result</span><span><span class="pline disputed"></span> a disputed result</span></div>` : ''}
      <div class="gtools"><button type="button" data-papers="1">${graphPapers ? 'Hide papers' : 'Show papers'}</button><span class="gsep"></span><button type="button" data-zoom="out" aria-label="Zoom out">−</button><button type="button" data-zoom="fit">Fit</button><button type="button" data-zoom="in" aria-label="Zoom in">+</button><button type="button" data-zoom="one">100%</button></div>
      <div class="gwrap"><div class="gsizer"><div class="gcanvas" data-w="${G.width}" data-h="${G.height + 8}" style="width:${G.width}px;height:${G.height + 8}px">
        <svg class="gsvg" width="${G.width}" height="${G.height + 8}" viewBox="0 0 ${G.width} ${G.height + 8}" aria-hidden="true">
          <defs><marker id="garrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" class="garrowhead"/></marker></defs>
          ${paths}</svg>
        ${labels}${boxes}
      </div></div></div>
    </section>`;
  }

  // zoom: fit to the available width by default; buttons scale by 1.25
  let graphZoom = 'auto'; // auto: fit the width, but never below 80% so labels stay legible
  function fitGraph() {
    const c = app.querySelector('.gcanvas'); if (!c) return;
    const wrap = app.querySelector('.gwrap'), sizer = app.querySelector('.gsizer');
    const w = +c.dataset.w, h = +c.dataset.h;
    const fit = Math.min(1, (wrap.clientWidth - 12) / w);
    const s = graphZoom === 'fit' ? fit : graphZoom === 'auto' ? Math.min(1, Math.max(fit, 0.8)) : graphZoom;
    c.style.transform = `scale(${s})`; c.style.transformOrigin = '0 0';
    sizer.style.width = `${w * s}px`; sizer.style.height = `${h * s}px`;
    c.dataset.s = s;
  }
  window.addEventListener('resize', () => { if (typeof graphZoom === 'string') fitGraph(); });

  // highlight a node's ancestors (weaker settings) and descendants (stronger ones)
  function graphHover(e) {
    const g = e.target.closest && e.target.closest('.gnode');
    const canvas = app.querySelector('.gcanvas');
    if (!canvas) return;
    if (!g) { canvas.classList.remove('focus'); canvas.querySelectorAll('.on,.up,.down').forEach(x => x.classList.remove('on', 'up', 'down')); return; }
    const key = g.dataset.key, up = new Set(g.dataset.up.split(' ').filter(Boolean)), down = new Set(g.dataset.down.split(' ').filter(Boolean));
    canvas.classList.add('focus');
    canvas.querySelectorAll('.gnode').forEach(x => { const k = x.dataset.key; x.classList.toggle('on', k === key); x.classList.toggle('up', up.has(k)); x.classList.toggle('down', down.has(k)); });
    const inUp = k => k === key || up.has(k), inDown = k => k === key || down.has(k);
    canvas.querySelectorAll('.gedge,.glabel').forEach(x => {
      const a = x.dataset.a, b = x.dataset.b;
      x.classList.toggle('up', inUp(a) && inUp(b));
      x.classList.toggle('down', inDown(a) && inDown(b));
    });
  }

  function mapView(p) {
    const cell = (v, mm) => {
      if (!v) return `<div class="mini"><span class="muted small">—</span></div>`;
      const lb = lowerBound(v, mm.id), br = bestResult(v, mm.id), st = statusOf(v, mm.id);
      return `<div class="mini"><span class="badge ${st}">${STATUS_LABEL[st]}</span>
        <span class="vs">${br ? tex(br[mm.id]) : '<span class="muted">—</span>'} <span class="muted small">vs</span> ${lb ? tex(lb.bound) : '<span class="muted">—</span>'}</span>
        ${lb && lb.bottleneck ? `<span class="small muted">${fmt(lb.bottleneck)}</span>` : ''}</div>`;
    };
    return `<section class="panel map">
      <div class="legend"><span><span class="dot tight"></span> tight</span><span><span class="dot near"></span> near-optimal</span><span><span class="dot gap"></span> polynomial gap</span><span><span class="dot"></span> unknown</span><span><span class="dot impossible"></span> impossible</span><span class="muted">· rows follow the assumption tree; each cell: best upper bound vs lower bound, and what forces the lower bound</span></div>
      <div class="row head"><div>Setting</div>${p.measures.map(mm => `<div>${esc(mm.name)}</div>`).join('')}</div>
      ${p.order.map(n => `<div class="row${n.variant ? '' : ' gaprow'}"><div class="name" style="padding-left:${n.depth * 0.9}rem">
          <a href="${L('problem', p.id, n.id)}">${fmt(nodeTitle(p, n))}</a>${n.parent ? ` <span class="small muted">${fmt(edgeText(p, n))}</span>` : ''}
          ${n.variant ? `<div class="summary">${(n.variant.open || []).length} open · ${(n.variant.results || []).length} results</div>` : ''}</div>
          ${p.measures.map(mm => cell(n.variant, mm)).join('')}</div>`).join('')}
    </section>`;
  }

  // live metrics for ranking problems: distinct authors cited, and the problems a solution would feed
  const KEYRE = /\[([A-Z][A-Za-z]+\d{4}[A-Za-z0-9]*)\]/g;
  function problemPeople(p) {
    const keys = new Set([p.origin && p.origin.ref]);
    p.variants.forEach(v => { (v.results || []).forEach(r => keys.add(r.ref)); (v.lower_bounds || []).forEach(l => keys.add(l.ref)); });
    const blob = JSON.stringify({ s: p.statement, h: p.history, v: p.variants.map(v => [v.notes, v.open, v.summary]), d: p.derived_from, r: p.related });
    for (const m of blob.matchAll(KEYRE)) keys.add(m[1]);
    const people = new Set(), papers = [...keys].filter(k => state.refs[k]);
    papers.forEach(k => (state.refs[k].authors || []).forEach(a => people.add(a.replace(/\s+/g, ' ').trim())));
    return { people: people.size, papers: papers.length };
  }
  function problemReach(p) {
    const fams = state.index.families || [], out = new Set(), stack = [p];
    while (stack.length) {
      const q = stack.pop();
      derivedOf(q).forEach(c => { if (!out.has(c.id) && c !== p) { out.add(c.id); stack.push(c); } });
      fams.filter(f => (f.related || []).some(r => r.problem === q.id)).forEach(f => (f.problems || []).forEach(id => { const c = state.problems[id]; if (c && c !== p && !out.has(id)) { out.add(id); stack.push(c); } }));
    }
    relatedOf(p).forEach(r => out.add(r.q.id));
    out.delete(p.id);
    return out;
  }
  let openSort = 'reach';
  function openTable() {
    const rows = state.index.problems.map(id => state.problems[id]).filter(Boolean).map(p => {
      const pp = problemPeople(p), reach = problemReach(p);
      return { p, ...pp, reach: reach.size, reachList: [...reach], open: p.variants.reduce((n, v) => n + (v.open || []).length, 0) };
    });
    const key = { reach: r => r.reach * 1000 + r.people, people: r => r.people * 1000 + r.papers, open: r => r.open * 1000 + r.people }[openSort];
    rows.sort((x, y) => key(y) - key(x) || x.p.name.localeCompare(y.p.name));
    const btn = (id, label) => `<button class="${openSort === id ? 'on' : ''}" data-osort="${id}">${label}</button>`;
    return `<div class="land-tabs">${btn('reach', 'Downstream reach')}${btn('people', 'People')}${btn('open', 'Open questions')}</div>
      <div class="land-scroll"><table class="landrel otable"><thead><tr><th>#</th><th>Problem</th><th>Reach</th><th>People</th><th>Papers</th><th>Open</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr><td class="muted">${i + 1}</td><td><a href="${L('problem', r.p.id)}">${esc(r.p.name)}</a> <span class="small muted">${esc(state.models[r.p.model].name)}</span>${r.reach ? `<div class="small muted">feeds ${r.reachList.slice(0, 6).map(id => esc(state.problems[id].name)).join(', ')}${r.reachList.length > 6 ? ` and ${r.reachList.length - 6} more` : ''}</div>` : ''}</td><td><b>${r.reach}</b></td><td>${r.people}</td><td>${r.papers}</td><td>${r.open}</td></tr>`).join('')}
      </tbody></table></div>`;
  }
  function openPage() {
    const pri = state.index.priorities;
    const top = pri ? `<section class="panel priorities"><h2>The most consequential</h2><p class="small muted">${mdInline(pri.intro)}</p>
      <ol class="prio">${pri.items.map(it => `<li><h3>${esc(it.title)}</h3><div class="prose">${md(it.question)}</div>
        <p class="small"><b>Why it matters.</b> ${mdInline(it.why)}</p>
        <div class="chips">${(it.settings || []).map(([pid, vid]) => state.problems[pid] && state.problems[pid].nodes && state.problems[pid].nodes[vid] ? `<a class="chip assume" href="${L('problem', pid, vid)}">${esc(state.problems[pid].name)}: ${fmt(state.problems[pid].nodes[vid].variant ? state.problems[pid].nodes[vid].variant.title : vid)}</a>` : (state.problems[pid] ? `<a class="chip assume" href="${L('problem', pid)}">${esc(state.problems[pid].name)}</a>` : '')).join('')}</div></li>`).join('')}</ol>
      ${state.overviews['consequential-open-problems'] ? `<p class="small"><a href="${L('overview', 'consequential-open-problems')}">Read the ranking as an essay →</a></p>` : ''}</section>` : '';
    const sections = state.index.problems.map(id => state.problems[id]).filter(Boolean).map(p => {
      const items = p.order.filter(n => n.variant && (n.variant.open || []).length);
      if (!items.length) return '';
      return `<section class="panel"><h2><a href="${L('problem', p.id)}">${esc(p.name)}</a></h2>
        ${items.map(n => `<h3><a href="${L('problem', p.id, n.id)}">${fmt(n.variant.title)}</a> <span class="small muted">${fmt(settingText(p, n))}</span></h3>
          <ol class="open">${n.variant.open.map(q => `<li>${md(q)}</li>`).join('')}</ol>`).join('')}</section>`;
    }).join('');
    return `<h1>Open questions</h1><p class="muted lead">The questions a solution to which would matter most, every problem ranked by how far a solution would reach and by how many people have worked on it, and then every open question in the catalogue.</p>
      ${top}
      <h2>Problems ranked</h2><p class="small muted"><b>Reach</b> counts the problems a solution feeds: problems derived from it, problems whose family builds on it (for example every computing-with-agents problem starts by dispersing), and problems linked to it. <b>People</b> counts the distinct authors of the papers the atlas cites for the problem, which measures the atlas's coverage rather than the whole literature.</p>
      <section class="panel" id="open-table">${openTable()}</section>
      <h2>All open questions</h2><p class="small muted">Grouped by problem and ordered along each problem's assumption tree.</p>
      ${sections || '<p class="empty">Nothing yet.</p>'}`;
  }

  function referencesPage() {
    const keys = Object.keys(state.refs).sort((a, b) => (state.refs[a].year || 0) - (state.refs[b].year || 0) || a.localeCompare(b));
    const used = {};
    Object.values(state.problems).forEach(p => p.variants.forEach(v => {
      [...(v.results || []), ...(v.lower_bounds || [])].forEach(r => { if (r.ref) (used[r.ref] = used[r.ref] || new Set()).add(`${p.id}/${v.id}`); });
    }));
    return `<h1>References</h1><p class="muted lead">${keys.length} entries. Keys are used as <code>[Key]</code> citations throughout the catalogue.</p>
      <section class="panel">${keys.map(k => { const r = state.refs[k]; return `<div class="ref" id="ref-${esc(k)}">
        <div><span class="key">${esc(k)}</span></div>
        <div>${esc((r.authors || []).join(', '))} (${esc(r.year)}). <span class="title">${fmt(r.title)}</span>. <i>${esc(r.venue || '')}</i>${r.journal ? `; journal version: <i>${esc(r.journal)}</i>` : ''}.</div>
        <div class="links">${r.doi ? `<a href="https://doi.org/${esc(r.doi)}" rel="noopener">doi:${esc(r.doi)}</a>` : ''}${r.arxiv ? `<a href="https://arxiv.org/abs/${esc(r.arxiv)}" rel="noopener">arXiv:${esc(r.arxiv)}</a>` : ''}${r.url ? `<a href="${esc(r.url)}" rel="noopener">link</a>` : ''}
          ${used[k] ? `<span class="small muted">cited in ${[...used[k]].map(x => `<a href="${L('problem', ...x.split('/'))}">${esc(x.split('/')[1])}</a>`).join(', ')}</span>` : ''}</div>
        ${r.note ? `<div class="small muted">${md(r.note)}</div>` : ''}</div>`; }).join('')}</section>`;
  }

  /* ---------- citing the atlas ---------- */
  function citation() {
    const c = state.index.citation || {};
    const url = c.url || (String(location.protocol || '').startsWith('http') ? String(location.href || '').split('#')[0] : '');
    return { ...c, url };
  }
  function citeText(c) {
    return `${(c.authors || []).join(', ')}. ${c.title || state.index.title}. Version ${c.version || ''}, ${c.year || ''}.${c.url ? ' ' + c.url : ''}`;
  }
  function citeBibtex(c) {
    const last = (c.authors && c.authors[0] || 'Anon').trim().split(/\s+/).pop();
    return [`@misc{${last}${c.year || ''},`, `  author = {${(c.authors || []).join(' and ')}},`, `  title  = {${c.title || state.index.title}},`, `  year   = {${c.year || ''}},`, `  note   = {Version ${c.version || ''}},`, ...(c.url ? [`  url    = {${c.url}},`] : []), '}'].join('\n');
  }
  function citeDialogHtml() {
    const c = citation();
    return `<div class="cite-modal-card" role="document">
      <button type="button" class="cite-close" data-cite-close aria-label="Close">×</button>
      <h2><span class="q">&#x275D;</span> Cite this atlas</h2>
      <h3 class="eyebrow">Cite this as</h3><p class="citetext">${esc(citeText(c))}</p>
      <h3 class="eyebrow">BibTeX</h3><pre class="bibtex">${esc(citeBibtex(c))}</pre>
      <div class="cite-actions"><button type="button" data-copy-bibtex>Copy BibTeX</button>${c.pdf ? `<a href="${esc(c.pdf)}">Download the PDF</a>` : ''}</div>
    </div>`;
  }
  function openCite() {
    let dlg = document.getElementById('cite-dialog');
    if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'cite-dialog'; dlg.className = 'cite-modal'; document.body.appendChild(dlg); }
    dlg.innerHTML = citeDialogHtml();
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }
  if (document.addEventListener) document.addEventListener('click', e => {
    const open = e.target.closest && e.target.closest('[data-open-cite]');
    if (open) { e.preventDefault(); openCite(); return; }
    const dlg = document.getElementById('cite-dialog');
    if (!dlg) return;
    if (e.target.closest('[data-cite-close]') || e.target === dlg) { dlg.close ? dlg.close() : dlg.removeAttribute('open'); return; }
    const cp = e.target.closest('[data-copy-bibtex]');
    if (cp && dlg.contains(cp)) { const t = dlg.querySelector('.bibtex'); if (t && navigator.clipboard) navigator.clipboard.writeText(t.textContent).then(() => { cp.textContent = 'Copied'; }); }
  });

  const aiNote = cls => state.index && state.index.ai_disclaimer ? `<p class="ai-note ${cls}"><span class="ai-tag">AI use</span> ${esc(state.index.ai_disclaimer)}</p>` : '';
  function renderCiteFooter() {
    const el = document.getElementById('cite-footer');
    if (!el || !state.index) return;
    const c = citation();
    const ai = document.getElementById('ai-footer'); if (ai) ai.innerHTML = aiNote('foot');
    el.innerHTML = `<span class="lbl"><span class="q">&#x275D;</span> Cite this as</span> <span class="txt">${esc(citeText(c))}</span> <a href="${L('cite')}" data-open-cite>BibTeX</a>${c.pdf ? ` · <a href="${esc(c.pdf)}">PDF</a>` : ''}`;
  }
  function citePage() {
    const c = citation();
    return `<h1><span class="q">&#x275D;</span> Cite this atlas</h1>
      <p class="muted lead">Please cite the atlas as a whole; for a result, cite the paper the atlas gives for it.</p>
      <section class="panel citebox"><h3 class="eyebrow">Cite this as</h3><p class="citetext">${esc(citeText(c))}</p>
        <h3 class="eyebrow">BibTeX</h3><pre class="bibtex">${esc(citeBibtex(c))}</pre>
        <button type="button" data-copy-bibtex>Copy BibTeX</button></section>
      ${c.pdf ? `<section class="panel"><h3 class="eyebrow">The atlas as a book</h3><p>The same content, organised as a book with a contents page, appendices and a bibliography: <a href="${esc(c.pdf)}">download the PDF</a>.</p></section>` : ''}`;
  }

  function notFound(kind, id) { return `<div class="error">No ${esc(kind)} with id <code>${esc(id)}</code>.</div>`; }

  /* ---------- search ----------
     A plain substring index over problems, settings, open questions, perspectives,
     models, axes and references. Every query word must occur; matches in the title
     rank first. Built once, on the first query. */
  const TEXPLAIN = { lceil: '⌈', rceil: '⌉', lfloor: '⌊', rfloor: '⌋', Omega: 'Ω', Theta: 'Θ', log: 'log', min: 'min', max: 'max', neq: '≠', ne: '≠', approx: '≈', in: '∈', mid: '|', ldots: '…', dots: '…', cdots: '⋯', sum: 'Σ', tilde: '~' };
  const plain = s => String(s || '').replace(/\$([^$]*)\$/g, '$1').replace(/\\([a-zA-Z]+)/g, (m, w) => TEXPLAIN[w] || TEXSYM[w] || ' ').replace(/[{}_^*`#>]/g, ' ').replace(/\[([A-Z][A-Za-z]*\d{4}[A-Za-z0-9]*)\]/g, (m, k) => shortCite(k)).replace(/\s+/g, ' ').trim();
  const fold = s => plain(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  let searchIndex = null;
  function buildSearchIndex() {
    const out = [];
    const add = (type, title, sub, href, body) => out.push({ type, title, sub, href, t: fold(title), b: fold([title, sub, body].join(' ')), raw: plain(body) });
    Object.values(state.models).forEach(m => {
      add('Model', m.name, m.summary, L('model', m.id), [m.description, (m.story || []).map(x => x.heading + ' ' + x.body).join(' ')].join(' '));
      m.axes.forEach(a => add('Assumption', a.name, `${m.name}: ${a.values.map(v => plain(v.label)).join(' · ')}`, L('model', m.id), [a.origin, a.values.map(v => [v.label, v.short, v.definition, v.description].join(' ')).join(' ')].join(' ')));
    });
    state.index.problems.map(id => state.problems[id]).filter(Boolean).forEach(p => {
      const model = state.models[p.model];
      add('Problem', p.name, `${model ? model.name : ''} · ${plain(p.summary)}`, L('problem', p.id), [p.summary, p.statement, p.history, p.primer ? [p.primer.intro, (p.primer.ideas || []).map(x => [x.title, x.idea, x.analysis].join(' ')).join(' ')].join(' ') : ''].join(' '));
      (p.axes_local || []).forEach(a => add('Assumption', a.name, `${p.name}: ${a.values.map(v => plain(v.label)).join(' · ')}`, L('problem', p.id), [a.origin, a.values.map(v => [v.label, v.definition].join(' ')).join(' ')].join(' ')));
      p.variants.forEach(v => {
        const href = L('problem', p.id, v.node.id);
        add('Setting', v.title, `${p.name} · ${plain(v.summary)}`, href, [v.summary, v.statement, v.notes, settingText(p, v.node), (v.results || []).map(r => [shortCite(r.ref), r.note, (r.assumes || []).join(' ')].join(' ')).join(' '), (v.lower_bounds || []).map(b => [b.bottleneck, (b.preconditions || []).join(' ')].join(' ')).join(' ')].join(' '));
        (v.open || []).forEach(q => add('Open question', plain(q).slice(0, 110) + (plain(q).length > 110 ? '…' : ''), `${p.name} · ${v.title}`, href, q));
      });
    });
    if (state.notation) Object.entries(state.notation.models || {}).forEach(([mid, rows]) => rows.forEach(r => add('Symbol', plain('$' + r.symbol + '$'), `${state.models[mid] ? state.models[mid].name : mid}: ${plain(r.meaning)}`, L('notation'), [r.meaning, r.papers_write].join(' '))));
    Object.values(state.overviews).forEach(o => add('Perspective', o.title, plain(o.summary), L('overview', o.id), (o.sections || []).map(x => x.heading + ' ' + x.body).join(' ')));
    Object.entries(state.refs).forEach(([k, r]) => add('Paper', r.title, `${(r.authors || []).join(', ')} · ${r.venue || ''} ${r.year || ''}`, L('references', k), [k, r.note].join(' ')));
    return out;
  }
  const TYPE_RANK = { Problem: 0, Model: 1, Assumption: 2, Symbol: 3, Perspective: 4, Setting: 5, 'Open question': 6, Paper: 7 };
  function searchAll(q) {
    const words = fold(q).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    if (!searchIndex) searchIndex = buildSearchIndex();
    return searchIndex.filter(e => words.every(w => e.b.includes(w)))
      .map(e => ({ e, s: words.reduce((s, w) => s + (e.t.includes(w) ? 10 : 0) + (e.t.startsWith(w) ? 5 : 0), 0) - TYPE_RANK[e.type] }))
      .sort((x, y) => y.s - x.s).map(x => x.e);
  }
  function snippet(e, q) {
    const words = fold(q).split(/\s+/).filter(Boolean);
    const low = e.raw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const i = words.map(w => low.indexOf(w)).filter(x => x >= 0).sort((a, b) => a - b)[0];
    if (i === undefined) return esc(e.sub || '');
    const a = Math.max(0, i - 60), s = (a ? '…' : '') + e.raw.slice(a, i + 120) + (i + 120 < e.raw.length ? '…' : '');
    let h = esc(s);
    words.forEach(w => { if (w.length > 1) h = h.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), m => `<mark>${m}</mark>`); });
    return h;
  }
  const encQ = q => encodeURIComponent(q).replace(/\./g, '%2E');
  const slugT = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  function searchPage(raw) {
    let q = raw || ''; try { q = decodeURIComponent(q); } catch (e) { /* keep the raw text */ }
    const hits = searchAll(q);
    const groups = {};
    hits.forEach(e => (groups[e.type] = groups[e.type] || []).push(e));
    const types = Object.keys(groups).sort((a, b) => TYPE_RANK[a] - TYPE_RANK[b]);
    return `<div class="crumbs"><a href="${L()}">Home</a><span class="sep">›</span><span>Search</span></div>
      <h1>Search</h1>
      <form class="search-page" data-search-form><input type="search" name="q" value="${esc(q)}" placeholder="Search the atlas" aria-label="Search the atlas"><button type="submit">Search</button></form>
      <p class="muted">${q ? `${hits.length} result${hits.length === 1 ? '' : 's'} for “${esc(q)}”.` : 'Type words to search; every word must occur.'} ${types.map(t => `<a href="#" data-jump="st-${slugT(t)}">${esc(t)} (${groups[t].length})</a>`).join(' · ')}</p>
      ${types.map(t => `<section id="sec-st-${slugT(t)}"><h2>${esc(t)}${groups[t].length > 1 ? 's' : ''}</h2><div class="panel search-list">${groups[t].map(e => `<a class="search-hit" href="${e.href}"><span class="sh-title">${fmt(e.title)}</span><span class="sh-sub small muted">${esc(plain(e.sub)).slice(0, 220)}</span><span class="sh-snip small">${snippet(e, q)}</span></a>`).join('')}</div></section>`).join('')}`;
  }
  // the live dropdown under the search box in the top bar
  const sInput = document.getElementById('search'), sBox = document.getElementById('search-results');
  let sSel = -1;
  function searchDropdown() {
    const q = sInput.value.trim();
    if (!q || !state.index) { sBox.hidden = true; sInput.setAttribute('aria-expanded', 'false'); return; }
    const hits = searchAll(q), top = hits.slice(0, 9);
    sSel = -1;
    sBox.innerHTML = (top.length ? top.map((e, i) => `<a class="sr-item" role="option" data-i="${i}" href="${e.href}"><span class="sr-type">${esc(e.type)}</span><span class="sr-title">${fmt(e.title)}</span><span class="sr-sub">${esc(plain(e.sub)).slice(0, 110)}</span></a>`).join('') : '<div class="sr-empty">No match.</div>')
      + `<a class="sr-all" href="${L('search', encQ(q))}">${hits.length > top.length ? `All ${hits.length} results` : 'Open as a page'} →</a>`;
    sBox.hidden = false; sInput.setAttribute('aria-expanded', 'true');
  }
  function closeSearch() { sBox.hidden = true; sInput.setAttribute('aria-expanded', 'false'); }
  if (sInput) {
    sInput.addEventListener('input', searchDropdown);
    sInput.addEventListener('focus', searchDropdown);
    sInput.addEventListener('keydown', e => {
      const items = [...sBox.querySelectorAll('.sr-item, .sr-all')];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); if (sBox.hidden || !items.length) return;
        sSel = (sSel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items.forEach((x, i) => x.classList.toggle('on', i === sSel));
      } else if (e.key === 'Enter') {
        e.preventDefault(); const q = sInput.value.trim(); if (!q) return;
        location.hash = sSel >= 0 && items[sSel] ? items[sSel].getAttribute('href') : L('search', encQ(q));
        closeSearch(); sInput.blur();
      } else if (e.key === 'Escape') { closeSearch(); sInput.blur(); }
    });
    sBox.addEventListener('click', e => { if (e.target.closest('a')) { closeSearch(); sInput.blur(); } });
    document.addEventListener('click', e => { if (!e.target.closest('.search')) closeSearch(); });
    document.addEventListener('keydown', e => {
      if (e.key === '/' && !e.target.closest('input, textarea, select') && !e.metaKey && !e.ctrlKey) { e.preventDefault(); sInput.focus(); sInput.select(); }
    });
  }

  /* ---------- explore: pick a model and assumptions, see what is known ----------
     Two readings of a selection. "Matching settings" filters the catalogued settings:
     an axis left on "any" is unrestricted. "What holds here" reads the selection as one
     setting (an axis left on "any" assumes nothing, level 0) and collects, per problem,
     the catalogued setting with exactly these assumptions, the algorithms that carry
     over from the closest weaker settings and the lower bounds that carry over from the
     closest stronger ones. Route: #/explore/<model>/<mode>/<axis~value,...>. */
  function exploreParse(parts) {
    const mid = state.models[parts[1]] ? parts[1] : state.index.models[0];
    const mode = parts[2] === 'holds' ? 'holds' : 'match';
    const sel = {};
    (parts[3] || '').split(',').filter(Boolean).forEach(x => { const [a, v] = x.split('~'); if (a && v) sel[a] = v; });
    return { mid, mode, sel };
  }
  const exploreHref = (mid, mode, sel) => L('explore', mid, mode, Object.entries(sel).map(([a, v]) => `${a}~${v}`).join(','));
  function explorePage(parts) {
    const { mid, mode, sel } = exploreParse(parts);
    const m = state.models[mid];
    let probs = state.index.problems.map(id => state.problems[id]).filter(p => p && p.model === mid);
    const fams = (state.index.families || []).filter(f => probs.some(p => f.problems.includes(p.id)));
    if (sel.family) probs = probs.filter(p => (fams.find(f => f.id === sel.family) || { problems: [] }).problems.includes(p.id));
    if (sel.problem) probs = probs.filter(p => p.id === sel.problem);
    const one = sel.problem && state.problems[sel.problem] && state.problems[sel.problem].model === mid ? state.problems[sel.problem] : null;
    const axes = [...m.axes, ...(one ? one.axes_local : [])];
    const set = (k, v) => { const s = { ...sel }; if (v == null) delete s[k]; else s[k] = v; if (k === 'family') delete s.problem; if (k === 'problem' && one) (one.axes_local || []).forEach(a => delete s[a.id]); return exploreHref(mid, mode, s); };
    const axisRow = a => {
      const vs = [...a.values].sort((x, y) => (x.level || 0) - (y.level || 0));
      return `<div class="ex-axis"><div class="ex-name">${esc(a.name)}</div><div class="chips">
        <a class="chip ${sel[a.id] ? 'base' : 'on'}" href="${set(a.id, null)}" title="${mode === 'holds' ? 'nothing assumed on this axis' : 'do not filter on this axis'}">${mode === 'holds' ? 'nothing assumed' : 'any'}</a>
        ${vs.filter(v => mode === 'match' || v.level).map(v => `<a class="chip ${sel[a.id] === v.id ? 'on' : (v.level ? 'stronger' : 'base')}" href="${set(a.id, v.id)}" ${v.description ? `title="${esc(plain(v.description))}"` : ''}><span class="lvl">${v.level || 0}</span>${fmt(v.short || v.label)}</a>`).join('')}
      </div></div>`;
    };
    // a problem's view of the selection: its own axes only (ignored axes drop out)
    const settingFor = p => ({ ...p.zero, ...Object.fromEntries(Object.entries(sel).filter(([a, v]) => p.axisById[a] && p.axisById[a].values.some(x => x.id === v))) });
    const cellsUB = (p, v) => p.measures.map(mm => { const b = bestResult(v, mm.id); return b ? `<span>${esc(mm.name)} <b>${tex(b[mm.id])}</b> <span class="small muted">${shortCite(b.ref)}</span></span>` : ''; }).join('');
    const cellsLB = (p, v) => p.measures.map(mm => { const b = lowerBound(v, mm.id); return b ? `<span>${esc(mm.name)} <b>${tex(b.bound)}</b>${b.bottleneck ? ` <span class="small muted">${fmt(b.bottleneck)}</span>` : ''}</span>` : ''; }).join('');
    const vlink = (p, v) => `<a href="${L('problem', p.id, v.node.id)}">${fmt(v.title)}</a>`;
    let body = '', count = 0;
    if (mode === 'match') {
      const rows = probs.flatMap(p => p.variants.filter(v => Object.entries(sel).every(([a, x]) => !p.axisById[a] || !p.axisById[a].values.some(y => y.id === x) || v.assumptions[a] === x)).map(v => ({ p, v })));
      count = rows.length;
      body = rows.length ? `<div class="land-scroll"><table class="landrel ex-table"><thead><tr><th>Problem</th><th>Setting</th><th>Assumes</th><th>Best upper bound vs lower bound</th></tr></thead><tbody>
        ${rows.map(({ p, v }) => `<tr><td data-label="Problem"><a href="${L('problem', p.id)}">${esc(p.name)}</a></td><td data-label="Setting">${vlink(p, v)}${v.standard ? ' <span class="badge std">standard</span>' : ''}</td>
          <td data-label="Assumes"><div class="chips tiny">${v.node.atoms.map(([a, x]) => `<span class="chip stronger" title="${esc((p.axisById[a] || {}).name || a)}: ${esc(plain(valueOf(p, a, x).label))}"><b>+</b>${fmt(shortOf(p, a, x))}</span>`).join('') || '<span class="muted small">nothing</span>'}</div></td>
          <td data-label="Upper vs lower bound">${p.measures.map(mm => { const st = statusOf(v, mm.id), br = bestResult(v, mm.id), lb = lowerBound(v, mm.id); return `<div class="ex-m"><span class="dot ${st}" title="${STATUS_LABEL[st]}"></span><span class="small muted">${esc(mm.name)}</span> ${br ? tex(br[mm.id]) : '<span class="muted">—</span>'} <span class="small muted">vs</span> ${lb ? tex(lb.bound) : '<span class="muted">—</span>'}</div>`; }).join('')}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="empty">No catalogued setting makes these assumptions. Switch to “What holds here” to see what carries over from neighbouring settings.</p>';
    } else {
      body = probs.map(p => {
        const S = settingFor(p);
        const exact = p.variants.find(v => p.axes.every(a => v.assumptions[a.id] === S[a.id]));
        const others = p.variants.filter(v => v !== exact);
        const weaker = others.filter(v => weakerOrEqual(p, v.assumptions, S)), stronger = others.filter(v => weakerOrEqual(p, S, v.assumptions));
        const maxW = weaker.filter(v => !weaker.some(w => w !== v && weakerOrEqual(p, v.assumptions, w.assumptions)));
        const minS = stronger.filter(v => !stronger.some(w => w !== v && weakerOrEqual(p, w.assumptions, v.assumptions)));
        if (!exact && !maxW.length && !minS.length) return '';
        count++;
        return `<section class="panel ex-prob"><div class="section-title"><h3><a href="${L('problem', p.id)}">${esc(p.name)}</a></h3>${exact ? dots(p, exact.node) : ''}</div>
          ${exact ? `<div class="ex-exact"><span class="eyebrow">Catalogued setting</span> ${vlink(p, exact)} <span class="small muted">${fmt(exact.summary)}</span>
            <div class="bounds-inline">${p.measures.map(mm => { const st = statusOf(exact, mm.id), br = bestResult(exact, mm.id), lb = lowerBound(exact, mm.id); return `<span><span class="dot ${st}"></span>${esc(mm.name)} ${br ? `<b>${tex(br[mm.id])}</b>` : '—'} vs ${lb ? `<b>${tex(lb.bound)}</b>` : '—'}</span>`; }).join('')}</div></div>`
            : `<p class="small muted">No catalogued setting with exactly these assumptions; <a href="${L('problem', p.id)}">see the tree</a>.</p>`}
          <div class="imp-grid">
            <div><h4>Algorithms that carry over <span class="small muted">from the closest weaker settings</span></h4>${maxW.length ? maxW.map(v => `<div class="imp">${vlink(p, v)}<div class="bounds-inline">${cellsUB(p, v) || '<span class="muted small">no algorithm recorded</span>'}</div></div>`).join('') : '<p class="empty">None catalogued.</p>'}</div>
            <div><h4>Lower bounds that carry over <span class="small muted">from the closest stronger settings</span></h4>${minS.length ? minS.map(v => `<div class="imp">${vlink(p, v)}<div class="bounds-inline">${cellsLB(p, v) || '<span class="muted small">no lower bound recorded</span>'}</div></div>`).join('') : '<p class="empty">None catalogued.</p>'}</div>
          </div></section>`;
      }).join('') || '<p class="empty">No problem of this model has a catalogued setting comparable with this one.</p>';
    }
    const nSel = Object.keys(sel).filter(k => k !== 'family' && k !== 'problem').length;
    return `<div class="crumbs"><a href="${L()}">Home</a><span class="sep">›</span><span>Explore</span></div>
      <h1>Explore by assumptions</h1>
      <p class="muted lead">Choose a model and the assumptions you make; the atlas lists what is known there. <a class="ex-jump small" href="#" data-jump="ex-results">Jump to results ↓</a></p>
      <div class="land-tabs ex-models">${state.index.models.map(id => `<a class="${id === mid ? 'on' : ''}" href="${exploreHref(id, mode, {})}">${esc(state.models[id].name)}</a>`).join('')}</div>
      <section class="panel ex-panel">
        <div class="land-tabs"><a class="${mode === 'match' ? 'on' : ''}" href="${exploreHref(mid, 'match', sel)}">Matching settings</a><a class="${mode === 'holds' ? 'on' : ''}" href="${exploreHref(mid, 'holds', sel)}">What holds here</a></div>
        <p class="small muted">${mode === 'match' ? 'Lists every catalogued setting that takes the chosen value on each axis you fix; axes left on <i>any</i> are not filtered.' : 'Reads your choice as one setting: axes left on <i>nothing assumed</i> are at level 0. For each problem it shows the catalogued setting with exactly these assumptions, the algorithms of the closest weaker settings (they work here) and the lower bounds of the closest stronger settings (they hold here). Results may carry extra assumptions, listed on their pages.'}</p>
        <div class="ex-axis"><div class="ex-name">Family</div><div class="chips"><a class="chip ${sel.family ? 'base' : 'on'}" href="${set('family', null)}">all</a>${fams.map(f => `<a class="chip ${sel.family === f.id ? 'on' : 'base'}" href="${set('family', f.id)}">${esc(f.name)}</a>`).join('')}</div></div>
        <div class="ex-axis"><div class="ex-name">Problem</div><div class="chips"><a class="chip ${sel.problem ? 'base' : 'on'}" href="${set('problem', null)}">all</a>${state.index.problems.map(id => state.problems[id]).filter(p => p && p.model === mid && (!sel.family || (fams.find(f => f.id === sel.family) || { problems: [] }).problems.includes(p.id))).map(p => `<a class="chip ${sel.problem === p.id ? 'on' : 'base'}" href="${set('problem', p.id)}">${esc(p.name)}</a>`).join('')}</div></div>
        ${one && one.variants.length ? `<div class="ex-axis"><div class="ex-name">Start from</div><div class="chips">${one.order.filter(n => n.variant).map(n => { const v = n.variant; const s2 = { family: sel.family, problem: one.id, ...Object.fromEntries(n.atoms) }; if (!s2.family) delete s2.family; return `<a class="chip ${Object.keys(sel).filter(k => k !== 'family' && k !== 'problem').length === n.atoms.length && n.atoms.every(([a, x]) => sel[a] === x) ? 'on' : 'base'}" href="${exploreHref(mid, mode, s2)}" title="${esc(plain(settingText(one, n)))}">${fmt(v.title)}</a>`; }).join('')}</div></div>` : (mode === 'holds' && !sel.problem ? '<p class="small muted">Choose a problem to start from one of its catalogued settings.</p>' : '')}
        <h3 class="eyebrow">Assumptions${one && one.axes_local.length ? ` <span class="muted">(the last ${one.axes_local.length} are specific to ${esc(one.name)})</span>` : ''}</h3>
        ${axes.map(axisRow).join('')}
        ${nSel ? `<p><a class="small" href="${exploreHref(mid, mode, Object.fromEntries(Object.entries(sel).filter(([k]) => k === 'family' || k === 'problem')))}">Clear assumptions</a></p>` : ''}
      </section>
      <div class="section-title" id="sec-ex-results"><h2>${mode === 'match' ? `${count} matching setting${count === 1 ? '' : 's'}` : `${count} problem${count === 1 ? '' : 's'} with something known`}</h2></div>
      ${body}`;
  }


  /* ---------- notation and the index of assumptions ---------- */
  function symbolTable(rows, withWhere = true) {
    return `<div class="land-scroll"><table class="landrel nottable"><thead><tr><th>Symbol</th><th>Meaning</th><th>Papers write</th>${withWhere ? '<th>Used in</th>' : ''}</tr></thead><tbody>
      ${rows.map(r => `<tr><td class="sym">${tex(r.symbol)}</td><td>${mdInline(r.meaning)}</td><td class="small">${r.papers_write ? mdInline(r.papers_write) : ''}</td>${withWhere ? `<td class="small">${r.where ? r.where.map(id => state.problems[id] ? `<a href="${L('problem', id)}">${esc(state.problems[id].name)}</a>` : esc(id)).join(', ') : 'whole model'}</td>` : ''}</tr>`).join('')}
      </tbody></table></div>`;
  }
  function modelSymbols(mid) {
    const n = state.notation; const rows = n && n.models && n.models[mid];
    return rows && rows.length ? symbolTable(rows) : '';
  }
  // every assumption of the atlas, by model: the model's axes, then the axes specific to each problem
  function assumptionIndex() {
    return state.index.models.map(mid => {
      const m = state.models[mid]; if (!m) return '';
      const probs = state.index.problems.map(id => state.problems[id]).filter(p => p && p.model === mid && (p.axes_local || []).length);
      const axisBlock = (a, scope, explore) => {
        const vs = [...a.values].sort((x, y) => (x.level || 0) - (y.level || 0));
        return `<div class="ix-axis" id="ix-${esc(scope)}-${esc(a.id)}"><h4>${esc(a.name)} <span class="small muted">${esc(scope === mid ? m.name : (state.problems[scope] || {}).name || scope)}</span></h4>
          <dl class="ix-vals">${vs.map(v => `<dt><span class="lvl">${v.level || 0}</span>${fmt(v.short || v.label)}${v.level && explore ? ` <a class="small" href="${exploreHref(mid, 'holds', { ...(scope !== mid ? { problem: scope } : {}), [a.id]: v.id })}" title="See what holds with this assumption">explore →</a>` : ''}</dt><dd>${v.definition ? mdInline(v.definition) : `<span class="muted">${fmt(v.label)}</span>`}</dd>`).join('')}</dl></div>`;
      };
      return `<section class="panel ix-model" id="sec-ix-${esc(mid)}"><h3><a href="${L('model', mid)}">${esc(m.name)}</a></h3>
        ${m.axes.map(a => axisBlock(a, mid, true)).join('')}
        ${probs.map(p => `<h4 class="eyebrow">Specific to <a href="${L('problem', p.id)}">${esc(p.name)}</a></h4>${p.axes_local.map(a => axisBlock(a, p.id, true)).join('')}`).join('')}</section>`;
    }).join('');
  }
  function notationPage() {
    const n = state.notation;
    if (!n) return notFound('page', 'notation');
    return `<div class="crumbs"><a href="${L()}">Home</a><span class="sep">›</span><span>Notation</span></div>
      <h1>Notation and assumptions</h1>
      <p class="lead muted">${mdInline(n.intro)}</p>
      <p class="small"><a href="#" data-jump="general">General conventions</a> · ${state.index.models.map(mid => `<a href="#" data-jump="sym-${esc(mid)}">${esc(state.models[mid].name)}</a>`).join(' · ')} · <a href="#" data-jump="assumptions">Index of assumptions</a></p>
      <section id="sec-general"><h2>General conventions</h2>${symbolTable(n.general || [], false)}</section>
      ${state.index.models.map(mid => `<section id="sec-sym-${esc(mid)}"><h2>Symbols: ${esc(state.models[mid].name)}</h2>${modelSymbols(mid)}</section>`).join('')}
      <section id="sec-assumptions"><h2>Index of assumptions</h2>
        <p class="muted small">Every assumption the atlas uses, with its formal definition: the axes of each model, then the axes specific to single problems. Level 0 assumes nothing; each higher level is a stronger assumption. Where the assumptions come from is told on each <a href="${L('model', state.index.models[0])}">model page</a>.</p>
        ${assumptionIndex()}</section>`;
  }


  /* ---------- contributing: prefilled GitHub issue forms, acknowledgements ---------- */
  function issueUrl(template, fields) {
    const repo = state.index && state.index.repo; if (!repo) return '#';
    const q = new URLSearchParams({ template, ...fields });
    return `${repo}/issues/new?${q.toString()}`;
  }
  function contributeBox(p, v) {
    if (!state.index.repo) return '';
    const page = String(location.href || '').split('#')[0] + (location.hash || '');
    const base = { problem: p.name, ...(v ? { setting: v.title } : {}) };
    return `<p class="contribute small muted">Know a better result${v ? ' for this setting' : ''}, or found a mistake? <a href="${esc(issueUrl('new-result.yml', { ...base, title: `[Result] ${p.name}${v ? ' — ' + v.title : ''}` }))}" rel="noopener">Suggest a result</a> · <a href="${esc(issueUrl('error.yml', { where: page, title: `[Error] ${p.name}${v ? ' — ' + v.title : ''}` }))}" rel="noopener">Report an error</a>. Accepted contributions are <a href="${L('acknowledgements')}">acknowledged</a>.</p>`;
  }
  function acknowledgementsPage() {
    const a = state.acks;
    if (!a) return notFound('page', 'acknowledgements');
    const people = a.people || [];
    return `<div class="crumbs"><a href="${L()}">Home</a><span class="sep">›</span><span>Acknowledgements</span></div>
      <h1>Acknowledgements</h1>
      <section class="panel prose">${md(a.intro)}</section>
      <h2>Contributors</h2>
      ${people.length ? `<section class="panel"><ul class="ack-list">${people.map(x => `<li><b>${x.github && !x.name ? `<a href="https://github.com/${esc(x.github)}" rel="noopener">@${esc(x.github)}</a>` : esc(x.name || 'anonymous')}</b>${x.name && x.github ? ` <span class="small muted">@${esc(x.github)}</span>` : ''}: ${mdInline(x.contribution)}${x.issue ? ` <a class="small" href="${esc(state.index.repo)}/issues/${esc(x.issue)}" rel="noopener">#${esc(x.issue)}</a>` : ''}${x.date ? ` <span class="small muted">${esc(x.date)}</span>` : ''}</li>`).join('')}</ul></section>` : `<p class="empty">None yet. Be the first: <a href="${esc(issueUrl('new-result.yml', {}))}" rel="noopener">suggest a result</a> or <a href="${esc(issueUrl('error.yml', {}))}" rel="noopener">report an error</a>.</p>`}
      <h2>Tools and data</h2>
      <section class="panel"><ul class="ack-list">${(a.tools || []).map(t => `<li><b>${esc(t.name)}</b>: ${mdInline(t.role)}</li>`).join('')}</ul>
      ${a.authors_note ? `<p class="small muted">${mdInline(a.authors_note)}</p>` : ''}</section>`;
  }

  /* ---------- router ---------- */
  let prevParts = null;
  function render() {
    const parts = location.hash.replace(/^#\/?/, '').split(/[\/.]/).filter(Boolean);
    const sameProblem = prevParts && prevParts[0] === 'problem' && parts[0] === 'problem' && prevParts[1] === parts[1];
    prevParts = parts;
    let html;
    try {
      if (!parts.length) html = homePage();
      else if (parts[0] === 'timeline') html = timelinePage();
      else if (parts[0] === 'model') html = modelPage(parts[1]);
      else if (parts[0] === 'problem') html = (parts[2] === 'map' || parts[2] === 'graph') ? problemPage(parts[1], null, parts[2]) : problemPage(parts[1], parts[2]);
      else if (parts[0] === 'overview') html = overviewPage(parts[1]);
      else if (parts[0] === 'open') html = openPage();
      else if (parts[0] === 'references') html = referencesPage();
      else if (parts[0] === 'cite') html = citePage();
      else if (parts[0] === 'explore') html = explorePage(parts);
      else if (parts[0] === 'notation') html = notationPage();
      else if (parts[0] === 'acknowledgements') html = acknowledgementsPage();
      else if (parts[0] === 'search') html = searchPage(location.hash.replace(/^#\/?search[\/.]?/, ''));
      else html = notFound('page', parts.join('/'));
    } catch (e) { console.error(e); html = `<div class="error">Render error: ${esc(e.message)}</div>`; }
    app.innerHTML = html;
    renderCiteFooter();
    fitGraph();
    if (parts[0] === 'references' && parts[1]) {
      const el = document.getElementById('ref-' + parts[1]);
      if (el) el.scrollIntoView({ block: 'start' });
    } else if (parts[0] === 'problem' && parts[2] && sameProblem) {
      // keep the problem header out of the way when jumping between variants
      const el = app.querySelector('.layout');
      if (el && window.innerWidth > 900) window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - 70));
      else window.scrollTo(0, 0);
    } else window.scrollTo(0, 0);
    const t = state.index && state.index.title ? state.index.title : 'Catalogue';
    const h1 = app.querySelector('h1');
    document.title = h1 && parts.length ? `${h1.textContent} · ${t}` : t;
  }

  app.addEventListener('submit', e => {
    const f = e.target.closest('[data-search-form]'); if (!f) return;
    e.preventDefault(); const q = f.q.value.trim(); if (q) location.hash = L('search', encQ(q));
  });
  app.addEventListener('mouseover', graphHover);
  app.addEventListener('focusin', graphHover);
  app.addEventListener('click', e => {
    const sm = e.target.closest('.sidenav > summary');
    if (sm && window.innerWidth > 900 && !e.target.closest('a')) e.preventDefault();
    if (e.target.closest('[data-papers]')) { graphPapers = !graphPapers; render(); return; }
    if (e.target.closest('[data-copy-bibtex]')) { const t = app.querySelector('.bibtex'); if (t && navigator.clipboard) navigator.clipboard.writeText(t.textContent).then(() => { e.target.textContent = 'Copied'; }); return; }
    const z = e.target.closest('[data-zoom]');
    if (z) {
      const c = app.querySelector('.gcanvas'); const cur = c ? +c.dataset.s || 1 : 1;
      graphZoom = z.dataset.zoom === 'fit' ? 'fit' : z.dataset.zoom === 'one' ? 1 : Math.max(0.3, Math.min(2, cur * (z.dataset.zoom === 'in' ? 1.25 : 0.8)));
      fitGraph();
    }
    const os = e.target.closest('[data-osort]');
    if (os) { openSort = os.dataset.osort; const t = document.getElementById('open-table'); if (t) t.innerHTML = openTable(); return; }
    const lc = e.target.closest('[data-lcell],[data-lview]');
    if (lc) {
      const sec = lc.closest('[data-landscape]'); const m = state.models[sec.dataset.landscape];
      if (lc.dataset.lview) { landState.view = lc.dataset.lview; } else { landState.sel = landState.sel === lc.dataset.lcell ? null : lc.dataset.lcell; }
      sec.querySelector('#land-body').innerHTML = landBody(m); return;
    }
    const js = e.target.closest('a[data-jump-sep]');
    if (js) { e.preventDefault(); const d = document.getElementById('sep-' + js.dataset.jumpSep); if (d) { d.closest('details').open = true; d.scrollIntoView({ block: 'center', behavior: 'smooth' }); } return; }
    const j = e.target.closest('a[data-jump]');
    if (j) { e.preventDefault(); if (j.dataset.jump === 'top') { window.scrollTo({ top: 0, behavior: 'smooth' }); return; } const el = document.getElementById('sec-' + j.dataset.jump); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  });
  if (SEP === '.') document.querySelectorAll('a[href^="#/"]').forEach(a => { a.setAttribute('href', L(...a.getAttribute('href').replace(/^#\/?/, '').split('/').filter(Boolean))); });
  window.addEventListener('hashchange', render);
  loadAll().then(render).catch(e => {
    console.error(e);
    app.innerHTML = `<div class="error"><b>Could not load the catalogue data.</b><br>${esc(e.message)}<br><br>Serve the folder over HTTP, e.g. <code>python3 -m http.server 8765</code>, then open <code>http://localhost:8765</code>.</div>`;
  });
})();
