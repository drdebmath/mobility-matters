#!/usr/bin/env python3
"""Build the atlas as a book-style PDF from the same data as the website.

    python3 scripts/build-pdf.py            # writes mobility-matters.pdf at the repository root
    python3 scripts/build-pdf.py --tex-only # writes build/atlas.tex only

The PDF states exactly what the website states, organised as a book:
front matter (title, how to cite, contents), a reading guide, the overviews,
one part per model (its assumption axes with formal definitions), one chapter per
problem family, one section per problem (statement, history, relations, the
assumption tree, every catalogued variant with its bounds, results, open
questions and notes), then appendices (all open questions, the timeline) and the
bibliography. Requires LuaLaTeX (TeX Live) with the Libertinus fonts; the
standard library only on the Python side.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
BUILD = ROOT / "build"

# ---------------------------------------------------------------- data


def long_date(v):
    """'2026-10-14' -> '14 October 2026' (the version is the release date)."""
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", v or "")
    if not m:
        return v or ""
    months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    return f"{int(m[3])} {months[int(m[2]) - 1]} {m[1]}"

def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))

IDX = load(DATA / "index.json")
REFS = load(DATA / "references.json")
MODELS = {m: load(DATA / "models" / f"{m}.json") for m in IDX["models"]}
PROBLEMS = {p: load(DATA / "problems" / f"{p}.json") for p in IDX["problems"]}
OVERVIEWS = [load(DATA / "overviews" / f"{o}.json") for o in IDX.get("overviews", [])]
NOTATION = load(DATA / "notation.json") if (DATA / "notation.json").exists() else {}
ACKS = load(DATA / "acknowledgements.json") if (DATA / "acknowledgements.json").exists() else {}

STATUS_LABEL = {"tight": "tight", "near": "near-optimal", "gap": "polynomial gap", "unknown": "unknown", "impossible": "impossible"}
ROLE_LABEL = {"introductory": "introductory", "best": "current best", "other": "also", "disputed": "disputed proof"}

# ---------------------------------------------------------------- citations (same labels as the website)

PARTICLES = {"de", "De", "di", "Di", "van", "von", "der", "den", "da", "Da", "du", "Du", "del", "Del", "della", "Della", "le", "Le", "la", "La", "dos", "auf"}

def last_name(name):
    parts = name.strip().split()
    s = parts[-1]
    i = len(parts) - 1
    if re.fullmatch(r"(Jr\.?|Sr\.?|II|III)", s) and len(parts) > 1:
        i -= 1
        s = parts[i] + " " + s
    while i > 1 and parts[i - 1] in PARTICLES:   # De Marco, Di Luna, van Renssen
        i -= 1
        s = parts[i] + " " + s
    if parts[i] == "auf" and i > 1:              # Meyer auf der Heide
        s = parts[i - 1] + " " + s
    return s

def cite_names(key):
    r = REFS[key]
    a = [last_name(x) for x in r.get("authors", [])]
    if len(a) <= 1:
        return a[0] if a else "?"
    if len(a) == 2:
        return f"{a[0]} and {a[1]}"
    return f"{a[0]} et al."

# disambiguate identical author-year labels with a/b suffixes
_labels = {}
for k in sorted(REFS, key=lambda k: (REFS[k].get("year", 0), k)):
    _labels.setdefault((cite_names(k), REFS[k].get("year")), []).append(k)
YEAR_TAG = {}
for (n, y), ks in _labels.items():
    for i, k in enumerate(ks):
        YEAR_TAG[k] = f"{y}{'abcdefghij'[i]}" if len(ks) > 1 else f"{y}"

# ---------------------------------------------------------------- text conversion

SPECIAL = {"&": r"\&", "%": r"\%", "#": r"\#", "_": r"\_", "{": r"\{", "}": r"\}",
           "~": r"\textasciitilde{}", "^": r"\textasciicircum{}", "\\": r"\textbackslash{}"}
CITE_RE = re.compile(r"\[([A-Z][A-Za-z]*\d{4}[A-Za-z0-9]*)\]")

def esc_plain(s):
    return "".join(SPECIAL.get(c, c) for c in s)

def inline(s):
    """Markdown inline (math, citations, links, code, bold, italics) to LaTeX.

    Math, citations, links and code are replaced by placeholders first, so that
    emphasis markers can span them (e.g. **$n$ agents**), then restored."""
    if not s:
        return ""
    s = str(s)
    held = []
    def hold(x):
        held.append(x)
        return f"\x00{len(held) - 1}\x00"
    s = re.sub(r"\$\$.+?\$\$|\$[^$\n]+?\$", lambda m: hold(fix_math(m.group(0))), s)
    s = re.sub(r"`([^`]+)`", lambda m: hold(r"\texttt{%s}" % esc_plain(m.group(1))), s)
    s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", lambda m: hold(r"\href{%s}{%s}" % (m.group(2).replace("%", r"\%").replace("#", r"\#"), esc_plain(m.group(1)))), s)
    def cite(m):
        k = m.group(1)
        if k not in REFS:
            return m.group(0)
        after = s[m.end():m.end() + 2]
        if after in ("'s", "’s"):
            return hold(r"\citet{%s}" % k)            # [Key]'s -> Author (Year)'s
        before = s[:m.start()]
        if before.count("(") > before.count(")"):
            return hold(r"\citealp{%s}" % k)          # already inside parentheses: no second pair
        return hold(r"\citep{%s}" % k)
    s = CITE_RE.sub(cite, s)
    s = esc_plain(s)
    s = emph(s)
    return re.sub("\x00(\\d+)\x00", lambda m: held[int(m.group(1))], s)

def emph(s):
    s = re.sub(r"\*\*(.+?)\*\*", r"\\textbf{\1}", s)
    s = re.sub(r"(?<![\w*\\])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"\\emph{\1}", s)
    s = s.replace('"', "\u201d")
    s = re.sub(r"(^|[\s(\[{\u2014-])\u201d", "\\1\u201c", s)
    return s

def fix_math(t):
    # KaTeX accepts a few things LaTeX needs spelt differently; keep the math otherwise verbatim
    return t

def math(b):
    """A bound as inline math; allow line breaks after top-level commas and explicit spaces."""
    if not b:
        return ""
    m = re.fullmatch(r"\\text\{([^{}]*)\}", b.strip())
    if m:
        return r"\textit{%s}" % esc_plain(m.group(1))
    b = re.sub(r",(?!\\allowbreak)", r",\\allowbreak ", b)
    b = re.sub(r"(?<!,)\\ \\text", r"\\allowbreak\\ \\text", b)
    return f"${b}$"

def block(md):
    """Markdown block text (paragraphs, lists, block quotes) to LaTeX."""
    if not md:
        return ""
    lines = str(md).split("\n")
    out, i = [], 0
    while i < len(lines):
        l = lines[i]
        if re.match(r"^\s*[-*] ", l):
            items = []
            while i < len(lines) and re.match(r"^\s*[-*] ", lines[i]):
                items.append(inline(re.sub(r"^\s*[-*] ", "", lines[i])))
                i += 1
            out.append("\\begin{itemize}\n" + "\n".join(r"\item " + x for x in items) + "\n\\end{itemize}")
            continue
        if re.match(r"^\s*\d+\. ", l):
            items = []
            while i < len(lines) and re.match(r"^\s*\d+\. ", lines[i]):
                items.append(inline(re.sub(r"^\s*\d+\. ", "", lines[i])))
                i += 1
            out.append("\\begin{enumerate}\n" + "\n".join(r"\item " + x for x in items) + "\n\\end{enumerate}")
            continue
        if l.startswith(">"):
            q = []
            while i < len(lines) and lines[i].startswith(">"):
                q.append(lines[i].lstrip("> "))
                i += 1
            out.append("\\begin{quote}\\itshape\n" + inline(" ".join(q)) + "\n\\end{quote}")
            continue
        if not l.strip():
            out.append("")
            i += 1
            continue
        para = []
        while i < len(lines) and lines[i].strip() and not re.match(r"^\s*([-*]|\d+\.) ", lines[i]) and not lines[i].startswith(">"):
            para.append(lines[i])
            i += 1
        out.append(inline(" ".join(para)))
    return "\n\n".join(x for x in out)

# ---------------------------------------------------------------- the assumption tree (same algorithm as assets/app.js)

def prepare(p):
    model = MODELS[p["model"]]
    merged = {}
    for a in model["axes"] + p.get("axes", []):
        merged[a["id"]] = a
    for x in p.get("ignore_axes", []):
        merged.pop(x, None)
    order = [x for x in p.get("axis_order", list(merged)) if x in merged]
    axes = [merged[x] for x in order] + [merged[x] for x in merged if x not in order]
    p["_axes"] = axes
    p["_axis"] = {a["id"]: a for a in axes}
    p["_idx"] = {a["id"]: i for i, a in enumerate(axes)}
    level = lambda a, x: next((v.get("level", 0) for v in p["_axis"][a]["values"] if v["id"] == x), 0)
    p["_level"] = level
    zero = {a["id"]: next((v["id"] for v in a["values"] if not v.get("level")), a["values"][0]["id"]) for a in axes}
    p["_zero"] = zero
    raw = {(): {"atoms": (), "kids": [], "variant": None}}
    def ensure(atoms):
        if atoms not in raw:
            raw[atoms] = {"atoms": atoms, "kids": [], "variant": None}
        return raw[atoms]
    for v in p["variants"]:
        full = dict(zero)
        full.update(v.get("assumptions", {}))
        v["_full"] = full
        atoms = tuple((a["id"], full[a["id"]]) for a in axes if level(a["id"], full[a["id"]]) > 0)
        for i in range(1, len(atoms) + 1):
            ensure(atoms[:i])
            k = atoms[:i]
            if k not in raw[atoms[:i - 1]]["kids"]:
                raw[atoms[:i - 1]]["kids"].append(k)
        r = ensure(atoms)
        if r["variant"] is None:
            r["variant"] = v
    kept = lambda k: k == () or raw[k]["variant"] is not None or len(raw[k]["kids"]) >= 2
    def kept_kids(k):
        res = []
        for c in raw[k]["kids"]:
            res += [c] if kept(c) else kept_kids(c)
        return res
    def build(k, parent):
        r = raw[k]
        n = {"atoms": k, "variant": r["variant"], "parent": parent, "depth": parent["depth"] + 1 if parent else 0}
        n["children"] = [build(c, n) for c in kept_kids(k)]
        n["size"] = (1 if n["variant"] else 0) + sum(c["size"] for c in n["children"])
        return n
    root = build((), None)
    def label(n):
        for c in n["children"]:
            added = c["atoms"][len(n["atoms"]):]
            first = p["_idx"][added[0][0]] if added else 10**9
            sib = set()
            for s in n["children"]:
                if s is not c:
                    for a, _ in s["atoms"][len(n["atoms"]):]:
                        if p["_idx"][a] < first:
                            sib.add(a)
            c["zeros"] = [(a["id"], zero[a["id"]]) for a in axes if a["id"] in sib]
            c["added"] = list(added)
        n["children"].sort(key=lambda c: (-c["size"], 0 if c["variant"] else 1))
        for c in n["children"]:
            label(c)
        firsts = []
        for c in n["children"]:
            f = (c["zeros"] or c["added"] or [None])[0]
            if f and f[0] not in firsts:
                firsts.append(f[0])
        n["split"] = [p["_axis"][a]["name"] for a in axes_sorted(p, firsts)]
    root["zeros"], root["added"] = [], []
    label(root)
    p["_root"] = root
    p["_order"] = []
    def walk(n):
        p["_order"].append(n)
        for c in n["children"]:
            walk(c)
    walk(root)

def axes_sorted(p, ids):
    return sorted(ids, key=lambda a: p["_idx"][a])

def value(p, a, x):
    return next((v for v in p["_axis"][a]["values"] if v["id"] == x), {"id": x, "label": x, "level": 0})

def short(p, a, x):
    v = value(p, a, x)
    return v.get("short") or v.get("label")

def node_title(p, n):
    if n["variant"]:
        return n["variant"]["title"]
    if not n["parent"]:
        return "No assumptions"
    return " · ".join(n["split"]) or "Branch point"

def edge_text(p, n):
    if not n["parent"]:
        return "no assumptions"
    return ", ".join([inline(short(p, a, x)) for a, x in n["zeros"]] + ["+\\,%s" % inline(short(p, a, x)) for a, x in n["added"]])

for p in PROBLEMS.values():
    prepare(p)

# ---------------------------------------------------------------- relations between problems

def parent_of(p):
    d = p.get("derived_from")
    return PROBLEMS.get(d["problem"]) if d else None

def derived_of(p):
    return [q for q in (PROBLEMS[x] for x in IDX["problems"]) if parent_of(q) is p]

def related_of(p):
    out = [(PROBLEMS[r["problem"]], r["relation"]) for r in p.get("related", []) if r["problem"] in PROBLEMS]
    for q in (PROBLEMS[x] for x in IDX["problems"]):
        if q is not p:
            for r in q.get("related", []):
                if r["problem"] == p["id"] and not any(x[0] is q for x in out):
                    out.append((q, r["relation"]))
    return out

def family_of(pid):
    return next((f for f in IDX.get("families", []) if pid in f["problems"]), None)

def plabel(p):
    return f"prob:{p['id']}"

def vlabel(p, v):
    return f"var:{p['id']}:{v['id']}"

def pref(p):
    return r"\hyperref[%s]{%s}" % (plabel(p), esc_plain(p["name"]))

# ---------------------------------------------------------------- rendering helpers

def status_of(v, m):
    return ((v.get("optimality") or {}).get(m) or {}).get("status", "unknown")

def dot(st):
    return r"\statusdot{%s}" % st

def best_result(v, m):
    rs = [r for r in v.get("results", []) if r.get(m) and r.get("role") != "disputed"]
    return next((r for r in rs if r["role"] == "best"), rs[-1] if rs else None)

def intro_result(v, m):
    return next((r for r in v.get("results", []) if r.get(m) and r["role"] == "introductory"), None)

def lower_bounds(v, m):
    return [b for b in v.get("lower_bounds", []) if b.get("measure") == m]

def cite(key):
    return r"\citealp{%s}" % key if key in REFS else esc_plain(key or "")

def is_own(key):
    owner = IDX.get("owner", "")
    return owner and any(a.strip() == owner for a in REFS.get(key, {}).get("authors", []))

# ---------------------------------------------------------------- sections

def axes_table(axes, scope=None):
    out = []
    for a in axes:
        vals = sorted(a["values"], key=lambda v: v.get("level", 0))
        rows = []
        for v in vals:
            rows.append(r"\levelbox{%d} & \textbf{%s} & %s \\" % (v.get("level", 0), inline(v.get("short") or v["label"]), inline(v.get("definition") or v.get("label"))))
        out.append(r"\axisheading{%s}" % esc_plain(a["name"]) + (r"\label{ax:%s:%s}" % (scope, a["id"]) if scope else "") + "\n" +
                   (block(a["origin"]) + "\n\n" if a.get("origin") else "") +
                   "\\begin{tabularx}{\\linewidth}{@{}l>{\\raggedright\\arraybackslash}p{0.27\\linewidth}>{\\raggedright\\arraybackslash}X@{}}\n\\toprule\n"
                   r"\small Level & \small Value & \small Formal definition \\ \midrule" + "\n" + "\n".join(rows) + "\n\\bottomrule\n\\end{tabularx}\n")
    return "\n".join(out)

def tree_outline(p):
    """The case tree as a drawn tree (dirtree: connector lines, breaks across pages). Each entry: in grey what its
    edge adds or leaves unassumed, then the setting with its status per measure and page; branch points in italics."""
    measures = p["measures"]
    rows = []
    for n in p["_order"]:
        v = n["variant"]
        # each dirtree level starts 19.2pt further right (offset + width + sep of \DTsetlength at 11pt), and \linewidth
        # is not narrowed: shrink the entry by the same amount so the dots and page numbers line up on the right
        width = r"\dimexpr\linewidth-%.2fpt-1.5em-5pt\relax" % (19.71 * n["depth"])
        edge = r"{\footnotesize\color{muted}%s}\newline " % edge_text(p, n) if n["parent"] else ""   # \dirtree is not \long: no \par
        if v:
            dots = r"\,".join(dot(status_of(v, m["id"])) for m in measures)
            title = r"\hyperref[%s]{\textbf{%s}}%s\hfill\mbox{%s\enspace\textcolor{muted}{\footnotesize p.\,\pageref{%s}}}" % (
                vlabel(p, v), inline(node_title(p, n)), r"\ \stdtag" if v.get("standard") else "", dots, vlabel(p, v))
        else:
            title = r"\textcolor{muted}{\textit{%s}}" % inline(node_title(p, n))
        # the line to the children leaves just right of the entry's start: the title is indented past it
        body = r"%s\hspace*{0.8em}\parbox[t]{\dimexpr\linewidth-0.8em\relax}{\raggedright %s}" % (edge, title) if n["parent"] else title
        rows.append(r".%d {\begin{minipage}[t]{%s}\color{black}\raggedright\leavevmode %s\end{minipage}}." % (n["depth"] + 1, width, body))
    return "\\begin{casetree}\n\\dirtree{%\n" + "\n".join(rows) + "\n}\n\\end{casetree}"

def known_summary(p):
    """One row per catalogued setting: per measure the status and the best upper bound against the lower bound."""
    ms = p["measures"]
    w = 0.53 / len(ms)          # with the column gaps (2\tabcolsep each) the row stays inside \linewidth
    def cell(v, m):
        st, lb, br = status_of(v, m["id"]), (lower_bounds(v, m["id"]) or [None])[0], best_result(v, m["id"])
        if st == "impossible":
            return r"%s\,{\scriptsize\sffamily impossible}" % dot(st)
        ub = math(br[m["id"]]) if br else r"\textcolor{muted}{---}"
        lo = math(lb["bound"]) if lb else r"\textcolor{muted}{---}"
        return r"%s\,{\scriptsize\sffamily %s}\newline %s \textcolor{muted}{vs} %s" % (dot(st), STATUS_LABEL[st], ub, lo)
    head = r"\textbf{Setting} & " + " & ".join(r"\textbf{%s}" % esc_plain(m["name"]) for m in ms) + r" & \textbf{p.}"
    rows = []
    for n in p["_order"]:
        v = n["variant"]
        if not v:
            continue
        rows.append(r"\hyperref[%s]{%s}%s & %s & \pageref{%s} \\ \addlinespace[2pt]" % (
            vlabel(p, v), inline(v["title"]), r"\newline\stdtag" if v.get("standard") else "", " & ".join(cell(v, m) for m in ms), vlabel(p, v)))
    spec = r"@{}>{\raggedright\arraybackslash}p{0.31\linewidth}" + "".join(r">{\raggedright\arraybackslash}p{%.3f\linewidth}" % w for _ in ms) + r">{\raggedleft\arraybackslash}p{0.04\linewidth}@{}"
    return (r"{\small\setlength{\LTpre}{4pt}\setlength{\LTpost}{0pt}\begin{longtable}{%s}\toprule %s \\ \midrule\endhead" % (spec, head)
            + "\n" + "\n".join(rows) + "\n" + r"\bottomrule\end{longtable}}")

def known_table(p, v):
    rows = []
    for m in p["measures"]:
        mid = m["id"]
        lbs = lower_bounds(v, mid)
        lb = "; ".join(r"%s~%s" % (math(b["bound"]), r"\citep{%s}" % b["ref"] if b.get("ref") in REFS else "") for b in lbs) or r"\textcolor{muted}{none known}"
        br = best_result(v, mid)
        bt = r"%s~\citep{%s}" % (math(br[mid]), br["ref"]) if br else r"\textcolor{muted}{---}"
        st = status_of(v, mid)
        note = ((v.get("optimality") or {}).get(mid) or {}).get("note")
        rows.append(r"\textbf{%s} & %s & %s & %s~%s \\" % (esc_plain(m["name"]), lb, bt, dot(st), STATUS_LABEL[st]))
        if note:   # the note on the gap runs under the row, across the bound columns
            rows.append(r"& \multicolumn{3}{>{\raggedright\arraybackslash}p{\dimexpr0.87\linewidth-2\tabcolsep\relax}@{}}{\textcolor{muted}{%s}} \\" % inline(note))
        rows.append(r"\addlinespace[3pt]")
    return ("\\begin{knowntable}\n\\textbf{Measure} & \\textbf{Lower bound} & \\textbf{Best upper bound} & \\textbf{Status} \\\\ \\midrule\n"
            + "\n".join(rows) + "\n\\end{knowntable}")

def variant_section(p, v, n):
    """One setting: where it sits in the tree, its one-line summary, the assumptions in small print, a bounds table,
    then every result (lower bounds first) in one list, open questions and notes."""
    out = []
    par = n["parent"]
    while par and not par["variant"] and par["parent"]:
        par = par["parent"]
    tags = ([r"\stdtag"] if v.get("standard") else []) + [r"\vstatus{%s}" % (v.get("status") or "draft")]
    out.append(r"\subsection{%s}\label{%s}" % (inline(v["title"]), vlabel(p, v)))
    where = r"\textbf{Adds} %s" % edge_text(p, n) if n["parent"] else "the root: no assumptions"
    if par and par["variant"]:
        where += r" \textbf{to} \hyperref[%s]{%s} (p.\,\pageref{%s})" % (vlabel(p, par["variant"]), inline(par["variant"]["title"]), vlabel(p, par["variant"]))
    out.append(r"\noindent{\raggedright\footnotesize\textcolor{muted}{%s}\hfill %s\par}\nopagebreak\smallskip" % (where, " ".join(tags)))
    out.append(r"\noindent\textit{%s}\par" % inline(v.get("summary", "")))
    assumed = [a for a in p["_axes"] if p["_level"](a["id"], v["_full"][a["id"]]) > 0]
    free = [a for a in p["_axes"] if not p["_level"](a["id"], v["_full"][a["id"]])]
    out.append(r"\noindent{\footnotesize\textcolor{muted}{\textbf{Assumed:} %s. \textbf{Not assumed:} %s.}\par}" % (
        "; ".join(r"%s: %s" % (esc_plain(a["name"]).lower(), inline(value(p, a["id"], v["_full"][a["id"]])["label"])) for a in assumed) or "nothing",
        "; ".join(r"%s: %s" % (esc_plain(a["name"]).lower(), inline(value(p, a["id"], v["_full"][a["id"]])["label"])) for a in free) or "---"))
    if v.get("statement"):
        out.append(r"\paragraph{Statement for this setting.}" + block(v["statement"]))
    out.append(known_table(p, v))
    items = []
    for b in v.get("lower_bounds", []):
        meas = next((m["name"] for m in p["measures"] if m["id"] == b["measure"]), b["measure"])
        s = r"\item %s~\roletag{lb}: %s %s." % (r"\citet{%s}" % b["ref"] if b.get("ref") in REFS else "", esc_plain(meas).lower(), math(b["bound"]))
        if b.get("bottleneck"):
            s += r" \emph{Bottleneck:} %s." % inline(b["bottleneck"])
        if b.get("preconditions"):
            s += r" \emph{Holds when:} " + "; ".join(inline(x) for x in b["preconditions"]) + "."
        if b.get("note"):
            s += " " + inline(b["note"])
        items.append(s)
    for r in v.get("results", []):
        bounds = ", ".join(r"%s %s" % (esc_plain(m["name"]).lower(), math(r[m["id"]])) for m in p["measures"] if r.get(m["id"]))
        s = r"\item \citet{%s}~\roletag{%s}" % (r["ref"], r["role"])
        if bounds:
            s += r": " + bounds + "."
        if r.get("assumes"):
            s += r" \emph{Assumes:} " + "; ".join(inline(x) for x in r["assumes"]) + "."
        if r.get("note"):
            s += " " + inline(r["note"])
        items.append(s)
    if items:
        out.append(r"\paragraph{Results.}" + "\n\\begin{resultlist}\n" + "\n".join(items) + "\n\\end{resultlist}")
    if v.get("open"):
        out.append(r"\paragraph{Open questions.}" + "\n\\begin{openlist}\n" + "\n".join(r"\item " + inline(q) for q in v["open"]) + "\n\\end{openlist}")
    if v.get("notes"):
        out.append(r"\paragraph{Notes.}" + block(v["notes"]))
    return "\n\n".join(out)

def path_of(n):
    out = []
    while n:
        out.append(n)
        n = n["parent"]
    return list(reversed(out))

# ---------------------------------------------------------------- figures
# The PDF does not copy the animated web figure. It draws two panels in the idiom of a
# TikZ figure in a paper: (a) the first frame, (b) the last frame with the motion traced
# (grey start positions and arrowed paths in the plane, bent arrows along traversed edges
# on graphs). Black ink; a small print palette only where a colour carries meaning.

FIGCOL = {"accent": "fink", "tight": "fgreen", "gap": "fred", "near": "fochre", "muted": "fgrey", "fg": "black",
          "disputed": "fviolet", "l1": "fone", "l2": "ftwo", "l3": "fthree", "l4": "ffour", "soft": "fsoft", "line": "fline"}
def tcol(c, default="accent"):
    return "none" if c == "none" else FIGCOL.get(c or default, FIGCOL[default])

def fig_point(fig, e):
    if e.get("at") and fig.get("graph") and e["at"] in fig["graph"]["nodes"]:
        return fig["graph"]["nodes"][e["at"]]
    if e.get("lat"):
        u = fig.get("unit", 8); o = fig.get("origin", [0, 0]); i, j = e["lat"]
        return [o[0] + u * (i + j / 2), o[1] + u * j * 3 ** 0.5 / 2]
    return e.get("p", [0, 0])

def fig_label(s):
    """An entity label: a single symbol is set in math italic, anything else as text."""
    s = str(s)
    return "$%s$" % s if re.fullmatch(r"[A-Za-z0-9]{1,3}", s) else esc_plain(s)

def lw(w, base=0.6):
    return "line width=%.2fpt" % max(0.3, 0.45 * (w if w is not None else base) / 0.6)

def tikz_shape(fig, sh, lattice=False):
    P = lambda q: "(%.2f,%.2f)" % tuple(q if isinstance(q, list) else fig_point(fig, q))
    c = tcol(sh.get("c"), "line")
    if sh["t"] == "line" and sh.get("c", "line") in ("line", "soft") and (lattice or sh.get("w", 0.6) <= 0.35):
        c = "flattice"                     # grid and lattice lines stay in the background
    opt = ["draw=%s" % c, lw(sh.get("w"))]
    if sh.get("dash"): opt.append("dash pattern=on 1.6pt off 1.2pt")
    if sh.get("fill"): opt.append("fill=%s" % tcol(sh["fill"]))
    if sh.get("op"): opt.append("fill opacity=%s" % sh["op"])
    t = sh["t"]
    if t == "circle": return r"\draw[%s] %s circle (%.2f);" % (",".join(opt), P(sh["p"]), sh["r"])
    if t in ("line", "path"):
        return r"\draw[%s%s,line cap=round,line join=round] %s;" % (",".join(opt), ",-{Latex[length=3.2pt,width=2.6pt]}" if sh.get("arrow") else "", " -- ".join(P(q) for q in sh["p"]))
    if t == "poly": return r"\draw[%s,line join=round] %s -- cycle;" % (",".join(opt), " -- ".join(P(q) for q in sh["p"]))
    if t == "node": return r"\filldraw[fill=%s,draw=black,line width=0.4pt] %s circle (%.2f);" % (tcol(sh.get("fill"), "fg"), P(fig["graph"]["nodes"][sh["n"]]), max(sh.get("r", 2.2), NODE_R + 0.4))
    if t == "text": return r"\node[text=%s,font=\fontsize{6.5}{7}\selectfont] at %s {%s};" % (tcol(sh.get("c"), "fg") if sh.get("c") not in (None, "muted") else "fgrey", P(sh["p"]), fig_text(sh["s"]))
    if t == "star": return r"\node[star,star points=5,star point ratio=2.3,fill=%s,draw=black,line width=0.3pt,inner sep=0pt,minimum size=%.2fpt] at %s {};" % (tcol(sh.get("c"), "near"), 2.2 * sh.get("r", 2.4) * UNIT_PT, P(sh["p"]))
    if t == "rect":
        x, y = fig_point(fig, {"p": sh["p"]})
        return r"\draw[%s] (%.2f,%.2f) rectangle ++(%.2f,%.2f);" % (",".join(opt), x - sh.get("wd", 3) / 2, y - sh.get("ht", 3) / 2, sh.get("wd", 3), sh.get("ht", 3))
    return ""

def fig_text(s):
    s = str(s)
    if "$" in s: return inline(s)
    if re.fullmatch(r"[A-Za-z]|[A-Za-z]?\d+|[A-Za-z]_?\d", s): return "$%s$" % s.replace("_", "")
    return inline(s)

def frame_points(fig, f):
    """Positions of a frame's entities; entities sharing a graph node or lattice point sit on a small ring around it.
    Returns {id: (x, y, angle)} where angle is the direction in which the label goes."""
    import math
    by = {}
    for e in f.get("ents", []):
        if (e.get("at") or e.get("lat")) and not e.get("p"):
            by.setdefault(e.get("at") or tuple(e["lat"]), []).append(e["id"])
    pts = {}
    for e in f.get("ents", []):
        x, y = fig_point(fig, e); a = math.pi / 4
        grp = by.get(e.get("at") or (tuple(e["lat"]) if e.get("lat") else None), [])
        if len(grp) > 1:
            j = grp.index(e["id"]); a = math.pi / 2 + 2 * math.pi * j / len(grp)
            rad = max(NODE_R + AGENT_R - 0.7, len(grp) * (2 * AGENT_R + 0.5) / (2 * math.pi)) if fig.get("graph") else fig.get("cluster", 3.2)
            x, y = x + rad * math.cos(a), y + rad * math.sin(a)
        pts[e["id"]] = (x, y, a)
    return pts

MOVERS = ("robot", "agent")

def tikz_entity(fig, e, xy, ghost=False):
    import math
    x, y, a = xy; k = e.get("k", "robot"); c = tcol(e.get("c"))
    r = e.get("r", 2.6 if k == "particle" else 3.2 if k == "tile" else 1.9)
    on_node = bool(fig.get("graph") and e.get("at")) and k in MOVERS
    if on_node: r = AGENT_R
    out = []
    if ghost:
        return r"\draw[fghost,line width=0.4pt,dash pattern=on 1pt off 0.8pt] (%.2f,%.2f) circle (%.2f);" % (x, y, r)
    if k == "particle":
        # the amoebot convention: a particle is a dot on a lattice node; an expanded one is two dots joined by a bar
        rr = min(r, fig.get("unit", 8) * 0.3)
        if e.get("q") or e.get("qlat"):
            qx, qy = fig_point(fig, {"lat": e["qlat"]}) if e.get("qlat") else e["q"]
            out.append(r"\draw[%s,line width=%.2fpt,line cap=round] (%.2f,%.2f) -- (%.2f,%.2f);" % (c, 0.9 * rr * UNIT_PT, x, y, qx, qy))
            out.append(r"\filldraw[fill=%s,draw=black,line width=0.35pt] (%.2f,%.2f) circle (%.2f);" % (c, qx, qy, rr))
        out.append(r"\filldraw[fill=%s,draw=black,line width=0.35pt] (%.2f,%.2f) circle (%.2f);" % (c, x, y, rr))
    elif k == "tile":
        out.append(r"\node[regular polygon,regular polygon sides=6,shape border rotate=30,fill=%s,draw=black,line width=0.3pt,inner sep=0pt,minimum size=%.2fpt] at (%.2f,%.2f) {};" % (c if e.get("c") not in (None, "muted") else "fsoft!70!fgrey", 1.9 * r * UNIT_PT, x, y))
    elif k == "crashed":
        out.append(r"\draw[%s,fill=white,line width=0.5pt] (%.2f,%.2f) circle (%.2f); \draw[%s,line width=0.5pt] (%.2f,%.2f) -- ++(%.2f,%.2f) (%.2f,%.2f) -- ++(%.2f,%.2f);" % (c, x, y, r, c, x - .6 * r, y - .6 * r, 1.2 * r, 1.2 * r, x - .6 * r, y + .6 * r, 1.2 * r, -1.2 * r))
    elif k == "target":
        out.append(r"\node[star,star points=5,star point ratio=2.3,fill=%s,draw=black,line width=0.3pt,inner sep=0pt,minimum size=%.2fpt] at (%.2f,%.2f) {};" % (c, 2.8 * r * UNIT_PT, x, y))
    elif k == "exit":
        out.append(r"\filldraw[fill=%s,draw=black,line width=0.35pt] (%.2f,%.2f) rectangle ++(%.2f,%.2f);" % (c, x - r, y - r, 2 * r, 2 * r))
    else:
        out.append(r"\filldraw[fill=%s,draw=black,line width=0.35pt] (%.2f,%.2f) circle (%.2f);" % (c, x, y, r))
    if e.get("l") and on_node:
        out.append(r"\node[text=%s,font=\fontsize{5.5}{6}\selectfont,inner sep=0pt] at (%.2f,%.2f) {%s};" % ("black" if e.get("c") in ("l3", "near", "soft") else "white", x, y, fig_label(e["l"])))
    elif e.get("l"):
        d = r + 2.0
        out.append(r"\node[font=\fontsize{6.5}{7}\selectfont,inner sep=0pt] at (%.2f,%.2f) {%s};" % (x + d * math.cos(a), y + d * math.sin(a), fig_label(e["l"])))
    return "\n".join(out)

def traces(fig, frames, model):
    """Arrowed paths of every robot that moves, drawn on the last panel: the polyline through its positions."""
    if fig.get("graph"):
        return []                          # on graphs the final marks (trees, settled nodes) say more than arrows
    paths = {}
    for f in frames:
        pts = frame_points(fig, f)
        for e in f.get("ents", []):
            if e.get("k", "robot") not in MOVERS: continue
            p = paths.setdefault(e["id"], [])
            here = tuple(round(v, 2) for v in pts[e["id"]][:2])
            if not p or p[-1] != here: p.append(here)
    out = []
    for p in paths.values():
        if len(p) < 2: continue
        out.append(r"\draw[ftrace,line width=0.5pt,dash pattern=on 2pt off 1.2pt,line join=round,-{Latex[length=3.2pt,width=2.6pt]},shorten >=2.2] %s;" % " -- ".join("(%.2f,%.2f)" % q for q in p))
    return out

UNIT_PT = 1.0
NODE_R = 3.0
AGENT_R = 2.2
def tikz_frame(fig, f, width_cm, frames=None, model=""):
    global UNIT_PT
    W, H = fig.get("view", [100, 60])
    sc = width_cm / W
    UNIT_PT = sc * 28.45  # 1 user unit in pt
    lattice = bool(fig.get("unit")) and not fig.get("graph")
    lines = [r"\begin{tikzpicture}[x=%.4fcm,y=%.4fcm,every node/.style={inner sep=1pt},>=Latex]" % (sc, sc),
             r"\path[use as bounding box] (-3,-3) rectangle (%.2f,%.2f);" % (W + 3, H + 3)]
    lines += [tikz_shape(fig, sh, lattice) for sh in fig.get("static", [])]
    g = fig.get("graph")
    if g:
        for a, b in g.get("edges", []):
            lines.append(r"\draw[black!75,line width=0.5pt%s] (%.2f,%.2f) -- (%.2f,%.2f);" % (",-{Latex[length=3.6pt,width=2.8pt]},shorten >=%.2f" % (NODE_R + 0.3) if g.get("directed") else "", *g["nodes"][a], *g["nodes"][b]))
    lines += [tikz_shape(fig, sh, lattice) for sh in f.get("marks", []) if sh["t"] != "node"]
    if g:
        marked = {sh["n"] for sh in f.get("marks", []) if sh["t"] == "node"}
        for k, (x, y) in g["nodes"].items():
            if k not in marked:
                lines.append(r"\filldraw[fill=white,draw=black,line width=0.45pt] (%.2f,%.2f) circle (%.2f);" % (x, y, NODE_R))
        lines += [tikz_shape(fig, sh, lattice) for sh in f.get("marks", []) if sh["t"] == "node"]
    pts = frame_points(fig, f)
    if frames:
        trail = traces(fig, frames, model)
        if trail and not g:
            p0 = frame_points(fig, frames[0]); now = {e["id"] for e in f.get("ents", [])}
            for e in frames[0].get("ents", []):
                if e.get("k", "robot") in MOVERS and e["id"] in now and (round(p0[e["id"]][0], 2), round(p0[e["id"]][1], 2)) != (round(pts[e["id"]][0], 2), round(pts[e["id"]][1], 2)):
                    lines.append(tikz_entity(fig, e, p0[e["id"]], ghost=True))
        lines += trail
    lines += [tikz_entity(fig, e, pts[e["id"]]) for e in f.get("ents", [])]
    lines.append(r"\end{tikzpicture}")
    return "\n".join(l for l in lines if l)

def wants_traces(p):
    fig = p["figure"]; F = fig["frames"]
    if len(F) < 2 or (fig.get("unit") and not fig.get("graph")):
        return False                       # lattice: the before/after pair says it
    if any(sh["t"] == "path" for sh in F[-1].get("marks", [])) and not fig.get("graph"):
        return False                       # the figure already draws the trajectories
    return p["id"] not in FIG_NO_TRACES

FIG_NO_TRACES = {"pattern-sequences", "patrolling", "hybrid-shape-formation"}   # periodic or back-and-forth runs: the arrows would only clutter

def figure_tikz(p):
    fig = p["figure"]; F = fig.get("frames", [])
    if not F: return ""
    first, last = F[0], F[-1]
    tr = wants_traces(p)
    def cell(tag, f, frames=None):
        lab = inline(f.get("label", ""))
        if frames and traces(fig, frames, p["model"]):
            lab += (" " if lab else "") + r"\textcolor{fgrey}{(arrows: moves%s)}" % ("" if fig.get("graph") else "; dashed circles: starting positions")
        return (r"\begin{minipage}[t]{0.485\linewidth}\centering %s\par\smallskip"
                r"\begin{minipage}[t]{0.94\linewidth}\sffamily\footnotesize (%s)~%s\end{minipage}\end{minipage}") % (tikz_frame(fig, f, 7.2, frames, p["model"]), tag, lab)
    body = cell("a", first) + (r"\hfill" + cell("b", last, F if tr else None) if len(F) > 1 else "")
    return r"\begin{figure}[htbp]\centering%s" % "\n" + body + "\n" + r"\caption{%s}\end{figure}" % inline(fig.get("caption", p["name"]))

def problem_section(p):
    out = [r"\section{%s}\label{%s}" % (inline(p["name"]), plabel(p))]
    out.append(r"\begin{summarybox}%s\end{summarybox}" % inline(p["summary"]))
    if p.get("origin"):
        o = p["origin"]
        out.append(r"\noindent\textcolor{muted}{\small First posed in %d \citep{%s}.}" % (o["year"], o["ref"]) + (" " + inline(o["note"]) if o.get("note") else ""))
    out.append(r"\subsection*{Problem statement and measures}" + block(p["statement"]) + "\n\n" +
               r"\noindent\textit{Measures:} " + "; ".join(r"\textbf{%s}, %s" % (esc_plain(m["name"]), inline(m["description"])) for m in p["measures"]) + ".")
    if p.get("figure"):
        out.append(figure_tikz(p))
    if p.get("primer"):
        KIND = {"algorithm": "Algorithm", "impossibility": "Impossibility", "lower-bound": "Lower bound"}
        ideas = []
        for i, x in enumerate(p["primer"].get("ideas", []), 1):
            v = next((v for v in p["variants"] if v["id"] == x.get("variant")), None)
            where = (r" {\footnotesize\textcolor{muted}{(%s, p.~\pageref{%s})}}" % (inline(v["title"]), vlabel(p, v))) if v else ""
            src = (r" \citep{%s}" % x["ref"]) if x.get("ref") in REFS else ""
            ideas.append(r"\paragraph{%d. %s: %s.}%s%s" % (i, KIND.get(x["kind"], x["kind"]), inline(x["title"]), src, where) + "\n" + block(x["idea"]) +
                         "\n\n" + r"\noindent\textit{%s} %s" % ("Why it works and what it costs." if x["kind"] == "algorithm" else "Why it holds.", inline(x["analysis"])) +
                         ("\n\n" + r"\noindent{\small\textit{Why it matters.} %s}" % inline(x["why_it_matters"]) if x.get("why_it_matters") else ""))
        out.append(r"\subsection*{A first look}" + "\n" + block(p["primer"]["intro"]) + "\n\n" + "\n\n".join(ideas))
    if p.get("history"):
        out.append(r"\subsection*{What the community started looking at}" + block(p["history"]))
    if p.get("further"):
        out.append(r"\subsection*{Further reading}" + "Papers on this problem that are not yet placed in a setting.\n" + r"\begin{itemize}[leftmargin=1.2em]\small" + "\n".join(r"\item \citet{%s}. %s" % (f["ref"], inline(f.get("note", ""))) for f in p["further"] if f["ref"] in REFS) + r"\end{itemize}")
    par, kids, rels = parent_of(p), derived_of(p), related_of(p)
    famrels = [f for f in IDX.get("families", []) if any(r["problem"] == p["id"] for r in f.get("related", []))]
    if par or kids or rels or famrels:
        rel = []
        if par:
            rel.append(r"\textbf{%s %s.} %s" % (esc_plain((p["derived_from"].get("kind") or "derived from").capitalize()), pref(par), inline(p["derived_from"]["relation"])))
        for q in kids:
            rel.append(r"\textbf{Derived problem: %s} (%s). %s" % (pref(q), esc_plain(q["derived_from"].get("kind") or "derived from"), inline(q["derived_from"]["relation"])))
        for f in famrels:
            r = next(r for r in f["related"] if r["problem"] == p["id"])
            rel.append(r"\textbf{Related family: %s.} %s" % (esc_plain(f["name"]), inline(r["relation"])))
        for q, t in rels:
            rel.append(r"\textbf{Related: %s.} %s" % (pref(q), inline(t)))
        out.append(r"\subsection*{Relations to other problems}" + "\n\\begin{itemize}\n" + "\n".join(r"\item " + x for x in rel) + "\n\\end{itemize}")
    local = p.get("axes", [])
    if local:
        out.append(r"\subsection*{Assumptions specific to this problem}" + "\n" + axes_table(local, p["id"]))
    out.append(r"\Needspace{10\baselineskip}\subsection*{Case tree}" +
               r"\noindent{\small The root assumes nothing; going down, each edge adds the assumptions written in grey (\textbf{+}) or leaves an axis unassumed. Bold entries are catalogued settings with their status per measure (%s) and page; italic entries are branch points, named after the axis on which their branches differ. Axis order: %s.}" % (
                   ", ".join(esc_plain(m["name"]) for m in p["measures"]), " \\textrightarrow\\ ".join(esc_plain(a["name"]) for a in p["_axes"])) + "\n\n" + tree_outline(p))
    out.append(r"\subsection*{What is known}" + r"\noindent{\small The best upper bound against the best lower bound in each catalogued setting, in tree order. The settings follow in detail.}" + "\n\n" + known_summary(p))
    for n in p["_order"]:
        if n["variant"]:
            out.append(variant_section(p, n["variant"], n))
    return "\n\n".join(out)

def family_tree_order(problems):
    ids = {p["id"] for p in problems}
    roots = [p for p in problems if not parent_of(p) or parent_of(p)["id"] not in ids]
    out = []
    def walk(p):
        out.append(p)
        for q in derived_of(p):
            if q["id"] in ids:
                walk(q)
    for r in roots:
        walk(r)
    return out

def landscape_section(m):
    L = m["landscape"]
    sch = {x["id"]: x["label"] for x in L["schedulers"]}
    def lm(x):
        mm, sc = x.split("^")
        return r"%s\textsuperscript{\,%s}" % (esc_plain(mm), esc_plain(sch.get(sc, sc)))
    REL = {">": r"$>$", "≡": r"$\equiv$", "⊥": r"$\perp$", "≥": r"$\geq$"}
    seps = {q["abbrev"]: q for q in L.get("problems", [])}
    out = [r"\section*{%s}\addcontentsline{toc}{section}{%s}" % (esc_plain(L["title"]), esc_plain(L["title"])), block(L["intro"]), block(L["trivial"])]
    out.append(r"\noindent The website shows the same relations as an interactive grid: choosing a model colours every other model as stronger, weaker, equivalent, incomparable or unknown, including relations that follow by transitivity and incomparabilities that carry over to equivalent models.")
    for v in L["views"]:
        rows = []
        for r in v["relations"]:
            src = r"\citet{%s}%s" % (r["ref"], (" " + inline(r["thm"])) if r.get("thm") else "") if r["ref"] in REFS else esc_plain(r["ref"])
            if r.get("also"):
                src += r"; also " + ", ".join(r"\citet{%s}" % k for k in r["also"] if k in REFS)
            if r.get("unread"):
                src += r" (as reported)"
            if r.get("caveat"):
                src += r"\newline\textcolor{near}{\footnotesize %s}" % inline(r["caveat"])
            if r.get("note"):
                src += r"\newline{\footnotesize %s}" % inline(r["note"])
            rows.append(r"%s & %s & %s & %s & %s\\" % (lm(r["a"]), REL.get(r["rel"], esc_plain(r["rel"])), lm(r["b"]), esc_plain(", ".join(r.get("sep", []))) or r"\textit{simulation}", src))
        out.append(r"\subsection*{%s}" % esc_plain(v["title"]) + "\n" + inline(v["assumptions"]) + "\n\n" +
                   r"{\footnotesize\setlength{\tabcolsep}{4pt}\begin{longtable}{@{}l c l p{0.17\linewidth} p{0.45\linewidth}@{}}\toprule Model & & Model & Separator & Source\\\midrule\endhead" + "\n" + "\n".join(rows) + "\n" + r"\bottomrule\end{longtable}}")
    if seps:
        out.append(r"\subsection*{Separating problems}" + "\n" + r"\begin{lbdesc}" + "\n".join(r"\item[%s: %s] %s %s" % (esc_plain(q["abbrev"]), inline(q["name"]), inline(q["definition"]), " ".join(r"\citep{%s}" % k for k in q.get("refs", []) if k in REFS)) for q in seps.values()) + r"\end{lbdesc}")
    if L.get("other"):
        out.append(r"\subsection*{Other settings}" + "\n" + r"\begin{itemize}[leftmargin=1.2em]" + "\n".join(r"\item " + inline(t) for t in L["other"]) + r"\end{itemize}")
    if L.get("conflicts"):
        out.append(r"\subsection*{Where the papers disagree}" + "\n" + r"\begin{itemize}[leftmargin=1.2em]" + "\n".join(r"\item " + inline(t) for t in L["conflicts"]) + r"\end{itemize}")
    if L.get("open"):
        out.append(r"\subsection*{Open questions}" + "\n" + r"\begin{openlist}" + "\n".join(r"\item " + inline(t) for t in L["open"]) + r"\end{openlist}")
    return "\n\n".join(out)

def symbol_table(rows, where=True):
    """Symbols as a long table: symbol, meaning, what papers write instead, where it is used."""
    if not rows:
        return ""
    def used(r):
        ps = [PROBLEMS[x] for x in r.get("where", []) if x in PROBLEMS]
        return ", ".join(esc_plain(q["name"]) for q in ps) if ps else "whole model"
    cols = r"@{}>{\raggedright\arraybackslash}p{0.17\linewidth}>{\raggedright\arraybackslash}p{%s\linewidth}>{\raggedright\arraybackslash}p{0.19\linewidth}%s@{}" % ("0.40" if where else "0.62", r">{\raggedright\arraybackslash}p{0.17\linewidth}" if where else "")
    head = r"Symbol & Meaning & Papers write" + (r" & Used in" if where else "") + r"\\\midrule\endhead"
    body = "\n".join(r"$%s$ & %s & %s%s\\" % (r["symbol"], inline(r["meaning"]), inline(r.get("papers_write", "")), (" & " + r"{\footnotesize %s}" % used(r)) if where else "") for r in rows)
    return r"{\small\begin{longtable}{%s}\toprule %s" % (cols, head) + "\n" + body + "\n" + r"\bottomrule\end{longtable}}"

def notation_chapter():
    if not NOTATION:
        return ""
    out = [r"\chapter{Notation}\label{ch:notation}", block(NOTATION.get("intro", "")),
           r"\section*{General conventions}" + "\n" + symbol_table(NOTATION.get("general", []), where=False),
           r"\noindent The symbols of each model are listed at the start of its chapter; Appendix~\ref{app:assumptions} indexes every assumption with its formal definition."]
    return "\n\n".join(out)

def assumptions_appendix():
    """Every assumption value of the atlas in alphabetical order, with its definition and where its axis is defined."""
    items = []
    for mid in IDX["models"]:
        m = MODELS[mid]
        for a in m["axes"]:
            items += [(v, a, mid, m["name"]) for v in a["values"]]
        for pid in IDX["problems"]:
            p = PROBLEMS[pid]
            if p["model"] == mid:
                for a in p.get("axes", []):
                    items += [(v, a, pid, p["name"]) for v in a["values"]]
    key = lambda it: re.sub(r"[^a-z0-9 ]", "", re.sub(r"\$[^$]*\$", lambda mm: mm.group(0).strip("$\\"), (it[0].get("short") or it[0]["label"])).lower()).strip()
    items.sort(key=lambda it: (key(it), it[1]["name"]))
    out = [r"\chapter{Index of assumptions}\label{app:assumptions}\markright{Index of assumptions}",
           r"Every assumption the atlas uses, alphabetically, with its formal definition. Each entry names its axis and the model or problem that defines it, and the page where the axis is introduced with its origin. Level 0 assumes nothing; higher levels are stronger assumptions.",
           r"\begin{lbdesc}"]
    for v, a, scope, sname in items:
        out.append(r"\item[%s] {\footnotesize\textcolor{muted}{%s, level %d; %s, p.~\pageref{ax:%s:%s}}}\newline %s" % (
            inline(v.get("short") or v["label"]), esc_plain(a["name"]), v.get("level", 0), esc_plain(sname), scope, a["id"], inline(v.get("definition") or v["label"])))
    out.append(r"\end{lbdesc}")
    return "\n".join(out)

def model_chapter(mid):
    """The model and its assumptions: description, the story that ties the axes together, every axis with its origin and definitions."""
    m = MODELS[mid]
    out = [r"\chapter{%s}\label{model:%s}" % (esc_plain(m["name"]), mid)]
    out.append(r"\begin{summarybox}%s\end{summarybox}" % inline(m["summary"]))
    if m.get("focus"):
        out.append(r"\begin{focusbox}{What is optimised}%s\end{focusbox}" % block(m["focus"]))
    out.append(block(m["description"]))
    if m.get("story"):
        out.append(r"\section{How the assumptions fit together}" + "\n" +
                   "\n\n".join(r"\subsection*{%s}" % esc_plain(sct["heading"]) + "\n" + block(sct["body"]) for sct in m["story"]))
    if NOTATION.get("models", {}).get(mid):
        out.append(r"\section{Notation}" + "\n" + r"\noindent Symbols of this model. Inside the model each symbol has one meaning; \emph{papers write} gives other symbols found in the literature." + "\n\n" + symbol_table(NOTATION["models"][mid]))
    out.append(r"\section{Assumption axes}" +
               r"\noindent Each axis says where the assumption comes from and why the community studies it, then defines its values. Every axis is a scale. Level 0 assumes nothing; each higher level is a stronger assumption, which makes a problem easier. Values on the same level are alternatives that do not imply each other. An algorithm designed for weaker assumptions works under stronger ones; a lower bound proved under stronger assumptions holds under weaker ones." + "\n\n" + axes_table(m["axes"], mid))
    if m.get("landscape"):
        out.append(landscape_section(m))
    probs = [PROBLEMS[x] for x in IDX["problems"] if PROBLEMS[x]["model"] == mid]
    fams = [f for f in IDX.get("families", []) if any(p["id"] in f["problems"] for p in probs)]
    if fams:
        out.append(r"\noindent The problems of this model are in Part~\ref{part:%s}: %s." % (mid, ", ".join(esc_plain(f["name"]) for f in fams)))
    return "\n\n".join(out)

def problems_part(mid):
    m = MODELS[mid]
    out = [r"\part{%s}\label{part:%s}" % (esc_plain(m["name"]), mid)]
    out.append(r"\noindent The model and its assumption axes are in Chapter~\ref{model:%s}." % mid)
    probs = [PROBLEMS[x] for x in IDX["problems"] if PROBLEMS[x]["model"] == mid]
    for f in IDX.get("families", []):
        fp = [p for p in probs if p["id"] in f["problems"]]
        if not fp:
            continue
        out.append(r"\chapter{%s}" % esc_plain(f["name"]))
        intro = [inline(f.get("summary", ""))]
        for r in f.get("related", []):
            if r["problem"] in PROBLEMS:
                intro.append(r"This family is related to %s: %s" % (pref(PROBLEMS[r["problem"]]), inline(r["relation"])))
        ordered = family_tree_order(fp)
        listing = "\\begin{itemize}\n" + "\n".join(
            r"\item %s%s" % (pref(p), (r" --- %s %s" % (esc_plain(p["derived_from"].get("kind") or "derived from"), pref(parent_of(p)))) if parent_of(p) else "") for p in ordered) + "\n\\end{itemize}"
        out.append(r"\begin{summarybox}" + "\n\n".join(intro) + r"\end{summarybox}" + "\n\nProblems in this family:\n" + listing)
        for p in ordered:
            out.append(problem_section(p))
    return "\n\n".join(out)

RANKING = "consequential-open-problems"   # shown at the start of the open-questions appendix, not among the perspectives

def overviews_part():
    """The perspectives, one chapter each, in the order of index.json."""
    out = [r"\part{Perspectives}\label{part:perspectives}",
           r"\noindent Essays that connect the problems of the atlas across models: where they come from, why the papers say they matter, and how techniques and lower bounds move between them. They assume the models of Part~\ref{part:models}."]
    for o in OVERVIEWS:
        if o["id"] == RANKING:
            continue
        out.append(r"\chapter{%s}\label{ov:%s}" % (esc_plain(o["title"]), o["id"]))
        out.append(r"\begin{summarybox}%s\end{summarybox}" % inline(o["summary"]))
        ps = [PROBLEMS[x] for x in o.get("problems", []) if x in PROBLEMS]
        if ps:
            out.append(r"\noindent\textit{Problems:} " + ", ".join(pref(p) for p in ps) + ".")
        for sct in o.get("sections", []):
            out.append(r"\section*{%s}" % esc_plain(sct["heading"]) + "\n" + block(sct["body"]))
        if o.get("further"):
            out.append(r"\section*{Further reading}" + block(o["further"]))
    return "\n\n".join(out)

def acknowledgements():
    if not ACKS:
        return ""
    repo = IDX.get("repo", "")
    out = [r"\chapter*{Acknowledgements}\addcontentsline{toc}{chapter}{Acknowledgements}\markboth{Acknowledgements}{}", block(ACKS.get("intro", ""))]
    people = ACKS.get("people", [])
    if people:
        out.append(r"\section*{Contributors}" + "\n" + r"\begin{itemize}[leftmargin=1.2em]" + "\n".join(
            r"\item \textbf{%s}%s: %s%s" % (esc_plain(x.get("name") or ("@" + x["github"] if x.get("github") else "anonymous")),
                                            (r" (@%s)" % esc_plain(x["github"])) if x.get("name") and x.get("github") else "",
                                            inline(x.get("contribution", "")), (r" \href{%s/issues/%s}{\#%s}" % (repo, x["issue"], x["issue"])) if x.get("issue") and repo else "")
            for x in people) + r"\end{itemize}")
    out.append(r"\section*{Tools and data}" + "\n" + r"\begin{itemize}[leftmargin=1.2em]" + "\n".join(r"\item \textbf{%s}: %s" % (esc_plain(t["name"]), inline(t["role"])) for t in ACKS.get("tools", [])) + r"\end{itemize}")
    if ACKS.get("authors_note"):
        out.append(inline(ACKS["authors_note"]))
    if repo:
        out.append(r"\section*{How to contribute}" + "\n" + r"Corrections, new results and missing problems are welcome as GitHub issues at \url{%s/issues}; every submission is checked against the full text of the paper, and accepted contributions are acknowledged here." % repo)
    return "\n\n".join(out)

def reading_guide():
    all_v = [(p, v) for p in PROBLEMS.values() for v in p["variants"]]
    count = lambda st: sum(1 for p, v in all_v for m in p["measures"] if status_of(v, m["id"]) == st)
    opens = sum(len(v.get("open", [])) for _, v in all_v)
    intro = IDX.get("intro") or ("The catalogue is a hierarchy: **model** › **problem family** › **problem** › **assumption tree**. The root of every problem's tree assumes nothing; each edge adds assumptions, one axis at a time, until it reaches the settings studied in the literature. Every node records the proven lower bounds with what forces them, the paper that introduced the setting, the current best result, and how far apart they are.")
    rows = [("settings", len(all_v)), ("tight bounds", count("tight")), ("near-optimal", count("near")), ("polynomial gaps", count("gap")), ("unknown", count("unknown")), ("open questions", opens)]
    out = [r"\chapter*{How to read this atlas}\addcontentsline{toc}{chapter}{How to read this atlas}\markboth{How to read this atlas}{}",
           block(intro),
           "\\begin{center}\\begin{tabular}{" + "c" * len(rows) + "}\\toprule\n" + " & ".join(r"\textbf{%d}" % n for _, n in rows) + r"\\" + "\n" + " & ".join(r"\footnotesize %s" % t for t, _ in rows) + r"\\\bottomrule\end{tabular}\end{center}",
           r"\paragraph{Status of a bound.} Each measure of each variant carries a status, judged against the best proven lower bound for that variant: " +
           "; ".join(r"%s~\emph{%s}" % (dot(k), v) for k, v in STATUS_LABEL.items()) + ". Within a variant, results are listed in order of publication and marked " +
           ", ".join(r"\roletag{%s}" % k for k in ROLE_LABEL) + ".",
           r"\paragraph{Verification.} A variant marked \vstatus{verified} has its bounds checked against the papers; \vstatus{draft} marks entries with something not yet checked, which its notes name.",
           r"\paragraph{Order of the book.} Part~\ref{part:models} opens with the notation (Chapter~\ref{ch:notation}), then introduces the four models and their assumption axes: where each assumption comes from, why the community studies it, and its formal definition. Part~\ref{part:perspectives} reads across problems and models. The remaining parts give the problems, one part per model and one chapter per family, each problem with its statement, assumption tree and every catalogued setting. The appendices collect the open questions, starting with the most consequential, an alphabetical index of every assumption with its definition, the timeline and the bibliography.",
           r"\paragraph{Two orders.} The parts arrange problems logically, by model and family; Appendix~\ref{app:timeline} lists the same material chronologically."]
    return "\n\n".join(out)

def open_questions_appendix():
    out = [r"\chapter{All open questions}\label{app:open}"]
    pri = IDX.get("priorities")
    if pri:
        out.append(r"\section*{The most consequential}\markright{The most consequential}" + "\n" + inline(pri["intro"]))
        essay = next((o for o in OVERVIEWS if o["id"] == RANKING), None)
        unnumbered = [x for x in (essay or {}).get("sections", []) if not re.match(r"\d", x["heading"])]
        if unnumbered:
            out.append("\n\n".join(r"\subsection*{%s}" % esc_plain(x["heading"]) + "\n" + block(x["body"]) for x in unnumbered[:1]))
        items = []
        for it in pri["items"]:
            where = ", ".join(r"\hyperref[%s]{%s}" % (vlabel(PROBLEMS[pid], next(v for v in PROBLEMS[pid]["variants"] if v["id"] == vid)), inline(PROBLEMS[pid]["name"])) for pid, vid in it.get("settings", []) if pid in PROBLEMS and any(v["id"] == vid for v in PROBLEMS[pid]["variants"]))
            items.append(r"\item \textbf{%s.} %s\par\smallskip{\small\textit{Why it matters.} %s}%s" % (inline(it["title"]), inline(it["question"]), inline(it["why"]), (r"\par{\footnotesize\color{muted}Settings: %s.}" % where) if where else ""))
        out.append(r"\begin{enumerate}[leftmargin=1.6em,label=\textcolor{accent}{\sffamily\bfseries\arabic*.},itemsep=6pt]" + "\n" + "\n".join(items) + "\n" + r"\end{enumerate}")
        for x in unnumbered[1:]:
            out.append(r"\subsection*{%s}" % esc_plain(x["heading"]) + "\n" + block(x["body"]))
        out.append(r"\section*{Every open question}\markright{Every open question}")
    out.append("Every open question recorded in the atlas, grouped by problem and ordered along each problem's assumption tree.")
    for pid in IDX["problems"]:
        p = PROBLEMS[pid]
        items = [n for n in p["_order"] if n["variant"] and n["variant"].get("open")]
        if not items:
            continue
        out.append(r"\section*{%s}\markright{%s}" % (pref(p), esc_plain(p["name"])))
        for n in items:
            v = n["variant"]
            out.append(r"\noindent\textbf{\hyperref[%s]{%s}} {\footnotesize\textcolor{muted}{(p.~\pageref{%s})}}" % (vlabel(p, v), inline(v["title"]), vlabel(p, v)) +
                       "\n\\begin{openlist}\n" + "\n".join(r"\item " + inline(q) for q in v["open"]) + "\n\\end{openlist}")
    return "\n\n".join(out)

def ref_year(k):
    r = REFS.get(k, {})
    return r.get("first_year") or r.get("year")

def timeline_appendix():
    events = {}
    def at(y):
        return events.setdefault(y, {"origins": [], "papers": {}})
    for pid in IDX["problems"]:
        p = PROBLEMS[pid]
        if p.get("origin"):
            at(p["origin"]["year"])["origins"].append(p)
        for v in p["variants"]:
            for r in v.get("results", []):
                if r["role"] in ("other", "disputed") or r["ref"] not in REFS:
                    continue
                at(ref_year(r["ref"]))["papers"].setdefault(r["ref"], []).append((p, v, r["role"]))
            for b in v.get("lower_bounds", []):
                if b.get("ref") in REFS:
                    at(ref_year(b["ref"]))["papers"].setdefault(b["ref"], []).append((p, v, "lb"))
    ROLE = {"introductory": "introduced", "best": "current best", "lb": "lower bound"}
    out = [r"\chapter{Timeline}\label{app:timeline}\markright{Timeline}",
           "Each year lists the problems first posed then and the papers that introduced a setting, gave the current best result, or proved a lower bound, dated by their first appearance (usually the conference version)."]
    for y in sorted(events):
        e = events[y]
        out.append(r"\timelineyear{%d}" % y)
        for p in e["origins"]:
            par = parent_of(p)
            when = ""
            if par and par.get("origin"):
                py = par["origin"]["year"]
                when = " which was posed earlier (%d)" % py if py < p["origin"]["year"] else (" posed the same year" if py == p["origin"]["year"] else " but was posed before it (%d)" % py)
                when = r" In the logical view: %s %s,%s." % (esc_plain(p["derived_from"].get("kind") or "derived from"), pref(par), when)
            out.append(r"\begin{originbox}\textbf{%s} is posed in \citet{%s}. %s%s\end{originbox}" % (pref(p), p["origin"]["ref"], inline(p["origin"].get("note", "")), when))
        if e["papers"]:
            items = []
            for ref, its in e["papers"].items():
                byp = {}
                for p, v, role in its:
                    byp.setdefault(p["id"], []).append((p, v, role))
                parts = []
                for lst in byp.values():
                    seen, segs = set(), []
                    for p, v, role in lst:
                        if (v["id"], role) in seen:
                            continue
                        seen.add((v["id"], role))
                        segs.append(r"%s \roletag{%s}" % (inline(v["title"]), role if role != "lb" else "lb"))
                    parts.append(r"%s: %s" % (pref(lst[0][0]), ", ".join(segs)))
                items.append(r"\item \citet{%s} --- %s" % (ref, "; ".join(parts)))
            out.append("\\begin{timelinelist}\n" + "\n".join(items) + "\n\\end{timelinelist}")
    return "\n\n".join(out)

def bibliography():
    keys = sorted(REFS, key=lambda k: (last_name(REFS[k]["authors"][0]) if REFS[k].get("authors") else "", REFS[k].get("year", 0), k))
    items = []
    for k in keys:
        r = REFS[k]
        label = r"%s(%s)" % (esc_plain(cite_names(k)), YEAR_TAG[k])
        authors = ", ".join(r.get("authors", []))
        s = r"\bibitem[%s]{%s} %s%s \newblock %s. \newblock \emph{%s}, %s." % (label, k, esc_plain(authors), "" if authors.endswith(".") else ".", inline(r["title"]), esc_plain(r.get("venue", "")), r.get("year", ""))
        if r.get("journal"):
            s += r" Journal version: \emph{%s}." % esc_plain(r["journal"])
        links = []
        if r.get("doi"):
            links.append(r"\href{https://doi.org/%s}{doi:%s}" % (r["doi"].replace("%", r"\%").replace("#", r"\#"), esc_plain(r["doi"])))
        if r.get("arxiv"):
            links.append(r"\href{https://arxiv.org/abs/%s}{arXiv:%s}" % (r["arxiv"], esc_plain(r["arxiv"])))
        if r.get("url"):
            links.append(r"\url{%s}" % r["url"])
        if links:
            s += " " + ", ".join(links) + "."
        # notes on how a reference was found or checked belong to the site, not the book;
        # only the publication status of a preprint is kept
        if "preprint" in (r.get("note") or "").lower() or "preprint" in (r.get("venue") or "").lower():
            s += r" \newblock {\footnotesize Preprint, not peer reviewed.}"
        items.append(s)
    return "\\begin{thebibliography}{99}\n" + "\n\n".join(items) + "\n\\end{thebibliography}"

def citation_text():
    c = IDX.get("citation", {})
    url = c.get("url") or ""
    s = r"%s. \emph{%s}. Version %s, %s." % (esc_plain(", ".join(c.get("authors", []))), esc_plain(c.get("title", IDX["title"])), esc_plain(c.get("version", "")), c.get("year", ""))
    if url:
        s += r" \url{%s}" % url
    return s

def bibtex():
    c = IDX.get("citation", {})
    lines = [r"@misc{%s%s," % (last_name(c.get("authors", ["Anon"])[0]), c.get("year", "")),
             r"  author = {%s}," % " and ".join(c.get("authors", [])),
             r"  title  = {%s}," % c.get("title", IDX["title"]),
             r"  year   = {%s}," % c.get("year", ""),
             r"  note   = {Version %s}," % c.get("version", "")]
    if c.get("url"):
        lines.append(r"  url    = {%s}," % c["url"])
    lines.append("}")
    return "\n".join(lines)

# ---------------------------------------------------------------- preamble

PREAMBLE = r"""\documentclass[11pt,a4paper,openany]{book}
\usepackage[a4paper,inner=26mm,outer=24mm,top=26mm,bottom=28mm,headsep=9mm,footskip=12mm]{geometry}
\usepackage{fontspec}
\usepackage{unicode-math}
\setmainfont{Libertinus Serif}
\setsansfont{Libertinus Sans}
\setmonofont{Libertinus Mono}[Scale=0.9]
\setmathfont{Libertinus Math}
\usepackage{microtype}
\usepackage[english]{babel}
\usepackage{xcolor}
\definecolor{accent}{HTML}{3553C9}
\definecolor{muted}{HTML}{6B6760}
\definecolor{soft}{HTML}{F3F1EC}
\definecolor{accentsoft}{HTML}{E9EDFB}
\definecolor{tight}{HTML}{2B7A4B}
\definecolor{near}{HTML}{A86C12}
\definecolor{gap}{HTML}{BF2F2F}
\definecolor{unknown}{HTML}{85817A}
\definecolor{impossible}{HTML}{1D1B16}
\definecolor{disputed}{HTML}{8A3FFC}
\usepackage{booktabs,tabularx,longtable,array}
\usepackage{enumitem}
\setlist{itemsep=2pt,topsep=4pt}
\usepackage[skins,breakable]{tcolorbox}
\usepackage{tikz}\usetikzlibrary{shapes.geometric,arrows.meta}
\usepackage{needspace}\usepackage{dirtree}\DTsetlength{0.3em}{1.15em}{0.35em}{0.5pt}{0pt}\renewcommand*\DTstyle{\rmfamily}\renewcommand*\DTstylecomment{\rmfamily}\setlength{\DTbaselineskip}{14pt}
\newenvironment{casetree}{\par\smallskip\begingroup\color{fline}\small}{\endgroup\par\medskip}
% figure palette: black ink, a navy for plain entities, muted print colours where a colour carries meaning
\definecolor{fink}{HTML}{23407A}\definecolor{fgreen}{HTML}{2E7D46}\definecolor{fred}{HTML}{B03A2E}\definecolor{fochre}{HTML}{D29A22}
\definecolor{fgrey}{HTML}{8C8C8C}\definecolor{fviolet}{HTML}{7A4FA3}\definecolor{fsoft}{HTML}{EDEDED}\definecolor{fline}{HTML}{9A9A9A}
\definecolor{flattice}{HTML}{D2D2D2}\definecolor{fghost}{HTML}{8C8C8C}\definecolor{ftrace}{HTML}{6E6E6E}
\definecolor{fone}{HTML}{C0503A}\definecolor{ftwo}{HTML}{2C8A99}\definecolor{fthree}{HTML}{E0B33A}\definecolor{ffour}{HTML}{6A9A3A}
\usepackage{caption}\captionsetup[figure]{font={small,sf},labelfont={bf,color=accent}}
\usepackage{titlesec}
\usepackage{fancyhdr}
\usepackage[round,sort]{natbib}
\setcitestyle{aysep={}}
\usepackage[hidelinks,pdfusetitle,bookmarksnumbered]{hyperref}
\hypersetup{colorlinks=true,linkcolor=accent,citecolor=accent,urlcolor=accent}
PDFMETA
\usepackage{bookmark}
\usepackage{emptypage}
\renewcommand{\bibname}{Bibliography}
\setlength{\parindent}{0pt}\setlength{\parskip}{5pt plus 1pt}\setlength{\emergencystretch}{2.5em}
\titleformat{\part}[display]{\centering\sffamily}{\large\scshape\color{muted}Part \thepart}{14pt}{\Huge\bfseries}
\titleformat{\chapter}[display]{\sffamily}{\large\color{accent}\scshape\chaptertitlename\ \thechapter}{6pt}{\huge\bfseries}[\vspace{2pt}{\color{accent}\titlerule[1pt]}]
\titleformat{name=\chapter,numberless}[display]{\sffamily}{}{0pt}{\huge\bfseries}[\vspace{2pt}{\color{accent}\titlerule[1pt]}]
\titlespacing*{\chapter}{0pt}{10pt}{18pt}
\titleformat{\section}{\sffamily\Large\bfseries}{\color{accent}\thesection}{0.8em}{}
\titleformat{\subsection}{\sffamily\large\bfseries}{\color{accent}\thesubsection}{0.7em}{}
\titleformat{\paragraph}[runin]{\sffamily\bfseries}{}{0pt}{}
\titlespacing*{\paragraph}{0pt}{8pt}{0.6em}
\setcounter{secnumdepth}{2}\setcounter{tocdepth}{1}
\makeatletter\renewcommand*\l@section{\@dottedtocline{1}{1.5em}{3.1em}}\renewcommand*\l@chapter[2]{\addpenalty{-\@highpenalty}\vskip 1.0em plus\p@\setlength\@tempdima{2em}\begingroup\parindent\z@\rightskip\@pnumwidth\parfillskip-\@pnumwidth\leavevmode\bfseries\advance\leftskip\@tempdima\hskip-\leftskip#1\nobreak\hfil\nobreak\hb@xt@\@pnumwidth{\hss#2}\par\penalty\@highpenalty\endgroup}\makeatother
\pagestyle{fancy}\fancyhf{}
\fancyhead[LE]{\sffamily\small\color{muted}\leftmark}
\fancyhead[RO]{\sffamily\small\color{muted}\rightmark}
\fancyfoot[C]{\sffamily\small\thepage}\fancyfoot[R]{\sffamily\tiny\color{muted}AIFOOTER}
\renewcommand{\headrulewidth}{0pt}
\fancypagestyle{plain}{\fancyhf{}\fancyfoot[C]{\sffamily\small\thepage}}
\newcommand{\statusdot}[1]{\textcolor{#1}{\raisebox{0.1ex}{\scalebox{0.85}{●}}}}
\newcommand{\levelbox}[1]{\colorbox{soft}{\sffamily\footnotesize #1}}
\newcommand{\axisheading}[1]{\par\medskip{\sffamily\bfseries #1}\par\nopagebreak\smallskip}
\newcommand{\stdtag}{\colorbox{accentsoft}{\sffamily\scriptsize\color{accent}STANDARD SETTING}}
\newcommand{\vstatus}[1]{\colorbox{soft}{\sffamily\scriptsize\MakeUppercase{#1}}}
\newcommand{\owntag}{\colorbox{soft}{\sffamily\scriptsize own work}}
\newcommand{\roletag}[1]{{\sffamily\scriptsize\color{\csname rolecolor@#1\endcsname}[\csname rolename@#1\endcsname]}}
\expandafter\def\csname rolecolor@introductory\endcsname{accent}\expandafter\def\csname rolename@introductory\endcsname{introductory}
\expandafter\def\csname rolecolor@best\endcsname{tight}\expandafter\def\csname rolename@best\endcsname{current best}
\expandafter\def\csname rolecolor@other\endcsname{muted}\expandafter\def\csname rolename@other\endcsname{also}
\expandafter\def\csname rolecolor@disputed\endcsname{disputed}\expandafter\def\csname rolename@disputed\endcsname{disputed proof}
\expandafter\def\csname rolecolor@lb\endcsname{gap}\expandafter\def\csname rolename@lb\endcsname{lower bound}
\newtcolorbox{summarybox}{enhanced,breakable,colback=soft,colframe=soft,boxrule=0pt,arc=2pt,left=8pt,right=8pt,top=5pt,bottom=5pt,fontupper=\itshape}
\newtcolorbox{settingbox}{enhanced,breakable,colback=white,colframe=soft,boxrule=0.6pt,arc=2pt,left=8pt,right=8pt,top=5pt,bottom=5pt,fontupper=\small}
\newtcolorbox{focusbox}[1]{enhanced,breakable,colback=accentsoft,colframe=accent,boxrule=0pt,leftrule=2.5pt,arc=0pt,left=8pt,top=5pt,bottom=5pt,title={\sffamily\scshape\small #1},coltitle=accent,attach title to upper={\par}}
\newtcolorbox{treebox}{enhanced,breakable,colback=white,colframe=soft,boxrule=0.6pt,arc=2pt,left=6pt,right=6pt,top=4pt,bottom=4pt,fontupper=\small}
\newtcolorbox{originbox}{enhanced,breakable,colback=accentsoft,colframe=accentsoft,boxrule=0pt,arc=2pt,left=8pt,right=8pt,top=4pt,bottom=4pt}
\newtcolorbox{citebox}{enhanced,colback=soft,colframe=accent,boxrule=0pt,leftrule=3pt,arc=0pt,left=10pt,right=10pt,top=8pt,bottom=8pt}
\newcommand{\treeline}[2]{\par\noindent\hspace*{#1}\parbox[t]{\dimexpr\linewidth-#1\relax}{\raggedright #2}\par\vspace{2pt}}
\newenvironment{knowntable}{\par\smallskip\noindent\footnotesize\tabularx{\linewidth}{@{}>{\raggedright\arraybackslash}p{0.12\linewidth}>{\raggedright\arraybackslash}X>{\raggedright\arraybackslash}X>{\raggedright\arraybackslash}p{0.17\linewidth}@{}}\toprule}{\bottomrule\endtabularx\par}
\newenvironment{lbdesc}{\begin{description}[style=nextline,leftmargin=1.2em,font=\normalfont\sffamily\small\bfseries]\small}{\end{description}}
\newenvironment{resultlist}{\begin{itemize}[leftmargin=1.2em]\small}{\end{itemize}}
\newenvironment{openlist}{\begin{enumerate}[leftmargin=1.6em,label=\textcolor{accent}{\sffamily\small Q\arabic*.}]}{\end{enumerate}}
\newenvironment{timelinelist}{\begin{itemize}[leftmargin=1.2em]\small}{\end{itemize}}
\newcommand{\blockhead}[1]{\par\medskip{\sffamily\bfseries #1}\par\nopagebreak}
\newcommand{\timelineyear}[1]{\par\medskip{\sffamily\bfseries\color{accent}\large #1}\par\nopagebreak\smallskip}
\begin{document}
"""

def wrap_bibtex(width=64):
    out = []
    for line in bibtex().split("\n"):
        if len(line) <= width:
            out.append(line); continue
        head, _, rest = line.partition("{")
        indent = " " * (len(head) + 1)
        words, cur = rest.split(" "), head + "{"
        for w in words:
            if len(cur) + 1 + len(w) > width and cur.strip() != (head + "{").strip():
                out.append(cur); cur = indent + w
            else:
                cur = cur + ("" if cur.endswith("{") else " ") + w
        out.append(cur)
    return out

def title_page():
    c = IDX.get("citation", {})
    title = c.get("title", IDX["title"])
    main, _, sub = title.partition(":")
    author = (r"\href{%s}{%s}" % (IDX["owner_url"], esc_plain(", ".join(c.get("authors", [])))) if IDX.get("owner_url") else esc_plain(", ".join(c.get("authors", []))))
    bib = "\n".join(r"\texttt{%s}\\" % esc_plain(l).replace(" ", r"\ ") for l in wrap_bibtex())
    return r"""\begin{titlepage}
\centering\vspace*{40mm}
{\sffamily\fontsize{38}{44}\selectfont\bfseries %s\par}
\vspace{7mm}{\color{accent}\rule{36mm}{1.2pt}\par}
\vspace{7mm}{\sffamily\Large\color{accent} %s\par}
\vspace{12mm}{\large\itshape %s\par}
\vfill
{\Large %s\par}\vspace{3mm}{\color{muted}Last updated %s\par}
\vspace{10mm}{\small\color{muted}\colorbox{accentsoft}{\sffamily\scriptsize\color{accent}AI USE} %s\par}
\vspace*{15mm}
\end{titlepage}
\thispagestyle{empty}\vspace*{\fill}
\noindent{\sffamily\bfseries\large\color{accent}How to cite}\par\medskip
{\raggedright\urlstyle{same}\noindent %s\par}\bigskip
\begin{tcolorbox}[enhanced,colback=soft,colframe=soft,boxrule=0pt,arc=2pt,left=10pt,right=10pt,top=8pt,bottom=8pt,title={\sffamily\small BibTeX},coltitle=muted,colbacktitle=soft,toptitle=2pt,bottomtitle=0pt]
\raggedright\footnotesize\setlength{\parskip}{0pt}
%s
\end{tcolorbox}
\vspace{10mm}
\noindent{\small\color{muted}\raggedright\urlstyle{same}This is a living survey: the website and this book are generated from the same data, and each version is dated. The latest version is at \url{%s}.}
\clearpage
""" % (esc_plain(main.strip()), esc_plain(sub.strip()), esc_plain(IDX.get("tagline", "")), author,
       esc_plain(long_date(c.get("version", ""))), esc_plain(IDX.get("ai_disclaimer", "")), citation_text(), bib, c.get("url", ""))

def main():
    pre = PREAMBLE.replace("AIFOOTER", esc_plain(IDX.get("ai_disclaimer", "")))
    c = IDX.get("citation", {})
    pre = pre.replace("PDFMETA", r"\hypersetup{pdftitle={%s},pdfauthor={%s},pdfsubject={%s},pdfkeywords={mobile agents, mobile robots, programmable matter, distributed computing, open problems, survey},pdfcreator={scripts/build-pdf.py (version %s)}}" % (
        esc_plain(c.get("title", IDX.get("title", ""))), esc_plain(", ".join(c.get("authors", []))), esc_plain(IDX.get("tagline", "")), esc_plain(c.get("version", ""))))
    parts = [pre, title_page(), r"\frontmatter\tableofcontents", acknowledgements(), r"\mainmatter", reading_guide(),
             r"\part{Models and their assumptions}\label{part:models}" + "\n" + r"\noindent What an agent, a robot or a particle can see, remember and do, and what the adversary controls. Each chapter tells how the assumptions of one model fit together, then gives every axis with its origin and formal definitions."]
    parts.append(notation_chapter())
    parts += [model_chapter(mid) for mid in IDX["models"]]
    parts.append(overviews_part())
    for mid in IDX["models"]:
        parts.append(problems_part(mid))
    parts += [r"\appendix", r"\part*{Appendices}", open_questions_appendix(), assumptions_appendix(), timeline_appendix(),
              r"\backmatter", r"\cleardoublepage\phantomsection\addcontentsline{toc}{chapter}{Bibliography}\markboth{Bibliography}{Bibliography}", r"\setlength{\bibsep}{4pt plus 1pt}\small", bibliography(), r"\end{document}"]
    BUILD.mkdir(exist_ok=True)
    tex = BUILD / "atlas.tex"
    tex.write_text("\n\n".join(parts), encoding="utf-8")
    print(f"wrote {tex.relative_to(ROOT)}")
    if "--tex-only" in sys.argv:
        return
    for _ in range(3):
        r = subprocess.run(["lualatex", "-interaction=nonstopmode", "-halt-on-error", "atlas.tex"], cwd=BUILD, capture_output=True, text=True)
        if r.returncode != 0:
            log = (BUILD / "atlas.log").read_text(encoding="utf-8", errors="replace")
            err = [l for l in log.splitlines() if l.startswith("!")]
            i = log.find("\n!")
            print(log[i:i + 1500] if i >= 0 else r.stdout[-3000:])
            sys.exit(1)
    pdf = ROOT / IDX.get("citation", {}).get("pdf", "atlas.pdf")
    pdf.write_bytes((BUILD / "atlas.pdf").read_bytes())
    print(f"wrote {pdf.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
