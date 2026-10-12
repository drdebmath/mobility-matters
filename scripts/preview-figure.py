#!/usr/bin/env python3
"""Draw every frame of a problem's figure side by side, to check an animation by eye.

    python3 scripts/preview-figure.py dispersion            # writes build/preview/dispersion.html and .png
The PNG is made with headless Microsoft Edge (or Chrome) when available. Frames are
numbered; entities sharing a node are drawn on a small ring, as on the site.
"""
import html, json, math, shutil, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COL = {"accent": "#2f4fd1", "tight": "#2e8b57", "gap": "#c0392b", "near": "#d4a017", "muted": "#888", "fg": "#222",
       "disputed": "#8e44ad", "l1": "#e4572e", "l2": "#17bebb", "l3": "#ffc914", "l4": "#76b041", "soft": "#eee", "line": "#bbb"}
col = lambda c, d="accent": COL.get(c or d, c or COL[d])


def point(fig, e):
    if e.get("at") and fig.get("graph"):
        return fig["graph"]["nodes"][e["at"]]
    if e.get("lat"):
        u = fig.get("unit", 8); o = fig.get("origin", [0, 0]); i, j = e["lat"]
        return [o[0] + u * (i + j / 2), o[1] + u * j * 3 ** 0.5 / 2]
    return e.get("p", [0, 0])


def frame_svg(fig, f, n):
    W, H = fig.get("view", [100, 60])
    Y = lambda y: H - y
    out = [f'<svg viewBox="-2 -2 {W + 4} {H + 4}" width="360">']
    def shape(sh):
        c, w = col(sh.get("c"), "line"), sh.get("w", 0.6)
        P = lambda q: point(fig, q) if isinstance(q, dict) else q
        t = sh.get("t")
        if t == "circle":
            x, y = P(sh["p"]); return f'<circle cx="{x}" cy="{Y(y)}" r="{sh["r"]}" stroke="{c}" stroke-width="{w}" fill="{col(sh["fill"]) if sh.get("fill") else "none"}"/>'
        if t in ("line", "path", "poly"):
            pts = " ".join(f"{P(q)[0]},{Y(P(q)[1])}" for q in sh["p"])
            tag = "polygon" if t == "poly" else "polyline"
            return f'<{tag} points="{pts}" stroke="{c}" stroke-width="{w}" fill="none" {"stroke-dasharray=\"1.5 1\"" if sh.get("dash") else ""}/>'
        if t == "node":
            x, y = fig["graph"]["nodes"][sh["n"]]; return f'<circle cx="{x}" cy="{Y(y)}" r="{sh.get("r", 2.2)}" fill="{col(sh.get("fill"), "fg")}"/>'
        if t == "star":
            x, y = P(sh["p"]); return f'<text x="{x}" y="{Y(y) + 1.5}" font-size="{2 * sh.get("r", 2.4)}" text-anchor="middle" fill="{col(sh.get("c"), "near")}">★</text>'
        if t == "rect":
            x, y = P(sh["p"]); wd, ht = sh.get("wd", 3), sh.get("ht", 3); return f'<rect x="{x - wd / 2}" y="{Y(y) - ht / 2}" width="{wd}" height="{ht}" stroke="{c}" stroke-width="{w}" fill="{col(sh["fill"]) if sh.get("fill") else "none"}"/>'
        if t == "text":
            x, y = P(sh["p"]); return f'<text x="{x}" y="{Y(y)}" font-size="{sh.get("size", 3.2)}" fill="{col(sh.get("c"), "muted")}" text-anchor="middle">{html.escape(sh["s"].replace("$", ""))}</text>'
        return ""
    out += [shape(s) for s in fig.get("static", [])]
    g = fig.get("graph")
    if g:
        for a, b in g.get("edges", []):
            (x1, y1), (x2, y2) = g["nodes"][a], g["nodes"][b]
            out.append(f'<line x1="{x1}" y1="{Y(y1)}" x2="{x2}" y2="{Y(y2)}" stroke="#bbb" stroke-width="0.6"/>')
        for k, (x, y) in g["nodes"].items():
            out.append(f'<circle cx="{x}" cy="{Y(y)}" r="1.4" fill="#fff" stroke="#888" stroke-width="0.4"/><text x="{x + 2}" y="{Y(y) - 2}" font-size="2.6" fill="#999">{k}</text>')
    out += [shape(s) for s in f.get("marks", [])]
    by = {}
    for e in f.get("ents", []):
        if (e.get("at") or e.get("lat")) and not e.get("p"):
            by.setdefault(e.get("at") or tuple(e["lat"]), []).append(e["id"])
    for e in f.get("ents", []):
        x, y = point(fig, e)
        grp = by.get(e.get("at") or (tuple(e["lat"]) if e.get("lat") else None), [])
        if len(grp) > 1:
            j = grp.index(e["id"]); a = math.pi / 2 + 2 * math.pi * j / len(grp); r = fig.get("cluster", 3.2)
            x, y = x + r * math.cos(a), y + r * math.sin(a)
        c, k = col(e.get("c")), e.get("k", "robot")
        r = e.get("r", 2.6 if k == "particle" else 3.2 if k == "tile" else 1.9)
        if e.get("qlat") or e.get("q"):
            qx, qy = point(fig, {"lat": e["qlat"]}) if e.get("qlat") else e["q"]
            out.append(f'<line x1="{x}" y1="{Y(y)}" x2="{qx}" y2="{Y(qy)}" stroke="{c}" stroke-width="{2 * r}" stroke-linecap="round"/>')
        if k == "target":
            out.append(f'<text x="{x}" y="{Y(y) + 1.5}" font-size="5" text-anchor="middle" fill="{c}">★</text>')
        elif k == "exit":
            out.append(f'<rect x="{x - r}" y="{Y(y) - r}" width="{2 * r}" height="{2 * r}" fill="{c}"/>')
        elif k == "crashed":
            out.append(f'<circle cx="{x}" cy="{Y(y)}" r="{r}" fill="#fff" stroke="{c}" stroke-width="0.5"/><text x="{x}" y="{Y(y) + 1}" font-size="3" text-anchor="middle" fill="{c}">×</text>')
        else:
            out.append(f'<circle cx="{x}" cy="{Y(y)}" r="{r}" fill="{c}"/>')
        if e.get("l"):
            out.append(f'<text x="{x}" y="{Y(y) + 0.9}" font-size="2.4" fill="#fff" text-anchor="middle">{html.escape(str(e["l"]))}</text>')
    out.append("</svg>")
    lab = html.escape((f.get("label") or "").replace("$", ""))
    return f'<div class="fr"><div class="n">{n}{" · " + lab if lab else ""}</div>{"".join(out)}</div>'


def main():
    pid = sys.argv[1]
    p = json.loads((ROOT / f"data/problems/{pid}.json").read_text())
    fig = p["figure"]
    d = ROOT / "build" / "preview"; d.mkdir(parents=True, exist_ok=True)
    page = d / f"{pid}.html"
    frames = "".join(frame_svg(fig, f, i + 1) for i, f in enumerate(fig["frames"]))
    page.write_text(f'<!doctype html><meta charset="utf-8"><style>body{{font:12px sans-serif;margin:8px;background:#fff}}.g{{display:flex;flex-wrap:wrap;gap:6px}}.fr{{border:1px solid #ddd;padding:3px}}.n{{color:#555;max-width:360px}}</style><h3>{html.escape(pid)}: {len(fig["frames"])} frames</h3><p style="max-width:1100px">{html.escape(fig.get("caption", ""))}</p><div class="g">{frames}</div>')
    rows = math.ceil(len(fig["frames"]) / 3)
    browser = next((b for b in ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", shutil.which("chromium")] if b and Path(b).exists()), None)
    if browser:
        png = d / f"{pid}.png"
        subprocess.run([browser, "--headless=new", "--disable-gpu", f"--window-size=1140,{140 + rows * 250}", f"--screenshot={png}", page.as_uri()], capture_output=True, timeout=120)
        print(f"wrote {png.relative_to(ROOT)}")
    print(f"wrote {page.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
