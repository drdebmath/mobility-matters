#!/usr/bin/env python3
"""Decision portal for the catalogue owner.

    python3 scripts/portal.py            # then open http://localhost:8766/portal/

Serves the repository as static files and exposes a tiny JSON API:
  GET  /api/decisions          -> data/decisions.json
  POST /api/decisions/<id>     -> body {"choice", "other", "note"}; stored in data/decisions.json
Only listens on 127.0.0.1. Standard library only. The public site (GitHub Pages)
cannot write; this portal is for local use.
"""
import json, os, sys, tempfile, datetime
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILE = ROOT / "data" / "decisions.json"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8766


def load():
    return json.loads(FILE.read_text(encoding="utf-8"))


def save(data):
    fd, tmp = tempfile.mkstemp(dir=FILE.parent, suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, FILE)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split("?")[0] == "/api/decisions":
            return self.send_json(load())
        return super().do_GET()

    def do_POST(self):
        if not self.path.startswith("/api/decisions/"):
            return self.send_json({"error": "not found"}, 404)
        qid = self.path.rsplit("/", 1)[-1]
        try:
            n = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return self.send_json({"error": "bad JSON"}, 400)
        data = load()
        q = next((x for x in data["questions"] if x["id"] == qid), None)
        if not q:
            return self.send_json({"error": f"unknown question {qid}"}, 404)
        ids = {o["id"] for o in q["options"]}
        choice = body.get("choice")
        if choice not in ids and choice != "other" and choice is not None:
            return self.send_json({"error": "unknown option"}, 400)
        if choice is None and not (body.get("other") or "").strip():
            q["decision"] = None
        else:
            q["decision"] = {"choice": choice, "other": (body.get("other") or "").strip(),
                             "note": (body.get("note") or "").strip(), "applied": False,
                             "at": datetime.datetime.now().astimezone().isoformat(timespec="seconds")}
        save(data)
        return self.send_json({"ok": True, "question": q})

    def log_message(self, fmt, *args):
        sys.stderr.write("portal: " + fmt % args + "\n")


if __name__ == "__main__":
    try:
        server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError:
        print(f"Port {PORT} is busy: a portal is probably already running. Open http://localhost:{PORT}/portal/")
        print(f"(or start another one with: python3 scripts/portal.py <port>)")
        sys.exit(0)
    print(f"Decision portal: http://localhost:{PORT}/portal/   (writes {FILE.relative_to(ROOT)})")
    server.serve_forever()
