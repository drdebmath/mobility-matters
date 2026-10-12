#!/usr/bin/env python3
"""Keep the indexing metadata in step with data/index.json.

* index.html: the Google Scholar (Highwire Press) `citation_*` meta tags between
  <!-- scholar:begin --> and <!-- scholar:end -->.
* about.html: a plain, crawlable landing page (no JavaScript) with the title,
  author, version, abstract, contents, how to cite, licence and links, plus the same
  meta tags. Search engines and Google Scholar read this page; the atlas itself is
  a JavaScript application.

Run after changing the citation, version, abstract or the list of problems:
    python3 scripts/sync-meta.py          # write both files
    python3 scripts/sync-meta.py --check  # exit 1 if they are out of date (used by validate.py)
"""
import html, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
E = html.escape


def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def meta_tags(idx, indent="  "):
    c = idx["citation"]
    url = c["url"].rstrip("/") + "/"
    v = c.get("version", "")
    tags = [("citation_title", c["title"])]
    tags += [("citation_author", a) for a in c.get("authors", [])]
    tags += [("citation_publication_date", v.replace("-", "/")), ("citation_online_date", v.replace("-", "/")),
             ("citation_publisher", "Mobility Matters (living survey)"), ("citation_language", "en"),
             ("citation_abstract_html_url", url + "about.html"), ("citation_public_url", url),
             ("citation_pdf_url", url + c.get("pdf", "mobility-matters.pdf")),
             ("citation_keywords", "mobile agents; mobile robots; programmable matter; distributed computing; open problems; survey")]
    if c.get("doi"):
        tags.append(("citation_doi", c["doi"]))
    tags += [("DC.title", c["title"]), ("DC.creator", "; ".join(c.get("authors", []))), ("DC.date", v),
             ("DC.rights", idx.get("license", "")), ("DC.type", "Text")]
    return "\n".join(f'{indent}<meta name="{n}" content="{E(str(x), quote=True)}">' for n, x in tags)


def bibtex(idx):
    c = idx["citation"]
    last = c["authors"][0].split()[-1]
    key = f"{last}{c.get('year', '')}Mobility"
    fields = [("author", " and ".join(c["authors"])), ("title", "{" + c["title"] + "}"), ("year", str(c.get("year", ""))),
              ("howpublished", "\\url{" + c["url"] + "}"), ("note", f"Living survey, version {c.get('version', '')}")]
    if c.get("doi"):
        fields.append(("doi", c["doi"]))
    return "@misc{" + key + ",\n" + ",\n".join(f"  {k} = {{{v}}}" for k, v in fields) + "\n}"


def about(idx):
    c = idx["citation"]
    url = c["url"].rstrip("/") + "/"
    models = {m: load(DATA / "models" / f"{m}.json") for m in idx["models"]}
    probs = {p: load(DATA / "problems" / f"{p}.json") for p in idx["problems"]}
    n_set = sum(len(p["variants"]) for p in probs.values())
    n_ref = len(load(DATA / "references.json"))
    plain = lambda s: re.sub(r"\[([A-Z][A-Za-z]*\d{4}[A-Za-z0-9]*)\]", "", re.sub(r"\$([^$]*)\$", r"\1", s or "")).replace("**", "").replace("  ", " ")
    sections = []
    for mid, m in models.items():
        fams = []
        for f in idx.get("families", []):
            ps = [probs[p] for p in f["problems"] if p in probs and probs[p]["model"] == mid]
            if ps:
                items = "".join(f'<li><a href="./#/problem/{E(p["id"])}">{E(p["name"])}</a>: {E(plain(p["summary"]))}</li>' for p in ps)
                fams.append(f"<h4>{E(f['name'])}</h4><ul>{items}</ul>")
        sections.append(f'<h3><a href="./#/model/{E(mid)}">{E(m["name"])}</a></h3><p>{E(plain(m["summary"]))}</p>{"".join(fams)}')
    cite = f'{", ".join(c["authors"])}. {c["title"]}. Living survey, version {c.get("version", "")}. {c["url"]}' + (f" doi:{c['doi']}" if c.get("doi") else "")
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{E(c["title"])}</title>
  <meta name="description" content="{E(plain(idx.get('abstract', '')), quote=True)[:300]}">
{meta_tags(idx)}
  <meta property="og:type" content="article">
  <meta property="og:title" content="{E(c['title'], quote=True)}">
  <meta property="og:url" content="{E(url)}about.html">
  <link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
  <link rel="canonical" href="{E(url)}about.html">
  <style>
    :root {{ --bg: #fbfaf7; --fg: #1d1d1f; --muted: #5d5d63; --accent: #2f4fd1; --line: #e3e1db; --code: #f1efe9; }}
    @media (prefers-color-scheme: dark) {{ :root {{ --bg: #141416; --fg: #e9e9ec; --muted: #a3a3ab; --accent: #8ea2ff; --line: #2c2c31; --code: #1e1e22; }} }}
    body {{ background: var(--bg); color: var(--fg); font: 17px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 820px; margin: 0 auto; padding: 2rem 16px 4rem; }}
    h1 {{ font-family: Georgia, serif; font-size: 2rem; line-height: 1.2; margin-bottom: .3rem; }}
    h2 {{ margin-top: 2rem; border-top: 1px solid var(--line); padding-top: .8rem; }} h4 {{ margin: 1rem 0 .2rem; }}
    a {{ color: var(--accent); }} .muted {{ color: var(--muted); }} ul {{ padding-left: 1.2rem; }} li {{ margin: .2rem 0; }}
    pre {{ background: var(--code); padding: .8rem 1rem; border-radius: 8px; overflow-x: auto; font-size: .85rem; }}
    .links a {{ margin-right: 1rem; white-space: nowrap; }}
  </style>
</head>
<body>
  <h1>{E(c["title"])}</h1>
  <p class="muted">{E(", ".join(c["authors"]))} · living survey, version {E(c.get("version", ""))} · {len(probs)} problems, {n_set} settings, {n_ref} papers</p>
  <p class="links"><a href="./">Open the atlas</a><a href="{E(c.get('pdf', 'mobility-matters.pdf'))}">PDF</a><a href="{E(idx.get('repo', ''))}">Source</a><a href="{E(idx.get('repo', ''))}/issues/new/choose">Contribute</a></p>
  <h2>Abstract</h2>
  <p>{E(plain(idx.get("abstract", "")))}</p>
  <h2>Contents</h2>
  {"".join(sections)}
  <h2>How to cite</h2>
  <p>{E(cite)}</p>
  <pre>{E(bibtex(idx))}</pre>
  <h2>Licence</h2>
  <p>{E(idx.get("license", ""))}. AI use: {E(idx.get("ai_disclaimer", ""))}</p>
</body>
</html>
"""


def main():
    idx = load(DATA / "index.json")
    page = ROOT / "index.html"
    s = page.read_text(encoding="utf-8")
    block = "  <!-- scholar:begin (generated by scripts/sync-meta.py) -->\n" + meta_tags(idx) + "\n  <!-- scholar:end -->"
    if "<!-- scholar:begin" in s:
        new = re.sub(r"  <!-- scholar:begin.*?<!-- scholar:end -->", lambda m: block, s, flags=re.S)
    else:
        new = s.replace("  <link rel=\"icon\"", block + "\n  <link rel=\"icon\"", 1)
    ab = about(idx)
    old_ab = (ROOT / "about.html").read_text(encoding="utf-8") if (ROOT / "about.html").exists() else ""
    if "--check" in sys.argv:
        stale = [n for n, a, b in (("index.html", s, new), ("about.html", old_ab, ab)) if a != b]
        if stale:
            print("out of date: " + ", ".join(stale) + " (run python3 scripts/sync-meta.py)")
            sys.exit(1)
        return
    url = idx["citation"]["url"].rstrip("/") + "/"
    v = idx["citation"].get("version", "")
    (ROOT / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "".join(
        f"  <url><loc>{url}{p}</loc><lastmod>{v}</lastmod></url>\n" for p in ("", "about.html", idx["citation"].get("pdf", "mobility-matters.pdf"))) + "</urlset>\n", encoding="utf-8")
    (ROOT / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {url}sitemap.xml\n", encoding="utf-8")
    page.write_text(new, encoding="utf-8")
    (ROOT / "about.html").write_text(ab, encoding="utf-8")
    print("wrote index.html meta tags and about.html")


if __name__ == "__main__":
    main()
