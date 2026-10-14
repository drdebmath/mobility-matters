#!/usr/bin/env node
/* Renders every route of the site (including the computed tree nodes it finds) in Node (no browser) and reports render errors or
   KaTeX parse errors. Downloads KaTeX and Marked once into scripts/.cache/.
   Usage: node scripts/render-check.js            (all routes)
          node scripts/render-check.js '#/open'   (one route) */
const fs = require('fs'), path = require('path'), vm = require('vm'), https = require('https');
const ROOT = path.resolve(__dirname, '..');
const CACHE = path.join(__dirname, '.cache');
const LIBS = {
  'katex.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11/katex.min.js',
  'marked.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js',
};
const get = url => new Promise((res, rej) => https.get(url, r => {
  if (r.statusCode !== 200) return rej(new Error(`${url}: HTTP ${r.statusCode}`));
  let d = ''; r.on('data', c => d += c); r.on('end', () => res(d));
}).on('error', rej));

async function libs() {
  fs.mkdirSync(CACHE, { recursive: true });
  const out = {};
  for (const [name, url] of Object.entries(LIBS)) {
    const f = path.join(CACHE, name);
    if (!fs.existsSync(f)) fs.writeFileSync(f, await get(url));
    out[name] = fs.readFileSync(f, 'utf8');
  }
  return out;
}

function render(route, lib) {
  return new Promise(resolve => {
    const sandbox = { console, setTimeout, clearTimeout, URLSearchParams, URL };
    sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(lib['katex.min.js'], sandbox);
    vm.runInContext(lib['marked.min.js'], sandbox);
    const app = { innerHTML: '', dataset: {}, querySelector: () => null, addEventListener: () => {} };
    sandbox.innerWidth = 1280;
    const els = { app, 'footer-text': { textContent: '' }, 'repo-link': { hidden: true }, 'cite-footer': { innerHTML: '' }, 'ai-footer': { innerHTML: '' } };
    sandbox.document = { getElementById: id => els[id] || null, querySelectorAll: () => [], title: '' };
    sandbox.location = { hash: route };
    sandbox.fetch = async p => {
      const f = path.join(ROOT, p.split('?')[0]);
      if (!fs.existsSync(f)) return { ok: false, status: 404 };
      return { ok: true, json: async () => JSON.parse(fs.readFileSync(f, 'utf8')) };
    };
    sandbox.addEventListener = () => {}; sandbox.scrollTo = () => {};
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/app.js'), 'utf8'), sandbox);
    // resolve once the renderer has filled the page (data loads asynchronously), at most after 3 s
    const t0 = Date.now();
    const done = () => resolve(Object.assign(new String(app.innerHTML), { page: app.dataset && app.dataset.page, footer: els['footer-text'].innerHTML || '', cite: els['cite-footer'].innerHTML, ai: els['ai-footer'].innerHTML, title: sandbox.document.title }));
    const poll = () => (app.innerHTML && app.dataset.page) || Date.now() - t0 > 3000 ? setTimeout(done, 0) : setTimeout(poll, 5);
    poll();
  });
}

async function main() {
  const lib = await libs();
  const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/index.json'), 'utf8'));
  let routes = process.argv.slice(2);
  if (!routes.length) {
    routes = ['#/', '#/timeline', '#/cite', '#/open', '#/references', '#/notation', '#/acknowledgements', '#/search/dispersion', '#/search/byzantine%20gathering', ...index.models.flatMap(m => [`#/explore/${m}`, `#/explore/${m}/holds`]), '#/explore/mobile-agents-on-graphs/match/timing~async,faults~crash', '#/explore/mobile-agents-on-graphs/holds/timing~sync,ids~unique,initial~rooted,problem~dispersion', '#/explore/mobile-robots-in-the-plane/holds/scheduler~ssync,memory~lights', ...index.models.map(m => `#/model/${m}`), ...(index.overviews || []).map(o => `#/overview/${o}`)];
    for (const pid of index.problems) {
      const p = JSON.parse(fs.readFileSync(path.join(ROOT, `data/problems/${pid}.json`), 'utf8'));
      routes.push(`#/problem/${pid}`, `#/problem/${pid}/map`, ...p.variants.map(v => `#/problem/${pid}/${v.id}`));
    }
  }
  let failures = 0;
  const seen = new Set(routes);
  for (let i = 0; i < routes.length; i++) {
    const r = routes[i];
    const html = String(await render(r, lib));
    // follow links to computed nodes of the assumption tree (unnamed settings)
    if (process.argv.length <= 2) for (const m of html.matchAll(/href="(#\/problem\/[^"\/]+\/[^"\/]+)"/g)) {
      if (!seen.has(m[1])) { seen.add(m[1]); routes.push(m[1]); }
    }
    const errs = [];
    if (/Render error|Could not load/.test(html)) errs.push('render error');
    const kerr = html.match(/class="katex-error"[^>]*title="([^"]*)"/g);
    if (kerr) errs.push(`${kerr.length} KaTeX error(s): ${kerr.slice(0, 3).join(' | ')}`);
    if (html.length < 200) errs.push('empty page');
    if (errs.length) { failures++; console.log(`FAIL ${r}: ${errs.join('; ')}`); }
    else console.log(`ok   ${r} (${html.length} chars)`);
  }
  console.log(`${routes.length} routes, ${failures} failure(s)`);
  process.exit(failures ? 1 : 0);
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(2); });
module.exports = { libs, render };
