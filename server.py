from __future__ import annotations
from pathlib import Path
import json
from typing import Dict, List, Tuple, Optional
import math
import heapq

import numpy as np
import uvicorn
import networkx as nx
from sklearn.neighbors import KDTree

from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

# ---------- Paths / App ----------
ROOT = Path(__file__).parent.resolve()
INDEX_HTML = ROOT / "index.html"
SITE_JSON = ROOT / "site_navgraph.json"   # keep your filename
DEST_JSON = ROOT / "destinations.json"

DOORS_JSON = ROOT / "doors_auto.json"
DOORS = []
DOOR_KDTREE = None

def load_doors():
    global DOORS, DOOR_KDTREE
    try:
        if DOORS_JSON.exists():
            data = json.loads(DOORS_JSON.read_text())
            DOORS = data.get("doors", [])
            if DOORS:
                import numpy as _np
                pts = _np.array([d["pos"] for d in DOORS], dtype=_np.float32)
                from sklearn.neighbors import KDTree as _KD
                DOOR_KDTREE = _KD(pts)
                print(f"[navmesh] loaded {len(DOORS)} auto-detected doors")
            else:
                DOOR_KDTREE = None
        else:
            DOOR_KDTREE = None
    except Exception as e:
        print("[navmesh] door load failed:", e)
        DOORS = []; DOOR_KDTREE = None
    # exits/shelters saved here

app = FastAPI(title="Ark Active Threat – Phase 1.2", version="route-1.2")
load_doors()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

# ---------- Graph load ----------
def load_navgraph(path: Path):
    if not path.exists():
        raise FileNotFoundError(f"Navgraph JSON not found: {path}")
    with open(path, "r") as f:
        site = json.load(f)

    G = nx.Graph()
    node_ids: List[int] = []
    node_xy: List[Tuple[float,float]] = []

    for n in site["nodes"]:
        nid = int(n["id"])
        x = float(n["x"]); y = float(n["y"])
        G.add_node(nid, pos=(x, y))
        node_ids.append(nid)
        node_xy.append((x, y))

    for e in site["edges"]:
        u = int(e["from"]); v = int(e["to"]); w = float(e["length"])
        if u != v:
            # store geometric length; we’ll compute risk-aware weight dynamically
            G.add_edge(u, v, length=w)

    node_xy = np.array(node_xy, dtype=np.float64)
    kdt = KDTree(node_xy)

    # Compute bbox_xy if missing
    xs = node_xy[:,0]; ys = node_xy[:,1]
    bbox_xy = {"min":[float(xs.min()), float(ys.min())], "max":[float(xs.max()), float(ys.max())]}
    site.setdefault("bbox_xy", bbox_xy)

    return G, node_ids, node_xy, kdt, site

G, NODE_IDS, NODE_XY, NODE_KD, SITE_META = load_navgraph(SITE_JSON)
NODE_POS: Dict[int, Tuple[float,float]] = {n: G.nodes[n]["pos"] for n in G.nodes}

def nearest_node(x: float, y: float) -> int:
    dist, idx = NODE_KD.query([[x, y]], k=1, return_distance=True)
    return NODE_IDS[int(idx[0][0])]

# ---------- Destinations (exits & shelters) ----------
def load_destinations() -> Dict[str, List[Dict]]:
    if DEST_JSON.exists():
        with open(DEST_JSON, "r") as f:
            return json.load(f)
    return {"exits": [], "shelters": []}

def save_destinations(d: Dict):
    with open(DEST_JSON, "w") as f:
        json.dump(d, f, indent=2)

DEST = load_destinations()

# ---------- Risk-aware A* ----------
# Exposure preference: longer-but-safer routes are favored.
W_EXPOSE = 120.0   # tune: 80–200
# NOTE: Without wall/door geometry in Phase 1.1, we approximate exposure
# by proximity to the threat: edges closer to the threat get a higher cost.
# (When walls/doors arrive, replace exposure_score() with LOS-informed logic.)

def edge_midpoint(u: int, v: int) -> Tuple[float,float]:
    ax, ay = NODE_POS[u]; bx, by = NODE_POS[v]
    return (0.5*(ax+bx), 0.5*(ay+by))

def exposure_score(u: int, v: int, tx: float, ty: float) -> float:
    mx, my = edge_midpoint(u, v)
    # inverse-distance style: 0 at far distance, climbs when near the threat
    d = math.hypot(mx - tx, my - ty)
    # Smooth bounded score: ~2.0 when very close; <0.1 beyond ~10m
    return 2.0 / (1.0 + d)


def edge_near_door(ax: float, ay: float, bx: float, by: float, thresh: float=0.8) -> bool:
    """Return True if the segment comes within `thresh` meters of any auto-detected door center."""
    global DOOR_KDTREE, DOORS
    if DOOR_KDTREE is None or not DOORS:
        return False
    # sample midpoint for quick check; if close we accept
    import numpy as _np
    mx, my = 0.5*(ax+bx), 0.5*(ay+by)
    dists, idxs = DOOR_KDTREE.query(_np.array([[mx,my]], dtype=_np.float32), k=1)
    return float(dists[0][0]) <= thresh
def a_star_risk_aware(
    G: nx.Graph,
    start_id: int,
    goal_ids: set[int],
    threat_xy: Tuple[float,float],
    hard_forbid=None
) -> Optional[List[int]]:
    tx, ty = threat_xy
    # Heuristic: Euclidean distance to nearest goal (admissible)
    goals = list(goal_ids)
    def h(n: int) -> float:
        x, y = NODE_POS[n]
        # nearest goal
        best = min(math.hypot(x - NODE_POS[g][0], y - NODE_POS[g][1]) for g in goals)
        return best

    openq = []
    heapq.heappush(openq, (0.0, start_id))
    came_from: Dict[int, Optional[int]] = {start_id: None}
    g_cost: Dict[int, float] = {start_id: 0.0}

    while openq:
        _, curr = heapq.heappop(openq)
        if curr in goal_ids:
            # reconstruct
            path = [curr]
            while came_from[path[-1]] is not None:
                path.append(came_from[path[-1]])
            path.reverse()
            return path

        for nbr in G.neighbors(curr):
            e = G[curr][nbr]
            if hard_forbid and hard_forbid(curr, nbr, e):
                continue

            length = float(e.get("length", 1.0))
            exposure = exposure_score(curr, nbr, tx, ty)
            step_cost = length + W_EXPOSE * exposure

            tentative = g_cost[curr] + step_cost
            if tentative < g_cost.get(nbr, float("inf")):
                came_from[nbr] = curr
                g_cost[nbr] = tentative
                f = tentative + h(nbr)
                heapq.heappush(openq, (f, nbr))

    return None

def polyline_for_path(path_nodes: List[int]) -> List[List[float]]:
    return [list(NODE_POS[n]) for n in path_nodes]

# ---------- Routes / API ----------
@app.get("/")
def index():
    return FileResponse(INDEX_HTML)

@app.get("/health")
def health():
    return {
        "ok": True,
        "engine": "risk-aware",
        "nodes": int(G.number_of_nodes()),
        "edges": int(G.number_of_edges()),
        "units": "meters"
    }

@app.get("/site/meta")
def site_meta():
    """Return navgraph metadata for frontend scaling."""
    bbox = SITE_META.get("bbox_xy", None)
    return {
        "units": "meters",
        "bbox_xy": bbox,
        "nodes": int(G.number_of_nodes()),
        "edges": int(G.number_of_edges())
    }

@app.get("/destinations")
def get_destinations():
    """Return exits and shelters stored on disk."""
    global DEST
    return DEST

@app.post("/destinations")
async def save_destinations_api(request: Request):
    """
    Body: { "exits":[{id,x,y},{...}], "shelters":[{id,x,y},{...}] }
    Saves to destinations.json for reuse.
    """
    global DEST
    body = await request.json()
    exits = body.get("exits", [])
    shelters = body.get("shelters", [])
    if not isinstance(exits, list) or not isinstance(shelters, list):
        raise HTTPException(400, "Bad payload: exits[] and shelters[] required")
    DEST = {"exits": exits, "shelters": shelters}
    save_destinations(DEST)
    return {"ok": True, "counts": {"exits": len(exits), "shelters": len(shelters)}}

@app.post("/route")  # kept for manual start/goal testing UI
async def route_simple(request: Request):
    """
    Body: { "start": {"x","y"}, "goal": {"x","y"} }
    """
    body = await request.json()
    start = body.get("start")
    goal  = body.get("goal")
    if not start or not goal:
        raise HTTPException(400, "Provide start & goal: {start:{x,y}, goal:{x,y}} (meters)")

    s_id = nearest_node(float(start["x"]), float(start["y"]))
    g_id = nearest_node(float(goal["x"]),  float(goal["y"]))

    try:
        # plain shortest (distance only) for continuity
        path = nx.shortest_path(G, s_id, g_id, weight="length")
        length = nx.shortest_path_length(G, s_id, g_id, weight="length")
    except nx.NetworkXNoPath:
        raise HTTPException(409, "No path found between start and goal")

    return {
        "decision": "EVACUATE",
        "route": polyline_for_path(path),
        "length_m": float(length),
        "units": "meters"
    }

@app.post("/route_safe")
async def route_safe(request: Request):
    """
    Body:
    {
      "start":  {"x","y"},           // viewer/camera XY in meters
      "threat": {"x","y"},           // threat pin XY in meters
      "prefer": "exit" | "shelter"   // optional; default "exit"
    }

    Returns:
    {
      "decision": "EVACUATE" | "SHELTER",
      "target_kind": "exit" | "shelter",
      "target_id": "<id>",
      "route": [[x,y], ...],
      "length_m": float,
      "units": "meters"
    }
    """
    body = await request.json()
    start = body.get("start")
    threat = body.get("threat")
    prefer = (body.get("prefer") or "exit").lower()
    if not start or not threat:
        raise HTTPException(400, "Provide {start:{x,y}} and {threat:{x,y}}")

    s_id = nearest_node(float(start["x"]), float(start["y"]))
    txy = (float(threat["x"]), float(threat["y"]))

    # Build candidate goals
    if prefer not in ("exit", "shelter"):
        prefer = "exit"
    primary = "exits" if prefer == "exit" else "shelters"
    secondary = "shelters" if primary == "exits" else "exits"

    def choose_and_solve(kind: str) -> Optional[Tuple[str, List[int]]]:
        best = None
        goals = []
        for rec in DEST.get(kind, []):
            gid = nearest_node(float(rec["x"]), float(rec["y"]))
            goals.append((rec["id"], gid))
        if not goals:
            return None
        goal_ids = {gid for _, gid in goals}
        path = a_star_risk_aware(G, s_id, goal_ids, txy)
        if path is None:
            return None
        # pick which goal we actually hit
        last = path[-1]
        hit_id = next((rid for rid, gid in goals if gid == last), f"{kind}-node-{last}")
        return (hit_id, path)

    # try primary (exits), then fallback (shelters)
    hit = choose_and_solve(primary)
    decision = "EVACUATE" if primary == "exits" else "SHELTER"
    target_kind = "exit" if primary == "exits" else "shelter"
    if hit is None:
        hit = choose_and_solve(secondary)
        decision = "SHELTER" if secondary == "shelters" else "EVACUATE"
        target_kind = "shelter" if secondary == "shelters" else "exit"

    if hit is None:
        raise HTTPException(409, "No safe route to exits or shelters")

    rid, path_nodes = hit
    length = 0.0
    for a,b in zip(path_nodes, path_nodes[1:]):
        length += float(G[a][b].get("length", 1.0))

    return {
        "decision": decision,
        "target_kind": target_kind,
        "target_id": rid,
        "route": polyline_for_path(path_nodes),
        "length_m": float(length),
        "units": "meters"
    }

# ---------- Entrypoint ----------

@app.get("/nav/doors_auto")
def api_doors_auto():
    load_doors()
    return {"count": len(DOORS), "doors": DOORS}

@app.post("/route/navmesh")
async def route_navmesh(req: Request):
    data = await req.json()
    tx, ty = data.get("threat_xy", [None, None])
    mode = (data.get("mode", "EVAC") or "EVAC").upper()
    if tx is None or ty is None:
        raise HTTPException(400, "missing threat_xy")

    # choose targets by mode
    kind = "exits" if mode == "EVAC" else "shelters"
    recs = DEST.get(kind, [])
    if not recs:
        kind = "shelters" if kind == "exits" else "exits"
        recs = DEST.get(kind, [])
    if not recs:
        raise HTTPException(409, "No destinations available")

    goal_ids = set(nearest_node(float(r["x"]), float(r["y"])) for r in recs)

    start_xy = data.get("start_xy", None)
    if start_xy is None:
        start_id = nearest_node(float(tx), float(ty))
    else:
        sx, sy = start_xy
        start_id = nearest_node(float(sx), float(sy))

    LSHORT = float(data.get("lshort", 2.2))
    DOOR_THRESH = float(data.get("door_thresh", 0.9))
    load_doors()

    def forbid(u,v,e):
        L = float(e.get("length", 1.0))
        if L <= LSHORT:
            return False
        ax, ay = NODE_POS[u]; bx, by = NODE_POS[v]
        return not edge_near_door(ax,ay,bx,by, DOOR_THRESH)

    path_nodes = a_star_risk_aware(G, start_id, goal_ids, (float(tx),float(ty)), hard_forbid=forbid)
    if not path_nodes:
        raise HTTPException(404, "no path found under navmesh-portal constraints")

    poly = polyline_for_path(path_nodes)
    length = 0.0
    for a,b in zip(path_nodes, path_nodes[1:]):
        length += float(G[a][b].get("length", 1.0))
    return {"decision": "EVACUATE" if kind=="exits" else "SHELTER", "route": poly, "length_m": float(length), "units":"meters", "using":"navmesh_prototype", "doors_considered": len(DOORS)}


if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=7860, reload=False)

# ---------- Risk scoring (length + exposure) ----------
def polyline_length(poly):
    L = 0.0
    for (ax,ay),(bx,by) in zip(poly, poly[1:]):
        L += math.hypot(bx-ax, by-ay)
    return L

def sample_along(poly, step=1.0):
    if not poly or len(poly) < 2:
        return []
    pts = []
    for (ax,ay),(bx,by) in zip(poly, poly[1:]):
        seg_len = math.hypot(bx-ax, by-ay)
        if seg_len < 1e-6: continue
        n = max(1, int(seg_len / step))
        for i in range(n):
            t = (i / n)
            pts.append((ax + t*(bx-ax), ay + t*(by-ay)))
    pts.append(tuple(poly[-1]))
    return pts

def risk_of_polyline(poly, threat_xy, alpha=1.0, beta=25.0, step=1.0):
    L = polyline_length(poly)
    ex = 0.0
    visible_dists = []
    tx, ty = threat_xy
    for (x,y) in sample_along(poly, step=step):
        d = math.hypot(x - tx, y - ty)
        vis = 1.0  # TODO: replace with LOS check
        visible_dists.append(d if vis >= 0.5 else float("inf"))
        ex += vis * (1.0 / (d*d + 1.0))
    risk = alpha * L + beta * ex
    return risk, L, visible_dists

@app.post("/route/auto")
async def route_auto(request: Request):
    body = await request.json()
    start = body.get("start"); threat = body.get("threat")
    if not start or not threat:
        raise HTTPException(400, "Provide {start:{x,y}} and {threat:{x,y}}")
    sx, sy = float(start["x"]), float(start["y"])
    tx, ty = float(threat["x"]), float(threat["y"])
    s_id = nearest_node(sx, sy)

    evac_goals = DEST.get("exits", [])
    shel_goals = DEST.get("shelters", [])

    if not evac_goals and not shel_goals:
        raise HTTPException(409, "No exits or shelters defined")

    def solve(goals):
        if not goals: return None
        goal_ids = set(nearest_node(float(r["x"]), float(r["y"])) for r in goals)
        LSHORT = 2.2; DOOR_THRESH = 0.9
        load_doors()
        def forbid(u,v,e):
            L = float(e.get("length", 1.0))
            if L <= LSHORT: return False
            ax, ay = NODE_POS[u]; bx, by = NODE_POS[v]
            return not edge_near_door(ax,ay,bx,by, DOOR_THRESH)
        path_nodes = a_star_risk_aware(G, s_id, goal_ids, (tx,ty), hard_forbid=forbid)
        if not path_nodes: return None
        poly = polyline_for_path(path_nodes)
        risk, Lm, vis = risk_of_polyline(poly, (tx,ty), alpha=1.0, beta=25.0, step=1.0)
        return {"poly": poly, "risk": float(risk), "length_m": float(Lm), "vis": vis}

    evac = solve(evac_goals)
    shel = solve(shel_goals)

    if not evac and not shel:
        raise HTTPException(404, "No path found to exits or shelters")

    mode = "EVAC"; choice = evac; other = shel
    if shel and (not evac or shel["risk"] < evac["risk"]): mode="SHELTER"; choice=shel; other=evac

    if evac and shel:
        lo = min(evac["risk"], shel["risk"])
        if abs(evac["risk"] - shel["risk"]) <= 0.10 * lo:
            # tie-break toward SHELTER if any visible sample < 5m
            def min_vis(p): 
                return min([d for d in p["vis"] if d != float("inf")], default=float("inf"))
            if min_vis(shel) < 5.0:
                mode="SHELTER"; choice=shel; other=evac
            else:
                mode="EVAC"; choice=evac; other=shel

    return {
        "mode_selected": mode,
        "route": choice["poly"],
        "length_m": choice["length_m"],
        "risk": choice["risk"],
        "compared": {
            "EVAC": {"risk": evac["risk"], "length_m": evac["length_m"]} if evac else None,
            "SHELTER": {"risk": shel["risk"], "length_m": shel["length_m"]} if shel else None
        }
    }