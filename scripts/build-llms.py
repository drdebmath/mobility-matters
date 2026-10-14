#!/usr/bin/env python3
"""Write llms.txt and llms-full.txt (https://llmstxt.org) for language models and other readers
that want the atlas as plain text.

* llms.txt: a short Markdown index: what the atlas is, how to cite it, and one link per model,
  perspective and problem (to the prerendered pages written by scripts/prerender.js).
* llms-full.txt: the whole atlas as Markdown: every problem with its statement and measures, every
  setting with its assumptions, lower bounds (with what forces them), results, optimality and open
  questions, the perspectives, and the bibliography. Citations stay as [Key] and resolve in the
  bibliography at the end; math stays as LaTeX between $ $.

    python3 scripts/build-llms.py [OUTDIR]     # default: build/site (the deploy builds them there)
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"


def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def one_line(s):
    return re.sub(r"\s+", " ", s or "").strip()


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "build" / "site"
    out.mkdir(parents=True, exist_ok=True)
    idx = load(DATA / "index.json")
    c = idx["citation"]
    site = c["url"].rstrip("/") + "/"
    models = {m: load(DATA / "models" / f"{m}.json") for m in idx["models"]}
    probs = {p: load(DATA / "problems" / f"{p}.json") for p in idx["problems"]}
    ovs = {o: load(DATA / "overviews" / f"{o}.json") for o in idx.get("overviews", [])}
    refs = load(DATA / "references.json")
    cite = f'{", ".join(c["authors"])}. {c["title"]}. Living survey, version {c.get("version", "")}. {c["url"]}'

    head = [f"# {c['title']}", "", f"> {one_line(idx.get('abstract') or idx.get('intro'))}", "",
            f"Last updated {c.get('version', '')}. Cite as: {cite}", "",
            f"Licence: {idx.get('license', '')}. Math is LaTeX between $ $; [Key] is a citation "
            f"(keys resolve in the bibliography of {site}llms-full.txt and on {site}references/).", ""]

    # ---- llms.txt
    s = head + ["## Start here", "",
                f"- [Home]({site}): the models, problem families and how close the bounds are",
                f"- [Full text]({site}llms-full.txt): every problem, setting, bound and open question as Markdown",
                f"- [PDF]({site}{c.get('pdf', 'mobility-matters.pdf')}): the same atlas as a book",
                f"- [Open questions]({site}open/): all open questions, with the maintainer's ranking",
                f"- [Notation]({site}notation/): the symbols of each model and every assumption with its definition",
                f"- [References]({site}references/): the bibliography", ""]
    s += ["## Models", ""] + [f"- [{m['name']}]({site}model/{mid}/): {one_line(m.get('summary'))}" for mid, m in models.items()] + [""]
    s += ["## Perspectives", ""] + [f"- [{o['title']}]({site}overview/{oid}/): {one_line(o.get('summary'))}" for oid, o in ovs.items()] + [""]
    for mid, m in models.items():
        s += [f"## Problems: {m['name']}", ""]
        for f in idx.get("families", []):
            for pid in f["problems"]:
                p = probs.get(pid)
                if p and p["model"] == mid:
                    s.append(f"- [{p['name']}]({site}problem/{pid}/): {one_line(p.get('summary'))} ({len(p['variants'])} settings; family: {f['name']})")
        s.append("")
    (out / "llms.txt").write_text("\n".join(s), encoding="utf-8")

    # ---- llms-full.txt
    def axes_of(p):
        ax = {a["id"]: a for a in models[p["model"]].get("axes", [])}
        ax.update({a["id"]: a for a in p.get("axes", [])})
        return ax

    def value(ax, aid, vid):
        a = ax.get(aid)
        v = next((x for x in (a or {}).get("values", []) if x["id"] == vid), None)
        return f"{a['name'] if a else aid}: {v['label'] if v else vid}"

    f = head
    for mid, m in models.items():
        f += [f"# Model: {m['name']}", "", f"URL: {site}model/{mid}/", "", one_line(m.get("summary")), ""]
        for a in m.get("axes", []):
            f.append(f"- Axis {a['name']}: " + "; ".join(f"level {v['level']}: {v['label']}" for v in a.get("values", [])))
        f.append("")
        for pid, p in probs.items():
            if p["model"] != mid:
                continue
            ax = axes_of(p)
            f += [f"## Problem: {p['name']}", "", f"URL: {site}problem/{pid}/ (progress map: {site}problem/{pid}/map/)", "",
                  one_line(p.get("summary")), "", "### Statement", "", (p.get("statement") or "").strip(), ""]
            if p.get("measures"):
                f += ["Measures: " + "; ".join(f"{x['name']} ({one_line(x.get('description'))})" for x in p["measures"]), ""]
            if p.get("origin"):
                f += [f"Posed by [{p['origin']['ref']}] ({p['origin'].get('year', '')}). {one_line(p['origin'].get('note'))}", ""]
            if p.get("history"):
                f += ["### History", "", p["history"].strip() if isinstance(p["history"], str) else one_line(json.dumps(p["history"], ensure_ascii=False)), ""]
            for p_ax in p.get("axes", []):
                f.append(f"- Problem-specific axis {p_ax['name']}: " + "; ".join(f"level {v['level']}: {v['label']}" for v in p_ax.get("values", [])))
            for v in p["variants"]:
                f += [f"### Setting: {p['name']}, {v['title']}" + (" (standard setting)" if v.get("standard") else ""), "",
                      f"URL: {site}problem/{pid}/{v['id']}/ · status: {v.get('status', 'draft')}", ""]
                asm = v.get("assumptions", {})
                f += ["Assumptions: " + ("; ".join(value(ax, k, x) for k, x in asm.items()) or "none (the most general setting)"), ""]
                if v.get("summary"):
                    f += [one_line(v["summary"]), ""]
                if v.get("statement"):
                    f += [v["statement"].strip(), ""]
                for lb in v.get("lower_bounds", []):
                    pre = "; ".join(lb.get("preconditions", []))
                    f.append(f"- Lower bound ({lb['measure']}): ${lb['bound']}$ [{lb['ref']}]" + (f", forced by {lb['bottleneck']}" if lb.get("bottleneck") else "")
                             + (f"; needs: {pre}" if pre else "") + (f". {one_line(lb['note'])}" if lb.get("note") else ""))
                for r in v.get("results", []):
                    ms = ", ".join(f"{x['name'].lower()} ${r[x['id']]}$" for x in p.get("measures", []) if r.get(x["id"]))
                    f.append(f"- Result ({r.get('role', 'other')}): [{r['ref']}]" + (f": {ms}" if ms else "") + (f"; assumes {'; '.join(r['assumes'])}" if r.get("assumes") else "")
                             + (f". {one_line(r['note'])}" if r.get("note") else ""))
                for mk, o in (v.get("optimality") or {}).items():
                    f.append(f"- Optimality ({mk}): {o.get('status', '')}" + (f". {one_line(o.get('note'))}" if o.get("note") else ""))
                for q in v.get("open", []):
                    f.append(f"- Open: {one_line(q)}")
                if v.get("notes"):
                    f += ["", "Notes: " + one_line(v["notes"])]
                f.append("")
            for x in p.get("further", []):
                f.append(f"- Further reading: [{x['ref']}]: {one_line(x.get('note'))}")
            f.append("")
    f += ["# Perspectives", ""]
    for oid, o in ovs.items():
        f += [f"## {o['title']}", "", f"URL: {site}overview/{oid}/", ""]
        for sec in o.get("sections", []):
            f += [f"### {sec['heading']}", "", sec["body"].strip(), ""]
    f += ["# Bibliography", ""]
    for k in sorted(refs):
        r = refs[k]
        link = f" https://doi.org/{r['doi']}" if r.get("doi") else (f" https://arxiv.org/abs/{r['arxiv']}" if r.get("arxiv") else (f" {r['url']}" if r.get("url") else ""))
        f.append(f"- [{k}] {', '.join(r.get('authors', []))}. {r.get('title', '')}. {r.get('venue', '')}, {r.get('year', '')}.{link}")
    (out / "llms-full.txt").write_text("\n".join(f) + "\n", encoding="utf-8")
    print(f"wrote {out / 'llms.txt'} and {out / 'llms-full.txt'} ({(out / 'llms-full.txt').stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
