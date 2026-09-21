"""Derive the 0.4.1 study from immutable 0.4.0 source; never edit that source.

Run with Blender opening source/releases/0.4.0/draft-scene.blend. Geometry edits
and references are explicit here; output remains untracked scratch until review.
"""
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import random
import runpy
import subprocess
import sys

sys.dont_write_bytecode = True  # Embedded Blender Python ignores PYTHONDONTWRITEBYTECODE.

import bpy
import numpy as np
from mathutils import Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
LEGACY = HERE.parent / "0.4.0"
VERSION = "0.4.1"


def safe_output(path):
    path = Path(path).absolute()
    relative = path.relative_to(ROOT)
    if relative.parts[0] != "build":
        raise RuntimeError("output_must_be_build_artifact")
    current = ROOT
    for part in relative.parts:
        current /= part
        if current.is_symlink():
            raise RuntimeError("output_symlink")
    for query in (["ls-tree", "--name-only", "HEAD", "--"], ["ls-files", "--"]):
        result = subprocess.run(["git", *query, relative.as_posix()], cwd=ROOT, capture_output=True, text=True, check=True)
        if result.stdout.strip():
            raise RuntimeError("tracked_output")
    return path


def load_legacy():
    spec = importlib.util.spec_from_file_location("personal_040_author", LEGACY / "author-scene.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.M.update({mat.name.removeprefix("material."): mat for mat in bpy.data.materials})
    return module


def revise_wood_finish(out):
    mat = bpy.data.materials["material.wood"]
    shader = mat.node_tree.nodes.get("Principled BSDF")
    for socket_name, name in (("Base Color", "matte-walnut-diff"), ("Roughness", "matte-walnut-rough")):
        node = shader.inputs[socket_name].links[0].from_node
        original = node.image
        pixels = np.array(original.pixels[:], dtype=np.float32).reshape((-1, 4))
        if socket_name == "Base Color":
            # A lighter oil-finished veneer, preserving the photographed grain.
            # This is a source material change, used identically by Cycles and GLB.
            pixels[:, :3] = np.clip(pixels[:, :3]*1.4 + np.array([.20, .17, .12]), 0, 1)
        else:
            pixels[:, :3] = .70 + .18*pixels[:, :3]
        image = bpy.data.images.new(name, width=original.size[0], height=original.size[1], alpha=False)
        image.colorspace_settings.name = "sRGB" if socket_name == "Base Color" else "Non-Color"
        image.pixels.foreach_set(pixels.ravel())
        image.filepath_raw, image.file_format = str(safe_output(out / f"{name}.png")), "PNG"
        image.save()
        image.pack()
        node.image = image
    mat["finishDerivation"] = "0.4.1 lighter matte walnut; photographed grain retained; roughness 0.70+0.18*source"


def revise_library(author, registry, atlas):
    """Closely shelved related formats, held by the case side and clamped bookend."""
    cards = {card["objectId"]: card for card in registry["objects"] if not card["objectId"].startswith("book-")}
    edges = {edge["part"]: edge for edge in registry["supportGraph"]["edges"] if not edge["part"].startswith("book-")}
    for obj in list(bpy.data.collections["Runtime"].objects):
        if obj.get("vrataObjectId", "").startswith("book-"):
            bpy.data.objects.remove(obj, do_unlink=True)
    author.CARDS.update(cards)
    mat = bpy.data.materials.new("material.book-spines")
    mat.use_nodes = True
    mat.use_backface_culling = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Roughness"].default_value = .72
    texture = mat.node_tree.nodes.new("ShaderNodeTexImage")
    texture.image = bpy.data.images.load(str(atlas), check_existing=True)
    texture.image.colorspace_settings.name = "sRGB"
    texture.image.pack()
    uv = mat.node_tree.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "UVMap"
    mat.node_tree.links.new(uv.outputs["UV"], texture.inputs["Vector"])
    mat.node_tree.links.new(texture.outputs["Color"], shader.inputs["Base Color"])
    finish = mat.node_tree.nodes.new("ShaderNodeTexImage")
    finish.image = bpy.data.images.load(str(atlas.with_name("book-finish.png")), check_existing=True)
    finish.image.colorspace_settings.name = "Non-Color"
    finish.image.pack()
    mat.node_tree.links.new(uv.outputs["UV"], finish.inputs["Vector"])
    mat.node_tree.links.new(finish.outputs["Color"], shader.inputs["Roughness"])
    author.M["book-spines"] = mat
    shelves = ["library.bottom", "library.shelf-0", "library.shelf-1", "library.shelf-2"]
    arrangements = []

    def support(part, target, joint):
        edges[part] = {"part": part, "targets": [target], "joint": joint, "allRequired": True}

    # The denser library also changes the load on 1.8 m shelves. Rear ledgers
    # anchored through the backing shorten the plywood's unsupported depth;
    # do not treat an empty display shelf's two end contacts as a load review.
    author.CARDS["library"]["construction"] = "24 mm veneered plywood shelves on side supports and continuous rear timber ledgers, three masonry fixings through backing per ledger; anchored carcass on floor plinth"
    for shelf, z in enumerate((.48, .86, 1.24)):
        ledger = f"library.rear-ledger-{shelf}"
        author.box(ledger, (.030, 1.814, .024), (-3.109, .15, z-.024), "wood", 0)
        fixings = []
        for index, y in enumerate((-.60, .15, .90)):
            fixing = f"library.ledger-fixing-{shelf}-{index}"
            author.rod(fixing, (-3.18, y, z-.024), (-3.108, y, z-.024), .003, "steel", 12)
            support(fixing, "room-shell.west", "masonry-fixing-through-backed-spacer")
            fixings.append(fixing)
        edges[ledger] = {"part": ledger, "targets": fixings, "joint": "three-point-wall-fixed-ledger", "allRequired": True}
        edges[f"library.shelf-{shelf}"]["targets"].append(ledger)
        edges[f"library.shelf-{shelf}"]["joint"] = "side-supports-and-continuous-rear-ledger"

    # Books in a series share a format/finish. Thickness follows volume size;
    # individual front-edge offsets reflect shelving, never unsupported tilts.
    series = [("dark", .240, .196), ("sage", .258, .208), ("paper", .225, .184),
              ("book-red", .278, .222), ("paint", .248, .201), ("dark", .232, .188),
              ("sage", .267, .216), ("book-red", .244, .204)]
    rng = random.Random(241)
    number = 0
    for shelf, (bottom, count) in enumerate(zip((.112, .492, .872, 1.252), (38, 34, 41, 36))):
        cursor = -.757  # Inner face of south bookcase side, not an arbitrary grid.
        members = []
        series_id = shelf * 7
        volumes_left = 0
        for j in range(count):
            number += 1
            key = f"book-{number:03d}"
            if volumes_left == 0:
                series_id += rng.choice((1, 2, 3))
                volumes_left = rng.choice((2, 3, 4))
                volume_index = 0
            volumes_left -= 1
            group = series_id % len(series)
            color, height, depth = series[group]
            height += (0, .002, -.001, .001)[j % 4]
            thickness = rng.choice((.020, .024, .028, .031, .035, .039, .044))
            y = cursor + thickness / 2
            front = -2.850 - rng.choice((0, .002, .004, .007))
            x = front - depth / 2
            author.card(key, "Shelved reference volume", "Read and retrieve by spine from a supported run",
                        "Paper signatures, two cloth-covered boards and bound spine", "library", "deferred")
            author.CARDS[key]["evidenceViews"] = ["shelf-group", "shelf-detail", "entry"]
            pages = author.box(f"{key}.pages", (depth-.010, thickness-.004, height-.004),
                               (x-.002, y, bottom+height/2), "book-spines", 0)
            for poly in pages.data.polygons:
                for li in poly.loop_indices:
                    p = pages.data.vertices[pages.data.loops[li].vertex_index].co
                    pages.data.uv_layers["UVMap"].data[li].uv = (2080/2112, min(.999, max(.001, .5+p.y/(thickness-.004))))
            spine = author.box(f"{key}.spine", (.006, thickness, height),
                              (front-.003, y, bottom+height/2), "book-spines", 0)
            tile = (series_id * 4 + volume_index) % 128
            volume_index += 1
            uv_layer = spine.data.uv_layers["UVMap"]
            for poly in spine.data.polygons:
                for li in poly.loop_indices:
                    p = spine.data.vertices[spine.data.loops[li].vertex_index].co
                    u = min(.98, max(.02, .5+p.y/thickness))
                    v = min(.995, max(.005, .5+p.z/height))
                    uv_layer.data[li].uv = ((tile % 32+u)*64/2112, 1-(tile//32+1-v)/4)
            for side in (-1, 1):
                # Cloth-covered spine wraps the board ends. No overlapping front
                # faces and no sub-texel exposed board strips beside the spine.
                board = author.box(f"{key}.board-{side}", (depth-.006, .002, height),
                                   (x-.003, y+side*(thickness-.002)/2, bottom+height/2), "book-spines", 0)
                for loop in board.data.uv_layers["UVMap"].data:
                    loop.uv = ((tile % 32+.06)*64/2112, 1-(tile//32+.04)/4)
                support(f"{key}.board-{side}", shelves[shelf], "board-edge-on-shelf")
            support(f"{key}.pages", f"{key}.board--1", "bound-signature-contact")
            support(f"{key}.spine", f"{key}.board--1", "bound-spine")
            members.append({"objectId": key, "series": group, "thicknessM": thickness,
                            "heightM": height, "depthM": depth, "lowY": cursor,
                            "highY": cursor+thickness, "bottomZ": bottom})
            cursor += thickness  # Actual board-to-board contact, with no interpenetration.
        key = f"bookend-{shelf}"
        author.card(key, "Clamped shelf bookend", "Retain a partly filled run while books are retrieved",
                    "2 mm bent steel upright and shelf clamp with screw pad", "library")
        author.box(f"{key}.upright", (.19, .002, .17), (-2.982, cursor+.001, bottom+.085), "metal", 0)
        author.box(f"{key}.top-clamp", (.074, .037, .002), (-2.865, cursor+.0185, bottom+.001), "metal", 0)
        author.box(f"{key}.front-clamp", (.003, .037, .030), (-2.8285, cursor+.0185, bottom-.013), "metal", 0)
        author.box(f"{key}.under-clamp", (.074, .037, .002), (-2.865, cursor+.0185, bottom-.027), "metal", 0)
        author.rod(f"{key}.screw", (-2.865, cursor+.0185, bottom-.036),
                   (-2.865, cursor+.0185, bottom-.023), .004, "steel", 12)
        support(f"{key}.top-clamp", shelves[shelf], "clamped-to-shelf")
        support(f"{key}.upright", f"{key}.top-clamp", "bent-steel-joint")
        support(f"{key}.front-clamp", f"{key}.top-clamp", "bent-steel-joint")
        support(f"{key}.under-clamp", f"{key}.front-clamp", "bent-steel-joint")
        support(f"{key}.screw", f"{key}.under-clamp", "threaded-clamping-screw")
        if cursor >= 1.02:
            raise RuntimeError("book_run_overflows_shelf")
        arrangements.append({"shelf": shelves[shelf], "state": "orderly working reference library",
                             "members": members, "leftRestraint": "library.side-south",
                             "rightRestraint": f"{key}.upright", "retrieval": "outward, with headroom above volumes"})
    registry["objects"] = list(author.CARDS.values())
    registry["supportGraph"]["edges"] = list(edges.values())
    registry["arrangements"] = arrangements
    for edge in edges.values():
        obj = bpy.data.objects[edge["part"]]
        obj["vrataSupportTargets"] = json.dumps(edge["targets"], separators=(",", ":"))
        obj["vrataSupportJoint"] = edge["joint"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--views", default="shelf-detail,shelf-group")
    parser.add_argument("--book-atlas", required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--")+1:])
    out = safe_output(args.out)
    out.mkdir(parents=True, exist_ok=True)
    original = Path(bpy.data.filepath)
    assert hashlib.sha256(original.read_bytes()).hexdigest() == "f227fb73135898b1fc318c50795aadc011bfdad1acfafda7ce4ec2cc8d2d5f7d", "base_source_drift"
    author = load_legacy()
    for name in ("paper", "metal", "wood", "plaster"):
        # These materials cover closed solids. Opposing hidden contact faces
        # should not render through neighbouring books, clamps or case panels.
        author.M[name].use_backface_culling = True
    revise_wood_finish(out)
    registry = json.loads((LEGACY / "object-registry.json").read_text())
    # Plaster is continuous at building junctions. The inherited 3 mm bevel on
    # every independent wall block creates an unintended dark groove there.
    for obj in list(bpy.data.collections["Runtime"].objects):
        if obj.name.startswith("room-shell."):
            name, dimensions, position = obj.name, tuple(obj.dimensions), tuple(obj.location)
            if name == "room-shell.floor":
                dimensions = (6.68, 5.48, .12)  # Structural slab also bears the perimeter walls.
            properties = dict(obj.items())
            material = obj.data.materials[0]
            bpy.data.objects.remove(obj, do_unlink=True)
            bpy.ops.mesh.primitive_cube_add(size=1, location=position)
            replacement = bpy.context.object
            replacement.dimensions = dimensions
            bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
            # Use the immutable metric UV helper without adding registry entries.
            author.CARDS.setdefault("room-shell", {"parts": [], "interactionStatus": "passive"})
            author.finish(name, replacement, material)
            for key, value in properties.items():
                replacement[key] = value
    author.CARDS.clear()
    revise_library(author, registry, Path(args.book_atlas).resolve())
    author.camera("shelf-group", (-1.06, .22, 1.12), (-2.98, .16, .87), 64)
    # A detail camera should show a run, its support and the shelf — not crop out
    # all but two books. Preserve the original historical camera in 0.4.0 only.
    camera = bpy.data.objects["camera.shelf-detail"]
    camera.location = (-1.98, -.02, .86)
    camera.rotation_euler = (Vector((-2.98, -.03, .81))-camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.angle = math.radians(62)
    scene = bpy.context.scene
    preferences = bpy.context.preferences.addons["cycles"].preferences
    preferences.compute_device_type = "CUDA"
    preferences.get_devices()
    assert any(device.type == "CUDA" for device in preferences.devices), "cuda_device_required"
    for device in preferences.devices:
        device.use = device.type == "CUDA"
    scene.cycles.device = "GPU"
    for field in ("releaseVersion", "vrataAuthoringRelease"):
        scene[field] = VERSION
    if "qualityOutcome" in scene:
        del scene["qualityOutcome"]
    scene["authoringStage"] = "generated-source"
    registry["releaseVersion"] = VERSION
    registry.pop("qualityOutcome", None)
    registry["authoringStage"] = "generated-source"
    bpy.context.view_layer.update()
    for card in registry["objects"]:
        card["measuredParts"] = []
        for name in card["parts"]:
            obj = bpy.data.objects[name]
            obj["vrataAuthoringRelease"] = VERSION
            points = [obj.matrix_world @ Vector(p) for p in obj.bound_box]
            card["measuredParts"].append({"name": name, "min": [min(p[i] for p in points) for i in range(3)],
                                          "max": [max(p[i] for p in points) for i in range(3)],
                                          "materials": [m.name for m in obj.data.materials]})
    (out / "object-registry.json").write_text(json.dumps(registry, indent=2)+"\n")
    for image in bpy.data.images:
        if image.source == "FILE" and image.packed_file:
            image.filepath = f"//textures/{Path(image.filepath).name}"
    scene.render.filepath = "//review/"
    runpy.run_path(str(HERE / "portable-source.py"))["sanitize_paths"]()
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(safe_output(out / "draft-scene.blend")), check_existing=False)
    for key in filter(None, args.views.split(",")):
        scene.camera = bpy.data.objects[f"camera.{key}"]
        scene.render.filepath = str(safe_output(out / f"{key}.png"))
        bpy.ops.render.render(write_still=True)
    print(json.dumps({"version": VERSION, "bookCount": sum(len(g["members"]) for g in registry["arrangements"]),
                      "authoringStage": "generated-source"}), flush=True)


if __name__ == "__main__":
    main()
