#!/usr/bin/env python3
"""Check every reference against public metadata (stdlib only, network).

For each entry of data/references.json:
  * a DOI must resolve in Crossref (or DataCite for LIPIcs/arXiv DOIs), and its title
    must match ours (case, punctuation and LaTeX ignored; a close match is reported);
  * an arXiv id must exist (arXiv API);
  * no two entries may share a DOI, an arXiv id or a title.
Writes build/refcheck.json and prints a summary. Usage: python3 scripts/check-refs.py [Key ...]
"""
import difflib, json, re, sys, time, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = {"User-Agent": "mobility-matters-atlas/1.0 (reference check; mailto via site)"}
norm = lambda t: re.sub(r"[^a-z0-9]", "", re.sub(r"\$[^$]*\$|\\[a-zA-Z]+", "", (t or "").lower()))


def get(url):
    for i in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(3 * (i + 1))
        except Exception:  # noqa: BLE001
            time.sleep(3 * (i + 1))
    return b"__error__"


def doi_title(doi):
    raw = get("https://api.crossref.org/works/" + urllib.parse.quote(doi))
    if raw and raw != b"__error__":
        m = json.loads(raw)["message"]
        t = (m.get("title") or [""])[0]
        sub = (m.get("subtitle") or [""])[0]
        t = re.sub(r"<[^>]+>", "", t + (": " + sub if sub else "")).replace("&amp;", "&")
        return t, "crossref"
    raw = get("https://api.datacite.org/dois/" + urllib.parse.quote(doi))
    if raw and raw != b"__error__":
        ts = json.loads(raw)["data"]["attributes"].get("titles") or [{}]
        return ts[0].get("title", ""), "datacite"
    return (None, "error") if raw == b"__error__" else (None, "missing")


def arxiv_titles(ids):
    out = {}
    for i in range(0, len(ids), 50):
        raw = get("http://export.arxiv.org/api/query?" + urllib.parse.urlencode({"id_list": ",".join(ids[i:i + 50]), "max_results": 50}))
        time.sleep(3)
        if not raw or raw == b"__error__":
            continue
        ns = {"a": "http://www.w3.org/2005/Atom"}
        for e in ET.fromstring(raw).findall("a:entry", ns):
            aid = re.sub(r"v\d+$", "", e.findtext("a:id", "", ns).rsplit("/abs/", 1)[-1])
            t = " ".join(e.findtext("a:title", "", ns).split())
            if t and t != "Error":
                out[aid] = t
    return out


def main():
    refs = json.loads((ROOT / "data/references.json").read_text())
    keys = sys.argv[1:] or list(refs)
    issues, notes = defaultdict(list), defaultdict(list)
    for field, f in (("doi", lambda r: (r.get("doi") or "").lower()), ("arxiv", lambda r: re.sub(r"v\d+$", "", r.get("arxiv") or "")), ("title", lambda r: norm(r.get("title")))):
        seen = defaultdict(list)
        for k, r in refs.items():
            if f(r):
                seen[f(r)].append(k)
        for v, ks in seen.items():
            if len(ks) > 1:
                for k in ks:
                    issues[k].append(f"duplicate {field} with {', '.join(x for x in ks if x != k)}")
    for n, k in enumerate(keys, 1):
        r = refs[k]
        if r.get("doi"):
            t, src = doi_title(r["doi"])
            if t is None:
                issues[k].append(f"DOI {r['doi']} not found ({src})")
            else:
                a, b = norm(t), norm(r["title"])
                if a != b:
                    ratio = difflib.SequenceMatcher(None, a, b).ratio()
                    if not (a in b or b in a) or ratio < 0.9:
                        issues[k].append(f"title differs from {src} ({ratio:.2f}): {t!r}")
            time.sleep(0.15)
        if n % 50 == 0:
            print(f"... {n}/{len(keys)}", file=sys.stderr)
    ax = {k: re.sub(r"v\d+$", "", refs[k]["arxiv"]) for k in keys if refs[k].get("arxiv")}
    found = arxiv_titles(sorted(set(ax.values())))
    for k, aid in ax.items():
        if aid not in found:
            issues[k].append(f"arXiv {aid} not found")
        elif norm(found[aid]) != norm(refs[k]["title"]) and difflib.SequenceMatcher(None, norm(found[aid]), norm(refs[k]["title"])).ratio() < 0.8:
            notes[k].append(f"arXiv preprint title: {found[aid]!r}")  # often renamed on publication; check the authors match
    (ROOT / "build").mkdir(exist_ok=True)
    for k, r in refs.items():  # duplicates the bibliography explains (e.g. one arXiv preprint for two papers)
        if r.get("refcheck_ok"):
            issues[k] = [x for x in issues.get(k, []) if not any(w in x for w in r["refcheck_ok"])]
            if not issues[k]:
                issues.pop(k)
    (ROOT / "build/refcheck.json").write_text(json.dumps({"issues": issues, "notes": notes}, indent=2, ensure_ascii=False) + "\n")
    print(f"{len(keys)} references checked; {len(issues)} with issues, {len(notes)} with notes (build/refcheck.json)")
    for k, v in sorted(issues.items()):
        for x in v:
            print(f"  {k}: {x}")
    for k, v in sorted(notes.items()):
        for x in v:
            print(f"  note {k}: {x}")


if __name__ == "__main__":
    main()
