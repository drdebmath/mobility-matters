#!/usr/bin/env node
/* Writes a static, crawlable HTML page for every page of the atlas that a search engine or a
   language model should find: home, models, perspectives, problems, their progress maps and every
   catalogued setting, the notation, open questions, references, timeline and citation pages.
   Each page is the site shell with the page already rendered inside it (math as TeX between \( \),
   which crawlers and language models read), its own title, description and canonical address, and
   links between pages rewritten to real addresses (problem/dispersion/ instead of #/problem/dispersion).
   In a browser the renderer then takes over the page as usual.

   Usage: node scripts/prerender.js [OUTDIR]     (default: build/site)
   Also writes OUTDIR/sitemap.xml with every page. Run through scripts/build-site.sh, which copies the
   site to OUTDIR first; the GitHub Pages workflow does that on every push to main. */
const fs = require('fs'), path = require('path');
const { libs, render } = require('./render-check.js');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'build', 'site'));
const J = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Markdown with $math$ and [Key] citations -> one plain sentence for a meta description
const TEX = { le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', times: '×', cdot: '·', ldots: '…', dots: '…', infty: '∞', Delta: 'Δ', delta: 'δ', Omega: 'Ω', Theta: 'Θ', log: 'log', min: 'min', max: 'max', sqrt: '√', pi: 'π', tau: 'τ', varepsilon: 'ε', epsilon: 'ε', lceil: '⌈', rceil: '⌉', lfloor: '⌊', rfloor: '⌋', mathcal: '', mathrm: '', text: '', operatorname: '' };
const untex = s => s.replace(/\\([A-Za-z]+)/g, (m, w) => w in TEX ? TEX[w] : w).replace(/[{}]/g, '').replace(/\\,/g, ' ');
const plain = s => String(s || '').replace(/\[([A-Z][A-Za-z-]*\d{4}[A-Za-z0-9]*)\]/g, '').replace(/\$([^$]*)\$/g, (m, x) => untex(x))
  .replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
const cut = (s, n = 300) => s.length <= n ? s : s.slice(0, s.lastIndexOf(' ', n - 1)) + '…';

// the routes that get a page; the address of a route is its path without '#/' plus '/'
function routes(idx) {
  const out = [{ route: '#/', desc: plain(idx.abstract || idx.intro) }];
  for (const r of ['notation', 'open', 'references', 'timeline', 'cite', 'acknowledgements']) out.push({ route: `#/${r}` });
  for (const m of idx.models) out.push({ route: `#/model/${m}`, desc: plain(J(`data/models/${m}.json`).summary) });
  for (const o of idx.overviews || []) out.push({ route: `#/overview/${o}`, desc: plain(J(`data/overviews/${o}.json`).summary) });
  for (const pid of idx.problems) {
    const p = J(`data/problems/${pid}.json`);
    out.push({ route: `#/problem/${pid}`, desc: plain(p.summary) });
    out.push({ route: `#/problem/${pid}/map`, name: `${p.name}: progress map`, desc: `Progress map of ${p.name}: the best lower and upper bounds in every catalogued setting.` });
    for (const v of p.variants) out.push({ route: `#/problem/${pid}/${v.id}`, name: `${p.name}: ${plain(v.title)}`, desc: plain(`${p.name}, ${v.title}: ${v.summary || ''}`) });
  }
  return out;
}
const addr = route => route.replace(/^#\/?/, '') ? route.replace(/^#\/?/, '') + '/' : '';

async function main() {
  const idx = J('data/index.json');
  const site = idx.citation.url.replace(/\/?$/, '/');
  const lib = await libs();
  // TeX instead of KaTeX markup: a fraction of the size, and what crawlers and language models read best
  lib['katex.min.js'] = `window.katex = { renderToString: (tex, o) => { const e = String(tex).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); return o && o.displayMode ? '<span class="math display">\\\\[' + e + '\\\\]</span>' : '<span class="math">\\\\(' + e + '\\\\)</span>'; }, render: () => {} };`;
  const list = routes(idx);
  const pages = new Set(list.map(r => r.route));
  // the shell is index.html without what an earlier run generated (the blocks between prerender markers)
  const shell = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
    .replace(/<!-- prerender:(\w+) -->[\s\S]*?<!-- \/prerender:\1 -->/g, '')
    .replace(/<html lang="en"[^>]*>/, '<html lang="en">').replace(/<main id="app" class="container"[^>]*>/, '<main id="app" class="container">');
  const block = (name, s) => `<!-- prerender:${name} -->${s}<!-- /prerender:${name} -->`;
  let bytes = 0;
  for (const { route, desc, name } of list) {
    const r = await render(route, lib);
    let body = String(r);
    if (/Render error|Could not load/.test(body)) throw new Error(`render error on ${route}`);
    const a = addr(route), depth = a ? a.split('/').length - 1 : 0, base = depth ? '../'.repeat(depth) : '';
    // links between pages: real addresses (relative to <base>); other routes stay in the app
    const link = h => {
      const [rt, frag] = h.split('#ref-');
      if (/^#\/references\/./.test(h)) return `references/#ref-${h.replace(/^#\/references\//, '')}`;
      return pages.has(rt) ? (addr(rt) || './') + (frag ? '#ref-' + frag : '') : `./${h}`;
    };
    body = body.replace(/href="(#\/[^"]*)"/g, (_, h) => `href="${esc(link(h.replace(/&amp;/g, '&')))}"`);
    const h1 = (body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1];
    const heading = h1 ? h1.replace(/<[^>]+>/g, '').replace(/\\\(|\\\)/g, '').trim() : '';
    const title = route === '#/' ? idx.title : `${name || heading} · ${idx.title}`;
    const description = cut(desc || `${heading}: ${plain(idx.tagline)}`);
    const url = site + a;
    const ld = { '@context': 'https://schema.org', '@type': route === '#/' ? 'WebSite' : 'WebPage', name: title, description, url,
      inLanguage: 'en', dateModified: idx.citation.version, license: idx.license_url,
      author: (idx.citation.authors || []).map(n => ({ '@type': 'Person', name: n })),
      isPartOf: { '@type': 'WebSite', name: idx.citation.title, url: site } };
    let html = shell
      .replace('<html lang="en">', `<html lang="en" data-route="${esc(route)}">`)
      .replace('<meta charset="utf-8">', `<meta charset="utf-8">` + block('head', `${base ? `\n  <base href="${base}">` : ''}\n  <link rel="canonical" href="${esc(url)}">\n  <script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`))
      .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
      .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(description)}">`)
      .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(title)}">`)
      .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(description)}">`)
      .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${esc(url)}">`)
      .replace(/(<main id="app" class="container">)[\s\S]*?(<\/main>)/, (m, x, y) => `<main id="app" class="container" data-page="${esc(r.page || 'home')}">${block('main', '\n' + body + '\n')}${y}${route === '#/' ? block('deeplink', `\n  <script>if (/^#\\/./.test(location.hash)) document.getElementById('app').innerHTML = '<p class="muted">Loading…</p>';</script>`) : ''}`)
      .replace('<span id="footer-text"></span>', `<span id="footer-text">${block('foot', r.footer)}</span>`);
    // the scholar tags describe the whole atlas; keep them on its home page only
    if (route !== '#/') html = html.replace(/\s*<!-- scholar:begin[\s\S]*?<!-- scholar:end -->/, '');
    const file = path.join(OUT, a, 'index.html');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, html);
    bytes += Buffer.byteLength(html);
  }
  const extra = ['about.html', idx.citation.pdf || 'mobility-matters.pdf', 'llms.txt', 'llms-full.txt'];
  fs.writeFileSync(path.join(OUT, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + [...list.map(r => addr(r.route)), ...extra].map(a => `  <url><loc>${esc(site + a)}</loc><lastmod>${idx.citation.version}</lastmod></url>\n`).join('') + '</urlset>\n');
  console.log(`prerendered ${list.length} pages (${(bytes / 1048576).toFixed(1)} MB) and sitemap.xml`);
}
main().catch(e => { console.error(e); process.exit(1); });
