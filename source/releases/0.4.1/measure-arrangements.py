"""Q8 measurement on actual source geometry, separate from per-part load paths."""
import argparse
import hashlib
import json
from pathlib import Path
import runpy
import sys

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
safe_output = runpy.run_path(str(HERE / "author-scene.py"))["safe_output"]
parser = argparse.ArgumentParser()
parser.add_argument("--registry", required=True)
parser.add_argument("--out", required=True)
args = parser.parse_args(sys.argv[sys.argv.index("--")+1:])
registry_path = Path(args.registry)
registry = json.loads(registry_path.read_text())


def bounds(names):
    vertices = [bpy.data.objects[name].matrix_world @ v.co for name in names for v in bpy.data.objects[name].data.vertices]
    return [[min(v[i] for v in vertices) for i in range(3)], [max(v[i] for v in vertices) for i in range(3)]]


cards = {card["objectId"]: card for card in registry["objects"]}
reports = []
failures = []
for group in registry["arrangements"]:
    members = group["members"]
    boxes = [bounds(cards[book["objectId"]]["parts"]) for book in members]
    shelf = bounds([group["shelf"]])
    left = bounds([group["leftRestraint"]])
    right = bounds([group["rightRestraint"]])
    contacts = [{"left": members[i]["objectId"], "right": members[i+1]["objectId"],
                 "gapM": boxes[i+1][0][1] - boxes[i][1][1]} for i in range(len(boxes)-1)]
    end_gaps = [boxes[0][0][1]-left[1][1], right[0][1]-boxes[-1][1][1]]
    bearing = [box[0][2]-shelf[1][2] for box in boxes]
    next_shelf_z = min(o["min"][2] for o in cards["library"]["measuredParts"]
                       if o["name"] in ("library.shelf-0", "library.shelf-1", "library.shelf-2", "library.top")
                       and o["min"][2] > shelf[1][2] + .01)
    headroom = min(next_shelf_z - box[1][2] for box in boxes)
    # 0.5 mm accounts for float coordinates; 50 mm above the tallest volume
    # permits grasping/retrieval. These are book-run criteria, not universal props.
    passed = all(abs(c["gapM"]) <= .0005 for c in contacts)
    passed &= all(abs(g) <= .0005 for g in end_gaps + bearing)
    passed &= headroom >= .05
    report = {"shelf": group["shelf"], "books": len(boxes), "neighbourContacts": contacts,
              "endRestraintGapsM": end_gaps, "shelfBearingGapsM": bearing,
              "minimumRetrievalHeadroomM": headroom, "passed": bool(passed)}
    reports.append(report)
    if not passed:
        failures.append(group["shelf"])

report = {"kind": "supported-library-arrangement", "sourceSha256": hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest(),
          "registrySha256": hashlib.sha256(registry_path.read_bytes()).hexdigest(),
          "method": "world-space actual mesh vertices; flat board contact, shelf bearing, end restraint and overhead access",
          "groups": reports, "failures": failures,
          "limits": "Geometric evidence only; source/browser images and real-use references establish the group-level visual verdict."}
safe_output(args.out).write_text(json.dumps(report, indent=2)+"\n")
print(json.dumps({"groups": len(reports), "books": sum(r["books"] for r in reports), "failures": failures}), flush=True)
if failures:
    raise RuntimeError("book_arrangement_failed")
