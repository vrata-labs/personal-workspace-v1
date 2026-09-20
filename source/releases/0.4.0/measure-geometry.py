"""Measure final geometry, user clearances, routes, and screen sightlines."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector


parser = argparse.ArgumentParser()
parser.add_argument("--registry", required=True)
parser.add_argument("--out", required=True)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
registry = json.loads(Path(args.registry).read_text())
objects = {obj.name: obj for obj in bpy.data.collections["Runtime"].objects if obj.type == "MESH"}
bounds = {
    name: (
        [min((obj.matrix_world @ Vector(point))[axis] for point in obj.bound_box) for axis in range(3)],
        [max((obj.matrix_world @ Vector(point))[axis] for point in obj.bound_box) for axis in range(3)],
    )
    for name, obj in objects.items()
}


def aabb_intersects(a, b):
    return all(a[0][axis] <= b[1][axis] and b[0][axis] <= a[1][axis] for axis in range(3))


def horizontal_gap(point, box):
    return math.hypot(
        max(box[0][0] - point[0], point[0] - box[1][0], 0),
        max(box[0][1] - point[1], point[1] - box[1][1], 0),
    )


def sample_route(route, step=.1):
    samples = []
    for start, end in zip(route, route[1:]):
        distance = math.dist(start, end)
        count = max(1, math.ceil(distance / step))
        samples.extend(tuple(start[axis] + (end[axis] - start[axis]) * index / count for axis in range(2)) for index in range(count))
    samples.append(route[-1])
    return samples


obstacles = {
    name: box for name, box in bounds.items()
    if name != "room-shell.floor"
    and objects[name].get("vrataBakePolicy") == "include"
    and box[1][2] >= .05
    and box[0][2] <= 1.8
    and not name.startswith(("room-shell.", "skirting.", "reading-rug."))
}
routes = {
    "entrance-to-desk": [(2.10, -1.55), (1.10, -.72), (.05, -.20), (-1.05, .08)],
    "entrance-to-reading-chair": [(2.10, -1.55), (.85, -.85), (-1.58, -.62)],
}
route_results = []
for route_id, route in routes.items():
    clearances = [
        (horizontal_gap(point, box), name)
        for point in sample_route(route)
        for name, box in obstacles.items()
    ]
    minimum, nearest = min(clearances)
    route_results.append({"id": route_id, "actorRadiusM": .30, "minimumClearanceM": round(minimum, 4), "nearestPart": nearest, "clear": minimum >= .30})

knee_envelope = ([-1.40, 1.00, .20], [-.70, 1.50, .67])
knee_obstructions = sorted(name for name, box in obstacles.items() if aabb_intersects(knee_envelope, box))
hand_origin = Vector((-1.05, .80, 1.08))
hand_target_parts = {
    "keyboard": "keyboard.spacebar",
    "mouse": "mouse.body",
    "notebook": "notebook.top-board",
    "pen": "pen.barrel",
}
maximum_reach = .85
hand_reach = []
for name, part in hand_target_parts.items():
    target = Vector(objects[part].matrix_world.translation)
    distance = (target - hand_origin).length
    hand_reach.append({"target": name, "sourcePart": part, "worldPoint": [round(value, 6) for value in target], "distanceM": round(distance, 4), "maximumReachM": maximum_reach, "reachable": distance <= maximum_reach})
spawn = (2.10, -1.55)
spawn_hits = sorted(name for name, box in obstacles.items() if horizontal_gap(spawn, box) < .80)
plant_box = bounds["window-plant.pot"]
plant_route_clearance = min(horizontal_gap(point, plant_box) for route in routes.values() for point in sample_route(route))

surface = {"center": [-1.05, 2.426, 1.35], "width": 1.20, "height": .675, "normal": [0, -1, 0]}
deps = bpy.context.evaluated_depsgraph_get()
visibility = []
eye = Vector((-1.05, .72, 1.20))
for fx, fz in ((-.48, -.48), (-.48, .48), (.48, -.48), (.48, .48), (0, 0)):
    target = Vector(surface["center"]) + Vector((fx * surface["width"], 0, fz * surface["height"]))
    direction = target - eye
    hit, _, _, _, obj, _ = bpy.context.scene.ray_cast(deps, eye, direction.normalized(), distance=direction.length - .002)
    visibility.append({"seat": "owner-desk-seat", "sample": [fx, fz], "clear": not hit, "obstruction": obj.name if hit else None, "distanceM": round(direction.length, 4)})

report = {
    "sourceBlendSha256": hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest(),
    "measurementScriptSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    "registrySha256": hashlib.sha256(Path(args.registry).read_bytes()).hexdigest(),
    "sceneId": registry["sceneId"],
    "releaseVersion": registry["releaseVersion"],
    "meshParts": len(objects),
    "screenVisibility": {"method": "evaluated-scene ray cast from the seated eye to five inset display points", "allClear": all(ray["clear"] for ray in visibility), "rays": visibility},
    "userClearances": {
        "scope": "Conservative bounds/point screening only. The 0.85m extended reach is a screening ceiling, not a validated frequent-use ergonomic envelope. Failed targets require layout or posture review; do not tune per-target limits to pass.",
        "kneeEnvelope": {"bounds": knee_envelope, "obstructions": knee_obstructions, "clear": not knee_obstructions},
        "handReach": hand_reach,
        "routes": route_results,
        "spawnOpenRadius": {"radiusM": .80, "obstructions": spawn_hits, "clear": not spawn_hits},
        "plantRouteClearance": {"minimumClearanceM": round(plant_route_clearance, 4), "requiredM": .30, "clear": plant_route_clearance >= .30},
    },
    "surface": surface,
}
Path(args.out).write_text(json.dumps(report, indent=2) + "\n")
failures = []
if not report["screenVisibility"]["allClear"]: failures.append("screen_visibility")
if not report["userClearances"]["kneeEnvelope"]["clear"]: failures.append("knee_clearance")
if not all(item["reachable"] for item in hand_reach): failures.append("hand_reach")
if not all(item["clear"] for item in route_results): failures.append("routes")
if not report["userClearances"]["spawnOpenRadius"]["clear"]: failures.append("spawn")
if not report["userClearances"]["plantRouteClearance"]["clear"]: failures.append("plant_route")
print(json.dumps({"sceneId": registry["sceneId"], "parts": len(objects), "failures": failures}))
if failures:
    raise RuntimeError("geometry_screening_failed:" + ",".join(failures))
