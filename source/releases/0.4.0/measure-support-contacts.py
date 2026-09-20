"""Validate source-declared part load paths against final evaluated geometry."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


parser = argparse.ArgumentParser()
parser.add_argument("--registry", required=True)
parser.add_argument("--out", required=True)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
registry_path = Path(args.registry)
registry = json.loads(registry_path.read_text())
objects = {
    obj.name: obj for obj in bpy.data.collections["Runtime"].objects
    if obj.type == "MESH" and obj.get("vrataBakePolicy") == "include"
}
vertices = {name: [obj.matrix_world @ vertex.co for vertex in obj.data.vertices] for name, obj in objects.items()}
bounds = {
    name: (
        [min(point[axis] for point in points) for axis in range(3)],
        [max(point[axis] for point in points) for axis in range(3)],
    )
    for name, points in vertices.items()
}
trees = {
    name: BVHTree.FromPolygons(vertices[name], [tuple(poly.vertices) for poly in obj.data.polygons], epsilon=.0001)
    for name, obj in objects.items()
}


def broad_gap(left, right):
    low, high = bounds[left]
    other_low, other_high = bounds[right]
    return sum(max(low[axis] - other_high[axis], other_low[axis] - high[axis], 0) ** 2 for axis in range(3)) ** .5


cache = {}
def contact(left, right):
    key = tuple(sorted((left, right)))
    if key in cache:
        return cache[key]
    if broad_gap(left, right) > .004:
        result = None
    elif trees[left].overlap(trees[right]):
        result = {"method": "world-triangle-bvh-overlap", "distanceM": 0.0}
    else:
        distance = min((trees[right].find_nearest(point)[3] for point in vertices[left]), default=float("inf"))
        if distance > .004:
            distance = min(distance, min((trees[left].find_nearest(point)[3] for point in vertices[right]), default=float("inf")))
        result = {"method": "world-vertex-to-triangle-distance", "distanceM": round(distance, 7)} if distance <= .004 else None
    cache[key] = result
    return result


root_parts = set(registry["supportGraph"]["rootParts"])
declarations = {edge["part"]: edge for edge in registry["supportGraph"]["edges"]}
coverage_failures = sorted((set(objects) - root_parts) ^ set(declarations))
target_failures = sorted(
    f"{part}->{target}"
    for part, edge in declarations.items()
    for target in edge["targets"]
    if target not in objects
)
cycle_failures = []
path_failures = []


def visit(part, path):
    if part in root_parts:
        return True
    if part in path:
        cycle_failures.append("->".join((*path, part)))
        return False
    edge = declarations.get(part)
    if not edge:
        return False
    results = [visit(target, (*path, part)) for target in edge["targets"]]
    return all(results) if edge["allRequired"] else any(results)


for part in sorted(objects):
    if not visit(part, ()):
        path_failures.append(part)

measured_edges = []
contact_failures = []
for part, edge in sorted(declarations.items()):
    measurements = []
    for target in edge["targets"]:
        measured = contact(part, target)
        measurements.append({"target": target, "contact": measured is not None, **(measured or {"distanceM": round(broad_gap(part, target), 7), "method": "aabb-separation-lower-bound"})})
    passed = all(item["contact"] for item in measurements) if edge["allRequired"] else any(item["contact"] for item in measurements)
    measured_edges.append({**edge, "measurements": measurements, "passed": passed})
    if not passed:
        contact_failures.append(part)

report = {
    "kind": "declared-part-load-path-validation",
    "sourceBlendSha256": hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest(),
    "measurementScriptSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    "registrySha256": hashlib.sha256(registry_path.read_bytes()).hexdigest(),
    "coordinateSystem": "world Blender Z-up meters",
    "toleranceM": .004,
    "rootParts": sorted(root_parts),
    "physicalParts": len(objects),
    "declaredParts": len(declarations),
    "edges": measured_edges,
    "failures": {
        "coverage": coverage_failures,
        "missingTargets": target_failures,
        "cycles": sorted(set(cycle_failures)),
        "pathsWithoutRoot": sorted(set(path_failures)),
        "contacts": contact_failures,
    },
    "limits": "Geometric contact and rooted acyclic support are verified for every declared part. This does not establish material strength, fastener capacity, human visual acceptance, or rights approval.",
}
Path(args.out).write_text(json.dumps(report, indent=2) + "\n")
failures = [name for name, values in report["failures"].items() if values]
print(json.dumps({"physicalParts": len(objects), "declaredParts": len(declarations), "failures": failures}))
if failures:
    raise RuntimeError("declared_support_validation_failed:" + ",".join(failures))
