#!/usr/bin/env python3
"""Build a single self-contained HTML file of the catalogue.

    python3 scripts/build-artifact.py OUT.html          # fragment for the claude.ai Artifact host
    python3 scripts/build-artifact.py OUT.html --full   # standalone page (works from file://)

The fragment has no <html>/<head>/<body> tags (the Artifact host adds them). Both
outputs inline the stylesheet, the KaTeX stylesheet with its fonts as data URIs,
all catalogue data, and the renderer. In the fragment KaTeX and Marked load from
cdnjs, which the Artifact host allows; the --full page inlines them too, so it
works offline (only the web fonts need a connection; without one the page falls
back to system fonts). Routes use dot-separated anchors
(#problem.dispersion.base) because that host only passes plain anchors through.
KaTeX assets are cached under scripts/.cache/katex/.
"""
import base64
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / ".cache" / "katex"
KATEX = "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11"
MARKED = "https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js"
FONTS_CSS = "https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&family=Inter:wght@400;500;600&display=swap"


def fetch(url, dest):
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(url, timeout=60) as r:
            dest.write_bytes(r.read())
    return dest.read_bytes()


def katex_css_inlined():
    css = fetch(f"{KATEX}/katex.min.css", CACHE / "katex.min.css").decode("utf-8")
    # keep only the woff2 source of every @font-face, embedded as a data URI
    def repl(m):
        name = m.group(1)
        data = base64.b64encode(fetch(f"{KATEX}/fonts/{name}.woff2", CACHE / f"{name}.woff2")).decode("ascii")
        return f'src:url(data:font/woff2;base64,{data}) format("woff2")'
    css = re.sub(r'src:url\(fonts/([A-Za-z0-9_-]+)\.woff2\) format\("woff2"\)(?:,url\([^)]*\) format\("[a-z]+"\))*', repl, css)
    assert "url(fonts/" not in css, "unexpected font reference left in KaTeX CSS"
    return css


def body_markup():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    body = re.search(r"<body>(.*)</body>", html, re.S).group(1)
    body = re.sub(r'\s*<script src="assets/app\.js(?:\?v=[0-9a-f]+)?"></script>', "", body)
    return body.strip()


def data_bundle():
    index = json.loads((ROOT / "data/index.json").read_text(encoding="utf-8"))
    bundle = {
        "index": index,
        "models": {m: json.loads((ROOT / f"data/models/{m}.json").read_text(encoding="utf-8")) for m in index["models"]},
        "problems": {p: json.loads((ROOT / f"data/problems/{p}.json").read_text(encoding="utf-8")) for p in index["problems"]},
        "references": json.loads((ROOT / "data/references.json").read_text(encoding="utf-8")),
    }
    if (ROOT / "data/acknowledgements.json").exists():
        bundle["acknowledgements"] = json.loads((ROOT / "data/acknowledgements.json").read_text(encoding="utf-8"))
    if (ROOT / "data/notation.json").exists():
        bundle["notation"] = json.loads((ROOT / "data/notation.json").read_text(encoding="utf-8"))
    if (ROOT / "data/overviews").exists():
        bundle["overviews"] = {f.stem: json.loads(f.read_text(encoding="utf-8")) for f in sorted((ROOT / "data/overviews").glob("*.json"))}
    return json.dumps(bundle, ensure_ascii=False).replace("</", "<\\/")


def build(full):
    index = json.loads((ROOT / "data/index.json").read_text(encoding="utf-8"))
    title = index.get("title", "Open Problems Catalogue")
    style = (ROOT / "assets/style.css").read_text(encoding="utf-8")
    app = (ROOT / "assets/app.js").read_text(encoding="utf-8")
    assert "</script" not in app
    parts = [
        f"<title>{title}</title>",
        f'<link rel="stylesheet" href="{FONTS_CSS}">',
        "<style>\n" + katex_css_inlined() + "\n" + style + "\n</style>",
        f'<script src="{KATEX}/katex.min.js"></script>',
        f'<script src="{MARKED}"></script>',
        "<script>window.CATALOGUE_DATA = " + data_bundle() + ";\nwindow.CATALOGUE_HASH_SEP = '.';</script>",
        body_markup(),
        "<script>\n" + app + "\n</script>",
    ]
    if full:
        # standalone: inline KaTeX and Marked too, so the file works offline
        katex_js = fetch(f"{KATEX}/katex.min.js", CACHE / "katex.min.js").decode("utf-8")
        marked_js = fetch(MARKED, CACHE / "marked.min.js").decode("utf-8")
        assert "</script" not in katex_js and "</script" not in marked_js
        parts[3] = "<script>\n" + katex_js + "\n</script>"
        parts[4] = "<script>\n" + marked_js + "\n</script>"
    out = "\n".join(parts) + "\n"
    if full:
        out = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
               '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
               + "\n".join(parts[:3]) + "\n</head>\n<body>\n" + "\n".join(parts[3:]) + "\n</body>\n</html>\n")
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__)
        return 2
    out = Path(args[0])
    out.parent.mkdir(parents=True, exist_ok=True)
    html = build("--full" in sys.argv)
    out.write_text(html, encoding="utf-8")
    print(f"wrote {out} ({len(html.encode('utf-8')) / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
