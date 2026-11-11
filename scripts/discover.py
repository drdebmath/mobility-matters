#!/usr/bin/env python3
"""Weekly discovery of candidate papers for the atlas (no AI, stdlib only).

Sources: the arXiv API (by category and keyword, and by watched author), OpenAlex
(keyword search, for published versions and venues), Crossref (DOIs registered since
the last run: journals and LNCS proceedings that never reach arXiv), DataCite (LIPIcs
and other Dagstuhl proceedings), a monthly sweep of every watched author's works
(OpenAlex and Semantic Scholar author ids kept in data/watch.json), and an inbox
folder for Google Scholar alert e-mails that the owner saves or pastes (Scholar has
no public API and forbids scraping, so it is read only from those alerts).

Usage:
  python3 scripts/discover.py                  # since the last run (default: 8 days)
  python3 scripts/discover.py --days 30        # look further back
  python3 scripts/discover.py --authors        # also sweep the watched authors now (otherwise every 28 days)
  python3 scripts/discover.py --init-watch     # (re)build data/watch.json from the bibliography

Writes updates/<date>/candidates.json and candidates.md. After the agent has
processed them, `--record updates/<date>/candidates.json` marks them as seen in
data/watch.json and moves last_run forward (weekly.sh does this). Known papers (by DOI, arXiv id or title) are
dropped; the rest are scored by keyword and author matches.
"""
import argparse, datetime as dt, html, json, re, sys, time, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
WATCH = DATA / "watch.json"
UA = {"User-Agent": "mobility-matters-atlas/1.0 (weekly discovery; https://debasishpattanayak.com/mobility-matters/)"}
CATS = ["cs.DC", "cs.DS", "cs.RO", "cs.MA", "cs.CG", "cs.NI", "cs.ET"]

# Phrases that mark the atlas's topics; extended in data/watch.json.
DEFAULT_KEYWORDS = [
    "oblivious robots", "oblivious mobile robots", "anonymous agents", "anonymous mobile agents", "port-labeled", "port-labelled",
    "luminous robots", "robots with lights", "look-compute-move", "dispersion", "graph exploration",
    "collaborative exploration", "collective exploration", "treasure hunt", "rendezvous", "gathering",
    "black hole search", "network decontamination", "map construction", "pattern formation", "circle formation",
    "mutual visibility", "convergence of robots", "near-gathering", "scattering", "flocking", "uniform deployment",
    "leader election", "programmable matter", "amoebot", "shape formation", "coating", "compression",
    "linear search", "cow path", "group search", "evacuation", "patrolling", "fence patrolling",
    "pebble", "finite automaton", "recolourable", "recolorable", "rotor-router", "whiteboard",
    "temporal graph exploration", "byzantine agents", "robots in the plane", "swarm of robots", "silent robots",
]
DEFAULT_EXCLUDE = ["large language model", "llm", "gui agent", "smartphone", "lidar", "slam", "trajectory planning",
                   "path planning", "reinforcement learning", "authentication", "superplasticizer", "drug", "particle size"]
OPENALEX_QUERIES = [
    "dispersion mobile agents graph", "graph exploration mobile agent", "collaborative tree exploration", "oblivious mobile robots",
    "luminous robots", "robots with lights", "amoebot", "programmable matter distributed", "black hole search", "rendezvous mobile agents",
    "gathering mobile robots", "gathering mobile agents graph", "arbitrary pattern formation robots", "mutual visibility robots",
    "evacuation robots disk", "linear search competitive ratio", "treasure hunt mobile agent", "network decontamination agents",
    "fence patrolling robots", "rotor-router exploration", "recolorable graph exploration", "leader election mobile agents",
]


def get(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            if i == tries - 1:
                print(f"warning: {url[:90]}: {e}", file=sys.stderr)
                return b""
            time.sleep(5 * (i + 1))


def norm(t):
    return re.sub(r"[^a-z0-9]", "", (t or "").lower())


def build_watch():
    refs = json.loads((DATA / "references.json").read_text())
    count = Counter(a.strip() for r in refs.values() for a in r.get("authors", []))
    authors = [{"name": a, "papers": c} for a, c in count.most_common() if c >= 2]
    old = json.loads(WATCH.read_text()) if WATCH.exists() else {}
    w = {
        "about": "Watch list for scripts/discover.py. Authors are generated from references.json (cited at least twice); add people under extra_authors and phrases under keywords.",
        "categories": old.get("categories", CATS),
        "keywords": old.get("keywords", DEFAULT_KEYWORDS),
        "theory": old.get("theory", THEORY),
        "exclude": old.get("exclude", DEFAULT_EXCLUDE),
        "openalex_queries": old.get("openalex_queries", OPENALEX_QUERIES),
        "authors": authors,
        "extra_authors": old.get("extra_authors", []),
        "homepages": old.get("homepages", {}),
        "min_score": old.get("min_score", 8),
        "openalex_author_ids": old.get("openalex_author_ids", {}),
        "s2_author_ids": old.get("s2_author_ids", {}),
        "last_author_sweep": old.get("last_author_sweep"),
        "last_run": old.get("last_run"),
        "seen": old.get("seen", []),
    }
    WATCH.write_text(json.dumps(w, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {WATCH.relative_to(ROOT)}: {len(authors)} authors, {len(w['keywords'])} keywords")
    return w


def known_ids():
    refs = json.loads((DATA / "references.json").read_text())
    dois = {(v.get("doi") or "").lower() for r in refs.values() for v in [r] + r.get("versions", []) if v.get("doi")}
    arx = {re.sub(r"v\d+$", "", r.get("arxiv") or "") for r in refs.values() if r.get("arxiv")}
    titles = {norm(r.get("title"))[:80] for r in refs.values()}
    return dois, arx, titles


def arxiv_query(q, start_day, max_results=200):
    url = "http://export.arxiv.org/api/query?" + urllib.parse.urlencode(
        {"search_query": q, "sortBy": "submittedDate", "sortOrder": "descending", "max_results": max_results})
    raw = get(url)
    time.sleep(3)  # arXiv asks for a 3 s pause between calls
    if not raw:
        return []
    ns = {"a": "http://www.w3.org/2005/Atom", "x": "http://arxiv.org/schemas/atom"}
    out = []
    for e in ET.fromstring(raw).findall("a:entry", ns):
        pub = e.findtext("a:published", "", ns)[:10]
        if pub < start_day:
            continue
        aid = e.findtext("a:id", "", ns).rsplit("/abs/", 1)[-1]
        out.append({
            "source": "arxiv", "id": "arxiv:" + re.sub(r"v\d+$", "", aid), "arxiv": re.sub(r"v\d+$", "", aid),
            "title": " ".join(e.findtext("a:title", "", ns).split()),
            "authors": [a.findtext("a:name", "", ns) for a in e.findall("a:author", ns)],
            "abstract": " ".join(e.findtext("a:summary", "", ns).split()),
            "date": pub, "url": f"https://arxiv.org/abs/{aid}",
            "pdf": f"https://arxiv.org/pdf/{aid}",
            "doi": (e.findtext("x:doi", "", ns) or "").lower() or None,
            "categories": [c.get("term") for c in e.findall("a:category", ns)],
        })
    return out


def openalex(keyword, start_day):
    url = "https://api.openalex.org/works?" + urllib.parse.urlencode({
        "search": keyword, "filter": f"from_publication_date:{start_day},primary_topic.field.id:fields/17", "per-page": 50,
        "select": "id,doi,title,publication_date,authorships,primary_location,abstract_inverted_index,best_oa_location"})
    raw = get(url)
    if not raw:
        return []
    out = []
    for w in json.loads(raw).get("results", []):
        inv = w.get("abstract_inverted_index") or {}
        words = sorted((p, t) for t, ps in inv.items() for p in ps)
        loc = w.get("primary_location") or {}
        src = (loc.get("source") or {}).get("display_name")
        oa = (w.get("best_oa_location") or {}).get("pdf_url")
        doi = (w.get("doi") or "").replace("https://doi.org/", "").lower() or None
        out.append({
            "source": "openalex", "id": "doi:" + doi if doi else w["id"], "doi": doi,
            "title": w.get("title") or "", "authors": [a["author"]["display_name"] for a in w.get("authorships", [])],
            "abstract": " ".join(t for _, t in words), "date": w.get("publication_date"), "venue": src,
            "url": "https://doi.org/" + doi if doi else w["id"], "pdf": oa,
        })
    return out


def crossref(keyword, start_day):
    """DOIs registered since start_day whose title (or abstract) contains every word of the keyword."""
    url = "https://api.crossref.org/works?" + urllib.parse.urlencode({
        "query.bibliographic": keyword, "rows": 100, "select": "DOI,title,author,issued,container-title,abstract,type",
        "filter": f"from-created-date:{start_day},type:journal-article,type:proceedings-article,type:book-chapter,type:posted-content"})
    raw = get(url)
    time.sleep(1)
    if not raw:
        return []
    words = [x for x in re.findall(r"[a-z0-9-]+", keyword.lower()) if x not in ("and", "of", "the", "by", "in", "a")]
    out = []
    for w in json.loads(raw).get("message", {}).get("items", []):
        title = re.sub(r"<[^>]+>", "", (w.get("title") or [""])[0])
        abstract = re.sub(r"<[^>]+>", " ", w.get("abstract") or "")
        if not all(x.rstrip("s") in (title + " " + abstract).lower() for x in words):
            continue
        doi = w["DOI"].lower()
        date = "-".join(f"{x:02d}" for x in ((w.get("issued") or {}).get("date-parts") or [[0]])[0] if x)
        out.append({"source": "crossref", "id": "doi:" + doi, "doi": doi, "title": title,
                    "authors": [" ".join(filter(None, [a.get("given"), a.get("family")])) for a in w.get("author", [])],
                    "abstract": " ".join(abstract.split()), "date": date, "venue": (w.get("container-title") or [""])[0],
                    "url": "https://doi.org/" + doi})
    return out


def datacite(keyword, start_day):
    """LIPIcs and other Dagstuhl papers registered since start_day with every word of the keyword in the title."""
    terms = " AND ".join(f"titles.title:{x}*" for x in re.findall(r"[a-z0-9]+", keyword.lower()) if x not in ("and", "of", "the", "by", "in", "a"))
    url = "https://api.datacite.org/dois?" + urllib.parse.urlencode(
        {"query": f"({terms}) AND publisher:*Dagstuhl* AND created:[{start_day} TO *]", "page[size]": 100})
    raw = get(url)
    time.sleep(1)
    if not raw:
        return []
    out = []
    for d in json.loads(raw).get("data", []):
        at = d["attributes"]
        doi = at["doi"].lower()
        if ".vol" in doi or doi.endswith(".0"):  # whole volumes and front matter
            continue
        out.append({"source": "datacite", "id": "doi:" + doi, "doi": doi, "title": (at.get("titles") or [{}])[0].get("title", ""),
                    "authors": [re.sub(r"^(.*?), (.*)$", r"\2 \1", c.get("name", "")) for c in at.get("creators", [])],
                    "abstract": " ".join(x.get("description", "") for x in at.get("descriptions", [])), "date": str(at.get("publicationYear")),
                    "venue": (at.get("container") or {}).get("title"), "url": "https://doi.org/" + doi})
    return out


def author_sweep(w, start_day):
    """Every work of the watched authors published since start_day: OpenAlex by author id (50 ids per call),
    Semantic Scholar for authors OpenAlex could not resolve."""
    out = []
    ids = sorted({i for v in w.get("openalex_author_ids", {}).values() for i in v})
    for i in range(0, len(ids), 50):
        raw = get("https://api.openalex.org/works?" + urllib.parse.urlencode({
            "filter": f"author.id:{'|'.join(ids[i:i + 50])},from_publication_date:{start_day}", "per-page": 200,
            "select": "id,doi,title,publication_date,authorships,primary_location,abstract_inverted_index"}))
        time.sleep(0.5)
        for x in json.loads(raw).get("results", []) if raw else []:
            inv = x.get("abstract_inverted_index") or {}
            doi = (x.get("doi") or "").replace("https://doi.org/", "").lower() or None
            out.append({"source": "openalex-author", "id": "doi:" + doi if doi else x["id"], "doi": doi, "title": x.get("title") or "",
                        "authors": [a["author"]["display_name"] for a in x.get("authorships", [])],
                        "abstract": " ".join(t for _, t in sorted((p, t) for t, ps in inv.items() for p in ps)),
                        "date": x.get("publication_date"), "venue": ((x.get("primary_location") or {}).get("source") or {}).get("display_name"),
                        "url": "https://doi.org/" + doi if doi else x["id"]})
    for name, sids in w.get("s2_author_ids", {}).items():
        for sid in sids:
            raw = get(f"https://api.semanticscholar.org/graph/v1/author/{sid}/papers?fields=title,publicationDate,year,venue,externalIds,authors,abstract&limit=100")
            time.sleep(1.5)
            for x in json.loads(raw).get("data", []) if raw else []:
                date = x.get("publicationDate") or str(x.get("year") or "")
                if date < start_day:
                    continue
                ex = x.get("externalIds") or {}
                doi = (ex.get("DOI") or "").lower() or None
                out.append({"source": "s2-author", "id": "doi:" + doi if doi else "s2:" + x["paperId"], "doi": doi,
                            "arxiv": ex.get("ArXiv"), "title": x.get("title") or "", "authors": [a.get("name") for a in x.get("authors", [])],
                            "abstract": x.get("abstract") or "", "date": date, "venue": x.get("venue"),
                            "url": "https://doi.org/" + doi if doi else f"https://www.semanticscholar.org/paper/{x['paperId']}"})
    return out


def inbox(start_day):
    """Titles and links from Google Scholar alert e-mails saved under updates/inbox/ (.eml, .txt, .html)."""
    out = []
    for f in sorted((ROOT / "updates" / "inbox").glob("*")):
        if f.suffix.lower() not in (".eml", ".txt", ".html", ".htm"):
            continue
        text = html.unescape(f.read_text(errors="replace"))
        for m in re.finditer(r'<a[^>]+href="([^"]+)"[^>]*class="gse_alrt_title"[^>]*>(.*?)</a>', text, re.S):
            title = re.sub(r"<[^>]+>", "", m.group(2)).strip()
            out.append({"source": "scholar-alert", "id": "title:" + norm(title)[:80], "title": title,
                        "authors": [], "abstract": "", "date": None, "url": m.group(1), "file": f.name})
    return out


THEORY = ["distributed", "deterministic", "randomized", "lower bound", "upper bound", "rounds", "epochs",
          "oblivious", "anonymous", "adversar", "competitive ratio", "port", "synchronous", "asynchronous",
          "impossib", "optimal", "algorithm", "colors", "colours", "memory", "byzantine", "crash"]


def score(c, w):
    """Relevant = a watched author, or a topic phrase together with a theory signal."""
    title, text = c["title"].lower(), (c["title"] + " " + c.get("abstract", "")).lower()
    kw = [k for k in w["keywords"] if k.lower() in text]
    th = [t for t in w.get("theory", THEORY) if t in text]
    watched = {a["name"].lower() for a in w["authors"]} | {a.lower() for a in w["extra_authors"]}
    au = [a for a in c.get("authors", []) if a.lower() in watched]
    c["matched_keywords"], c["matched_authors"], c["matched_theory"] = kw, au, th
    s = 3 * len(au) + 2 * len(kw) + 2 * sum(k.lower() in title for k in kw) + min(len(th), 4)
    title_only = c["source"] in ("crossref", "datacite") and not c.get("abstract")  # these rarely carry an abstract
    if not au and not (kw and (len(th) >= 2 or (title_only and any(k.lower() in title for k in kw)))):
        s = 0
    elif title_only and any(k.lower() in title for k in kw):
        s = max(s, w.get("min_score", 8))  # a topic phrase in a newly registered title is enough for triage
    for bad in w.get("exclude", []):
        if bad in text:
            s -= 5
    c["score"] = s
    return c


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=None)
    ap.add_argument("--init-watch", action="store_true")
    ap.add_argument("--no-openalex", action="store_true")
    ap.add_argument("--no-crossref", action="store_true", help="skip the Crossref and DataCite queries")
    ap.add_argument("--authors", action="store_true", help="sweep the watched authors' works now (otherwise every 28 days)")
    ap.add_argument("--record", metavar="CANDIDATES_JSON", help="mark these candidates as seen (after the agent has run)")
    a = ap.parse_args()
    if a.record:
        return record(a.record)
    w = build_watch() if a.init_watch or not WATCH.exists() else json.loads(WATCH.read_text())
    if a.init_watch:
        return
    today = dt.date.today()
    start = today - dt.timedelta(days=a.days) if a.days else (
        dt.date.fromisoformat(w["last_run"]) - dt.timedelta(days=1) if w.get("last_run") else today - dt.timedelta(days=8))
    start_day = start.isoformat()
    cats = " OR ".join(f"cat:{c}" for c in w["categories"])
    found = []
    for i in range(0, len(w["keywords"]), 8):  # keyword batches within the categories
        kws = " OR ".join(f'abs:"{k}"' for k in w["keywords"][i:i + 8])
        found += arxiv_query(f"({cats}) AND ({kws})", start_day)
    names = [x["name"] for x in w["authors"][:150]] + w["extra_authors"]
    for i in range(0, len(names), 10):  # watched authors, any category
        q = " OR ".join('au:"%s"' % n.split()[-1] for n in names[i:i + 10])  # by surname; filtered to full names below
        found += [c for c in arxiv_query(q, start_day, 100) if set(c["authors"]) & set(names)]
    if not a.no_openalex:
        for k in w.get("openalex_queries", OPENALEX_QUERIES):
            found += openalex(k, start_day)
            time.sleep(0.2)
    if not a.no_crossref:
        for k in w.get("openalex_queries", OPENALEX_QUERIES):
            found += crossref(k, start_day) + datacite(k, start_day)
    last_sweep = w.get("last_author_sweep")
    sweep = a.authors or not last_sweep or (today - dt.date.fromisoformat(last_sweep)).days >= 28
    if sweep:  # journals index late, so look back 90 days before the previous sweep
        since = (dt.date.fromisoformat(last_sweep) - dt.timedelta(days=90)).isoformat() if last_sweep else (today - dt.timedelta(days=120)).isoformat()
        found += author_sweep(w, min(since, start_day))
    found += inbox(start_day)
    dois, arx, titles = known_ids()
    seen = set(w.get("seen", []))
    out, keys = [], set()
    for c in found:
        k = norm(c["title"])[:80]
        if (c.get("doi") and c["doi"] in dois) or (c.get("arxiv") and c["arxiv"] in arx) or k in titles or c["id"] in seen or k in keys:
            continue
        keys.add(k)
        out.append(score(c, w))
    out = sorted((c for c in out if c["score"] >= w.get("min_score", 8)), key=lambda c: -c["score"])
    day = today.isoformat()
    d = ROOT / "updates" / day
    d.mkdir(parents=True, exist_ok=True)
    (d / "candidates.json").write_text(json.dumps({"since": start_day, "run": day, "author_sweep": sweep, "candidates": out}, indent=2, ensure_ascii=False) + "\n")
    lines = [f"# Candidates {day} (since {start_day})", "", f"{len(out)} candidates with score >= {w.get('min_score', 3)}.", ""]
    for c in out:
        lines.append(f"- **{c['title']}** ({c['score']}) — {', '.join(c['authors'][:6])}{' et al.' if len(c['authors']) > 6 else ''}; {c.get('venue') or c['source']} {c.get('date') or ''} <{c['url']}>"
                     + (f"\n  keywords: {', '.join(c['matched_keywords'])}" if c["matched_keywords"] else "")
                     + (f"; watched authors: {', '.join(c['matched_authors'])}" if c["matched_authors"] else ""))
    (d / "candidates.md").write_text("\n".join(lines) + "\n")
    print(f"{len(found)} found, {len(out)} new candidates -> {(d / 'candidates.md').relative_to(ROOT)}")


def record(path):
    """After a successful agent run: mark its candidates as seen and move last_run forward."""
    w = json.loads(WATCH.read_text())
    c = json.loads(Path(path).read_text())
    w["seen"] = sorted(set(w.get("seen", [])) | {x["id"] for x in c["candidates"]})
    w["last_run"] = c["run"]
    if c.get("author_sweep"):
        w["last_author_sweep"] = c["run"]
    WATCH.write_text(json.dumps(w, indent=2, ensure_ascii=False) + "\n")
    print(f"recorded {len(c['candidates'])} candidates as seen; last_run = {c['run']}")


if __name__ == "__main__":
    main()
