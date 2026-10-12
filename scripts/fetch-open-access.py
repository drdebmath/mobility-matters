"""Download legitimate open-access copies (arXiv preprints matched by title and first author;
repository/author PDFs listed by OpenAlex) of the papers in papers/missing-now.tsv into papers/.
Never bypasses paywalls or bot checks. Usage: python3 scripts/fetch-open-access.py"""
import json, re, sys, time, urllib.parse, urllib.request, difflib
import xml.etree.ElementTree as ET
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
UA = {"User-Agent": "Mozilla/5.0 (Macintosh) mobility-matters-atlas/1.0"}
norm = lambda t: re.sub(r"[^a-z0-9]", "", (t or "").lower())
refs = json.loads((ROOT / "data/references.json").read_text())
import os, glob
have = {os.path.basename(f).split(".")[0] for f in glob.glob(str(ROOT / "papers" / "*.pdf"))}
rows = [l.rstrip("\n").split("\t") for l in open(ROOT / "papers/missing-now.tsv")]
rows = [r for r in rows if r[0] not in have]  # skip papers already downloaded
def get(u, t=40):
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=t) as r: return r.read()
    except Exception: return None
def save_pdf(key, url, suffix):
    b = get(url, 90)
    if b and b[:4] == b"%PDF":
        p = ROOT / "papers" / f"{key}.{suffix}.pdf"; p.write_bytes(b); return p.name
    return None
log = []
for key, link, title in rows:
    r = refs[key]; got = None
    # 1. arXiv by id or by title
    aid = r.get("arxiv")
    if not aid:
        q = urllib.parse.urlencode({"search_query": 'ti:"%s"' % re.sub(r'[^A-Za-z0-9 ]', ' ', title)[:200], "max_results": 5})
        raw = get("http://export.arxiv.org/api/query?" + q); time.sleep(3)
        if raw:
            ns = {"a": "http://www.w3.org/2005/Atom"}
            last = norm(r["authors"][0].split()[-1])
            for e in ET.fromstring(raw).findall("a:entry", ns):
                t = " ".join(e.findtext("a:title", "", ns).split())
                auth = [norm(a.findtext("a:name", "", ns)) for a in e.findall("a:author", ns)]
                if difflib.SequenceMatcher(None, norm(t), norm(title)).ratio() > 0.85 and any(last in a for a in auth):
                    aid = re.sub(r"v\d+$", "", e.findtext("a:id", "", ns).rsplit("/abs/", 1)[-1]); break
    if aid:
        got = save_pdf(key, f"https://arxiv.org/pdf/{aid}", "arxiv"); time.sleep(3)
    # 2. OpenAlex open-access locations (repositories, author pages)
    if not got and r.get("doi"):
        raw = get("https://api.openalex.org/works/doi:" + urllib.parse.quote(r["doi"]))
        if raw:
            j = json.loads(raw)
            for loc in [j.get("best_oa_location") or {}] + (j.get("locations") or []):
                u = (loc or {}).get("pdf_url")
                if u and "doi.org" not in u:
                    got = save_pdf(key, u, "oa")
                    if got: break
    log.append((key, got or "-", aid or ""))
    print(key, got or "-", flush=True)
(ROOT / "build" / "oa-log.json").write_text(json.dumps(log, indent=1))
print("downloaded", sum(1 for _, g, _ in log if g != "-"), "of", len(log))
