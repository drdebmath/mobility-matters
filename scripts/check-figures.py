#!/usr/bin/env python3
"""Check that every problem figure moves its entities the way the model allows.

* Graph figures: an agent or robot is always on a node (`at`); between two
  consecutive frames it stays or crosses ONE edge (along its direction if the graph
  is directed). Several entities may share a node (they are drawn on a ring).
* Lattice figures (programmable matter): a particle is on a lattice point (`lat`),
  expanded particles name their head with `qlat`, which must be adjacent to `lat`;
  between frames a particle stays, expands into an adjacent point, or contracts into
  its head or tail; no two particles occupy the same point.
* Continuous figures (robots in the plane, search domains): positions are free; for
  search domains (`fig.maxstep`, default 14% of the view width) a robot moves at
  most that far per frame, so paths along a boundary are drawn as paths.
Every figure needs a label on its first and last frame. Usage: python3 scripts/check-figures.py [problem ...]
"""
import json, math, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MOVERS = {None, "robot", "agent", "particle", "tile", "crashed"}
LAT_NB = {(1, 0), (-1, 0), (0, 1), (0, -1), (1, -1), (-1, 1)}


def check(pid, fig, model):
    errs = []
    F = fig.get("frames", [])
    if len(F) < 2:
        return errs
    if not F[0].get("label") or not F[-1].get("label"):
        errs.append("the first and last frames need a label")
    g = fig.get("graph")
    adj = set()
    if g:
        for a, b in g.get("edges", []):
            adj.add((a, b))
            if not g.get("directed"):
                adj.add((b, a))
    W = fig.get("view", [100, 60])[0]
    maxstep = fig.get("maxstep", 0.14 * W) if model == "search-in-geometric-domains" else None
    for i in range(len(F) - 1):
        A = {e["id"]: e for e in F[i].get("ents", [])}
        B = {e["id"]: e for e in F[i + 1].get("ents", [])}
        if not g and any(e.get("lat") for e in B.values()):
            occ = {}
            for e in B.values():
                if e.get("k") in ("particle", "tile") and e.get("lat"):
                    for q in [tuple(e["lat"])] + ([tuple(e["qlat"])] if e.get("qlat") else []):
                        if q in occ:
                            errs.append(f"frame {i + 2}: {e['id']} and {occ[q]} occupy lattice point {list(q)}")
                        occ[q] = e["id"]
        for eid, b in B.items():
            a = A.get(eid)
            if not a or b.get("k") not in MOVERS:
                continue
            where = f"frame {i + 1}->{i + 2}, entity {eid}"
            if g:
                if b.get("k") in ("tile",):
                    continue
                if not a.get("at") or not b.get("at"):
                    errs.append(f"{where}: on a graph, place entities with 'at' (a node), not free coordinates")
                    continue
                if a["at"] != b["at"] and (a["at"], b["at"]) not in adj:
                    errs.append(f"{where}: jumps from {a['at']} to {b['at']}, which is not an edge{' (in that direction)' if g.get('directed') else ''}")
            elif b.get("lat") and a.get("lat"):
                pa = {tuple(a["lat"])} | ({tuple(a["qlat"])} if a.get("qlat") else set())
                pb = {tuple(b["lat"])} | ({tuple(b["qlat"])} if b.get("qlat") else set())
                if b.get("qlat") and tuple(x - y for x, y in zip(b["qlat"], b["lat"])) not in LAT_NB:
                    errs.append(f"{where}: head {b['qlat']} is not adjacent to tail {b['lat']}")
                ok = (pb <= pa) or (len(pb - pa) == 1 and len(pa) == 1 and len(pb) == 2)  # stay, contract, or expand by one
                if not ok:
                    near = all(any(tuple(x - y for x, y in zip(q, p)) in LAT_NB or q == p for p in pa) for q in pb)
                    if not near:
                        errs.append(f"{where}: moves from {sorted(pa)} to {sorted(pb)}, more than one lattice step")
            elif maxstep and (b.get("p") and a.get("p")):
                d = math.dist(a["p"], b["p"])
                if d > maxstep + 1e-6:
                    errs.append(f"{where}: moves {d:.1f} units in one frame (max {maxstep:.1f}); add intermediate frames along its path")
    return errs


def main():
    idx = json.loads((ROOT / "data/index.json").read_text())
    ids = sys.argv[1:] or idx["problems"]
    total = 0
    for pid in ids:
        p = json.loads((ROOT / f"data/problems/{pid}.json").read_text())
        if not p.get("figure"):
            continue
        errs = check(pid, p["figure"], p["model"])
        total += len(errs)
        for e in errs:
            print(f"{pid}: {e}")
    print(f"{len(ids)} problems checked; {total} figure error(s)")
    sys.exit(1 if total else 0)


if __name__ == "__main__":
    main()
