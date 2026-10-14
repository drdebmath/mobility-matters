#!/usr/bin/env python3
"""Validate the catalogue data in data/. Standard library only.

Checks: JSON parses; every axis value has a level and every axis has exactly one
level-0 value ("nothing assumed"); variants assign known values to known axes, and
no two variants make exactly the same assumptions (the assumption tree is computed
from these sets); problem families list known problems; cited references exist;
roles, statuses and measures are valid. Exit code 1 on errors; warnings do not fail
the run.
"""
import json, re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
ROLES = {"introductory", "best", "other", "disputed"}
STATUSES = {"tight", "near", "gap", "unknown", "impossible"}
VSTATUS = {"verified", "draft"}

errors, warnings = [], []
err = lambda m: errors.append(m)
warn = lambda m: warnings.append(m)


def load(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        err(f"{path.relative_to(ROOT)}: cannot parse JSON: {e}")
        return None


def problem_prose(p):
    """The problem-level text a reader meets first: summary, statement, primer, figure caption and frame labels."""
    out = [p.get("summary", ""), p.get("statement", "")]
    pr = p.get("primer") or {}
    out.append(pr.get("intro", ""))
    for x in pr.get("ideas", []):
        out += [x.get(k, "") for k in ("title", "idea", "analysis", "why_it_matters")]
    fig = p.get("figure") or {}
    out.append(fig.get("caption", ""))
    out += [f.get("label", "") for f in fig.get("frames", [])]
    return "\n".join(o for o in out if o)


def variant_prose(p):
    """(variant id, its prose with math, citations and quotations removed). Bottleneck names are standard labels and stay out."""
    for v in p.get("variants", []):
        parts = [v.get(k, "") for k in ("title", "summary", "statement", "notes")] + list(v.get("open", []) or [])
        parts += [r.get("note", "") for r in v.get("results", [])] + [a for r in v.get("results", []) for a in (r.get("assumes") or [])]
        parts += [lb.get("note", "") for lb in v.get("lower_bounds", [])] + [c for lb in v.get("lower_bounds", []) for c in (lb.get("preconditions") or [])]
        parts += [o.get("note", "") for o in (v.get("optimality") or {}).values() if isinstance(o, dict)]
        t = "\n".join(x for x in parts if x)
        yield v.get("id"), re.sub(r"\$\$.+?\$\$|\$[^$\n]+?\$|\[[A-Z][A-Za-z]*\d{4}[A-Za-z0-9]*\]|\"[^\"\n]*\"", " ", t)


def check_glossary(p, rel):
    """glossary: [{term, definition, avoid[]}]. The terms are the problem's words; each is defined in the text at its
    first use (not shown as a list). Warn when a term never occurs or a word in 'avoid' is used for it."""
    g = p.get("glossary")
    if g is None:
        warn(f"{rel}: no glossary")
        return
    text = problem_prose(p)
    plain = re.sub(r"\$\$.+?\$\$|\$[^$\n]+?\$|\[[A-Z][A-Za-z]*\d{4}[A-Za-z0-9]*\]|\"[^\"\n]*\"", " ", text)
    terms = set()
    for e in g:
        t = e.get("term")
        if not t or not e.get("definition"):
            err(f"{rel}: glossary entry needs 'term' and 'definition'")
            continue
        if t.lower() in terms:
            err(f"{rel}: glossary lists '{t}' twice")
        terms.add(t.lower())
        if t.lower() not in text.lower():
            warn(f"{rel}: glossary term '{t}' is not used in the summary, statement, primer or figure")
        for w in e.get("avoid", []) or []:
            hits = re.findall(r"(?<![\w-])%s(?![\w-])" % re.escape(w), plain, flags=re.I)
            if hits:
                warn(f"{rel}: '{w}' is used {len(hits)}x; the glossary says '{t}'")
            for vid, vt in variant_prose(p):
                vh = re.findall(r"(?<![\w-])%s(?![\w-])" % re.escape(w), vt, flags=re.I)
                if vh:
                    warn(f"{rel}: variant '{vid}' uses '{w}' {len(vh)}x; the glossary says '{t}'")


def check_axis_values(ax, rel):
    """Return {value id: level}; levels are integers >= 0, exactly one value at level 0."""
    ids = {}
    for v in ax.get("values", []):
        lvl = v.get("level")
        if not isinstance(lvl, int) or lvl < 0:
            err(f"{rel}: axis '{ax['id']}' value '{v.get('id')}' needs an integer 'level' >= 0")
        if v.get("id") in ids:
            err(f"{rel}: axis '{ax['id']}' duplicate value '{v.get('id')}'")
        if not v.get("label"):
            err(f"{rel}: axis '{ax['id']}' value '{v.get('id')}' needs a 'label'")
        if not v.get("definition"):
            warn(f"{rel}: axis '{ax['id']}' value '{v.get('id')}' has no formal 'definition'")
        ids[v.get("id")] = lvl if isinstance(lvl, int) else 0
    if not ax.get("origin"):
        warn(f"{rel}: axis '{ax['id']}' has no 'origin' (where the assumption comes from and why it matters)")
    zeros = [k for k, l in ids.items() if l == 0]
    if len(zeros) != 1:
        err(f"{rel}: axis '{ax['id']}' must have exactly one level-0 value (nothing assumed); has {zeros}")
    return ids


def check_model(m, path):
    rel = path.relative_to(ROOT)
    for key in ("id", "name", "summary", "description", "axes"):
        if key not in m:
            err(f"{rel}: model missing '{key}'")
    axes = {}
    for ax in m.get("axes", []):
        if "id" not in ax or "values" not in ax:
            err(f"{rel}: axis without id/values: {ax}")
            continue
        if ax["id"] in axes:
            err(f"{rel}: duplicate axis '{ax['id']}'")
        ids = check_axis_values(ax, rel)
        axes[ax["id"]] = ids
    return axes


def check_problem(p, path, models, refs):
    rel = path.relative_to(ROOT)
    for key in ("id", "model", "name", "summary", "statement", "measures", "variants"):
        if key not in p:
            err(f"{rel}: problem missing '{key}'")
    if p.get("model") not in models:
        err(f"{rel}: unknown model '{p.get('model')}'")
        return
    axes = dict(models[p["model"]])
    for ax in p.get("axes", []):
        axes[ax["id"]] = check_axis_values(ax, rel)
        for k in set(re.findall(r"\[([A-Z][A-Za-z]*\d{4}[A-Za-z0-9]*)\]", ax.get("origin", ""))):
            if k not in refs:
                err(f"{rel}: origin of axis '{ax['id']}' cites unknown reference '{k}'")
    for a in p.get("ignore_axes", []):
        if a not in axes:
            err(f"{rel}: ignore_axes names unknown axis '{a}'")
        axes.pop(a, None)
    for a in p.get("axis_order", []):
        if a not in axes:
            err(f"{rel}: axis_order names unknown axis '{a}'")
    measures = {m["id"] for m in p.get("measures", [])}
    variants = {v["id"]: v for v in p.get("variants", []) if "id" in v}
    if len(variants) != len(p.get("variants", [])):
        err(f"{rel}: variants without id or with duplicate ids")
    for vid in variants:
        if vid in ("map", "graph", "root") or vid.startswith("at_"):
            err(f"{rel}: variant id '{vid}' is reserved for a page of the site")
    if sum(1 for v in variants.values() if v.get("standard")) > 1:
        err(f"{rel}: at most one variant may be marked 'standard'")
    seen_sets = {}
    for vid, v in variants.items():
        where = f"{rel}: variant '{vid}'"
        for old in ("parent", "delta"):
            if old in v:
                err(f"{where}: '{old}' is obsolete; the tree is computed from 'assumptions'")
        asm = v.get("assumptions")
        if not isinstance(asm, dict):
            err(f"{where}: needs an 'assumptions' object (axis -> value; omitted axes assume nothing)")
            continue
        for a, val in asm.items():
            if a not in axes:
                err(f"{where}: assumes unknown axis '{a}'")
            elif val not in axes[a]:
                err(f"{where}: unknown value '{val}' for axis '{a}'")
        atoms = tuple(sorted((a, x) for a, x in asm.items() if axes.get(a, {}).get(x, 0) > 0))
        if atoms in seen_sets:
            err(f"{where}: makes exactly the same assumptions as '{seen_sets[atoms]}'; merge them or move the difference into a result's 'assumes'")
        seen_sets[atoms] = vid
    for vid, v in variants.items():
        where = f"{rel}: variant '{vid}'"
        if v.get("status", "draft") not in VSTATUS:
            err(f"{where}: status must be one of {sorted(VSTATUS)}")
        if not v.get("title") or not v.get("summary"):
            err(f"{where}: needs 'title' and 'summary'")
        for r in v.get("results", []):
            if r.get("ref") not in refs:
                err(f"{where}: result cites unknown reference '{r.get('ref')}'")
            if r.get("role") not in ROLES:
                err(f"{where}: result role {r.get('role')!r} not in {sorted(ROLES)}")
            if not any(r.get(m) for m in measures):
                err(f"{where}: result for {r.get('ref')} has no bound for any measure {sorted(measures)}")
        for lb in v.get("lower_bounds", []):
            if lb.get("measure") not in measures:
                err(f"{where}: lower bound on unknown measure '{lb.get('measure')}'")
            if lb.get("ref") and lb["ref"] not in refs:
                err(f"{where}: lower bound cites unknown reference '{lb.get('ref')}'")
            if not lb.get("bound"):
                err(f"{where}: lower bound without 'bound'")
            if not lb.get("bottleneck"):
                warn(f"{where}: lower bound on '{lb.get('measure')}' has no 'bottleneck'")
            if not lb.get("preconditions"):
                warn(f"{where}: lower bound on '{lb.get('measure')}' has no 'preconditions'")
        for m, o in (v.get("optimality") or {}).items():
            if m not in measures:
                err(f"{where}: optimality on unknown measure '{m}'")
            if o.get("status") not in STATUSES:
                err(f"{where}: optimality status for '{m}' must be one of {sorted(STATUSES)}")
        for m in measures:
            if m not in (v.get("optimality") or {}):
                warn(f"{where}: no optimality status for measure '{m}' (shown as unknown)")
        bests = [r for r in v.get("results", []) if r.get("role") == "best"]
        if len(bests) > 1:
            dominated = {}
            for r in bests:
                for m in measures:
                    if r.get(m):
                        dominated.setdefault(m, []).append(r["ref"])
            for m, who in dominated.items():
                if len(who) > 1:
                    warn(f"{where}: several 'best' results give a bound for '{m}': {who}; keep one per trade-off and explain in notes")
        impossible = any("impossible" in str(lb.get("bound", "")) for lb in v.get("lower_bounds", []))
        if not v.get("results") and not v.get("open") and not impossible:
            warn(f"{where}: no results and no open questions")


def main():
    index = load(DATA / "index.json")
    refs = load(DATA / "references.json") or {}
    if index is None:
        return finish()
    for k, r in refs.items():
        for key in ("authors", "title", "venue", "year"):
            if key not in r:
                err(f"references.json: '{k}' missing '{key}'")
        if not (r.get("doi") or r.get("arxiv") or r.get("url")):
            warn(f"references.json: '{k}' has no doi/arxiv/url")
    models = {}
    model_cites = set()
    for mid in index.get("models", []):
        path = DATA / "models" / f"{mid}.json"
        if not path.exists():
            err(f"index.json lists model '{mid}' but {path.relative_to(ROOT)} does not exist")
            continue
        m = load(path)
        if m is None:
            continue
        if m.get("id") != mid:
            err(f"{path.relative_to(ROOT)}: id '{m.get('id')}' does not match file name")
        models[mid] = check_model(m, path)
        mblob = json.dumps(m)
        for k in refs:
            if f"[{k}]" in mblob:
                model_cites.add(k)
        for sct in m.get("story", []):
            if not sct.get("heading") or not sct.get("body"):
                err(f"{path.relative_to(ROOT)}: every story section needs 'heading' and 'body'")
        prose = json.dumps([m.get("story", []), [a.get("origin", "") for a in m.get("axes", [])]])
        for k in set(re.findall(r"\[([A-Z][A-Za-z]*\d{4}[A-Za-z0-9]*)\]", prose)):
            if k not in refs:
                err(f"{path.relative_to(ROOT)}: story or axis origin cites unknown reference '{k}'")
    fam_of = {}
    for f in index.get("families", []):
        for key in ("id", "name", "problems"):
            if key not in f:
                err(f"index.json: family missing '{key}': {f.get('id')}")
        for pid in f.get("problems", []):
            if pid not in index.get("problems", []):
                err(f"index.json: family '{f.get('id')}' lists unknown problem '{pid}'")
            if pid in fam_of:
                err(f"index.json: problem '{pid}' is in two families ('{fam_of[pid]}', '{f.get('id')}')")
            fam_of[pid] = f.get("id")
    for f in index.get("families", []):
        for r in f.get("related", []):
            if r.get("problem") not in index.get("problems", []) or not r.get("relation"):
                err(f"index.json: family '{f.get('id')}' related entry needs a known 'problem' and a 'relation'")
    for pid in index.get("problems", []):
        if index.get("families") and pid not in fam_of:
            warn(f"index.json: problem '{pid}' belongs to no family")
    used = set(model_cites)
    derived = {}
    for pid in index.get("problems", []):
        path = DATA / "problems" / f"{pid}.json"
        if not path.exists():
            err(f"index.json lists problem '{pid}' but {path.relative_to(ROOT)} does not exist")
            continue
        p = load(path)
        if p is None:
            continue
        if p.get("id") != pid:
            err(f"{path.relative_to(ROOT)}: id '{p.get('id')}' does not match file name")
        check_problem(p, path, models, refs)
        o = p.get("origin")
        if o is not None and (not isinstance(o, dict) or o.get("ref") not in refs or not isinstance(o.get("year"), int)):
            err(f"{path.relative_to(ROOT)}: origin needs a known 'ref' and an integer 'year'")
        if o and o.get("ref") in refs:
            used.add(o["ref"])
        if p.get("derived_from") is not None:
            dfm = p["derived_from"]
            if not isinstance(dfm, dict) or not dfm.get("problem") or not dfm.get("relation"):
                err(f"{path.relative_to(ROOT)}: derived_from needs 'problem' and 'relation'")
            else:
                derived[pid] = dfm["problem"]
        fig = p.get("figure")
        if fig is not None:
            rel = path.relative_to(ROOT)
            if not fig.get("caption"):
                err(f"{rel}: figure needs a caption")
            frames = fig.get("frames") or []
            if len(frames) < 2:
                err(f"{rel}: figure needs at least two frames (initial and final configuration)")
            nodes = (fig.get("graph") or {}).get("nodes", {})
            for i, fr in enumerate(frames):
                ids = [e.get("id") for e in fr.get("ents", [])]
                if len(ids) != len(set(ids)):
                    err(f"{rel}: figure frame {i} repeats an entity id")
                for e in fr.get("ents", []):
                    if e.get("at") and e["at"] not in nodes:
                        err(f"{rel}: figure frame {i} places '{e.get('id')}' at unknown node '{e['at']}'")
            for k in re.findall(r"\[([A-Z][A-Za-z]+\d{4}[A-Za-z0-9]*)\]", fig.get("caption", "")):
                if k not in refs:
                    err(f"{rel}: figure caption cites unknown reference '{k}'")
        for f in p.get("further", []) or []:
            if f.get("ref") not in refs:
                err(f"{path.relative_to(ROOT)}: further reading cites unknown reference '{f.get('ref')}'")
            used.add(f.get("ref"))
        pr = p.get("primer")
        if pr is not None:
            if not pr.get("intro") or not pr.get("ideas"):
                err(f"{path.relative_to(ROOT)}: primer needs 'intro' and 'ideas'")
            vids = {v.get("id") for v in p.get("variants", [])}
            for x in pr.get("ideas", []):
                if x.get("kind") not in ("algorithm", "impossibility", "lower-bound"):
                    err(f"{path.relative_to(ROOT)}: primer idea '{x.get('title')}' has unknown kind '{x.get('kind')}'")
                if x.get("variant") and x["variant"] not in vids:
                    err(f"{path.relative_to(ROOT)}: primer idea '{x.get('title')}' names unknown variant '{x['variant']}'")
                if x.get("ref") and x["ref"] not in refs:
                    err(f"{path.relative_to(ROOT)}: primer idea '{x.get('title')}' cites unknown reference '{x['ref']}'")
                for key in ("title", "idea", "analysis"):
                    if not x.get(key):
                        err(f"{path.relative_to(ROOT)}: primer idea needs '{key}'")
                if x.get("ref"):
                    used.add(x["ref"])
            for k in set(re.findall(r"\[([A-Z][A-Za-z]*\d{4}[A-Za-z0-9]*)\]", json.dumps(pr))):
                if k not in refs:
                    err(f"{path.relative_to(ROOT)}: primer cites unknown reference '{k}'")
                used.add(k)
        check_glossary(p, path.relative_to(ROOT))
        pblob = json.dumps({k: p.get(k) for k in ("history", "statement", "origin", "derived_from", "related", "figure", "further", "axes")})
        for k in refs:
            if f"[{k}]" in pblob:
                used.add(k)
        for v in p.get("variants", []):
            for r in v.get("results", []):
                used.add(r.get("ref"))
            for lb in v.get("lower_bounds", []):
                used.add(lb.get("ref"))
            blob = json.dumps(v)
            for k in refs:
                if f"[{k}]" in blob:
                    used.add(k)
    for pid in index.get("problems", []):
        pth = DATA / "problems" / f"{pid}.json"
        if pth.exists():
            for r in (load(pth) or {}).get("related", []):
                if r.get("problem") not in index.get("problems", []) or not r.get("relation"):
                    err(f"problem '{pid}': related entry needs a known 'problem' and a 'relation'")
    for pid, parent in derived.items():
        if parent not in index.get("problems", []):
            err(f"problem '{pid}': derived_from names unknown problem '{parent}'")
        seen, cur = set(), pid
        while cur in derived:
            if cur in seen:
                err(f"problem '{pid}': derived_from forms a cycle")
                break
            seen.add(cur)
            cur = derived[cur]
    pri = index.get("priorities")
    if pri:
        for i, it in enumerate(pri.get("items", [])):
            for pid in it.get("problems", []):
                if pid not in index.get("problems", []):
                    err(f"index.json: priority {i + 1} names unknown problem '{pid}'")
            for pid, vid in it.get("settings", []):
                pf = DATA / "problems" / f"{pid}.json"
                if not pf.exists() or vid not in [v["id"] for v in json.load(open(pf)).get("variants", [])]:
                    err(f"index.json: priority {i + 1} names unknown setting '{pid}/{vid}'")
            for k in re.findall(r"\[([A-Z][A-Za-z]+\d{4}[A-Za-z0-9]*)\]", it.get("question", "") + it.get("why", "")):
                if k not in refs:
                    err(f"index.json: priority {i + 1} cites unknown reference '{k}'")
                used.add(k)
    apath = DATA / "acknowledgements.json"
    if apath.exists():
        ak = load(apath) or {}
        for x in ak.get("people", []):
            if not (x.get("name") or x.get("github")) or not x.get("contribution"):
                err(f"acknowledgements.json: every person needs a name or github handle and a contribution: {x}")
            if x.get("issue") is not None and not str(x["issue"]).isdigit():
                err(f"acknowledgements.json: issue must be a number: {x}")
    npath = DATA / "notation.json"
    if npath.exists():
        nt = load(npath) or {}
        pm = {}
        for pid in index.get("problems", []):
            pp = DATA / "problems" / f"{pid}.json"
            if pp.exists():
                pm[pid] = (load(pp) or {}).get("model")
        for mid, rows in nt.get("models", {}).items():
            if mid not in index.get("models", []):
                err(f"notation.json: unknown model '{mid}'")
            seen = set()
            for r in rows:
                if not r.get("symbol") or not r.get("meaning"):
                    err(f"notation.json: {mid}: every symbol needs 'symbol' and 'meaning'")
                if r.get("symbol") in seen:
                    err(f"notation.json: {mid}: symbol {r.get('symbol')} listed twice (one meaning per symbol and model)")
                seen.add(r.get("symbol"))
                for pid in r.get("where", []):
                    if pm.get(pid) != mid:
                        err(f"notation.json: {mid}: symbol {r.get('symbol')} names problem '{pid}' outside this model")
        for k in set(re.findall(r"\[([A-Z][A-Za-z]*\d{4}[A-Za-z0-9]*)\]", json.dumps(nt))):
            if k not in refs:
                err(f"notation.json: cites unknown reference '{k}'")
            used.add(k)
    else:
        warn("data/notation.json is missing")
    for oid in index.get("overviews", []):
        path = DATA / "overviews" / f"{oid}.json"
        if not path.exists():
            err(f"index.json lists overview '{oid}' but {path.relative_to(ROOT)} does not exist")
            continue
        o = load(path)
        if o is None:
            continue
        rel = path.relative_to(ROOT)
        for key in ("id", "title", "summary", "sections"):
            if key not in o:
                err(f"{rel}: overview missing '{key}'")
        if o.get("id") != oid:
            err(f"{rel}: id does not match file name")
        for pid in o.get("problems", []):
            if pid not in index.get("problems", []):
                err(f"{rel}: refers to unknown problem '{pid}'")
        for sct in o.get("sections", []):
            if not sct.get("heading") or not sct.get("body"):
                err(f"{rel}: every section needs 'heading' and 'body'")
        import re as _re
        blob = json.dumps(o)
        for key in set(_re.findall(r"\[([A-Z][A-Za-z]*\d{4}[A-Za-z0-9]*)\]", blob)):
            if key in refs:
                used.add(key)
            else:
                warn(f"{rel}: citation [{key}] is not in references.json")
    for k in refs:
        if k not in used:
            warn(f"references.json: '{k}' is never cited")
    import subprocess
    rf = subprocess.run([sys.executable, str(ROOT / "scripts" / "check-figures.py")], capture_output=True, text=True)
    for line in rf.stdout.splitlines():
        if "figure error" not in line and line.strip():
            err(f"figure: {line}")
    r = subprocess.run([sys.executable, str(ROOT / "scripts" / "sync-meta.py"), "--check"], capture_output=True, text=True)
    if r.returncode:
        warn(r.stdout.strip())
    return finish()


def finish():
    for w in warnings:
        print(f"warning: {w}")
    for e in errors:
        print(f"error: {e}")
    print(f"{len(errors)} error(s), {len(warnings)} warning(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
