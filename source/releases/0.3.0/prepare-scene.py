import argparse
import hashlib
import math
from pathlib import Path
import re
import shutil
import sys

import bmesh
import bpy
from mathutils import Vector


SCENE_ID = "personal-workspace-v1"
RELEASE_VERSION = "0.3.0"
EXPECTED_BLENDER_VERSION = (4, 5, 12)
EXPECTED_BLENDER_BUILD_HASH = "84afd5f785f7"
EXPECTED_BASE_BLEND_SHA256 = "e11280ff35caa8b93cde90bec4e7650d13584be456d1d8a1ca78743dcf894c81"
EXPECTED_LIGHTMAP_SHA256 = "99efa06a464e15f04b496b2f21916de4b4e97603fafecb07edca35478a37283b"
EXPECTED_PANORAMA_SHA256 = "f974eaeb4d19bdf3ce25b4d2d3f9fe65b9b6c1ac2fc38a74757edbd5a17656d6"
SCRIPT_DIR = Path(__file__).resolve().parent
SOURCE_ROOT = SCRIPT_DIR.parents[1]
BASE_BLEND = SOURCE_ROOT / "review-candidate.blend"
BASE_LIGHTMAP = SOURCE_ROOT / "baked-lightmap-0.2.0.png"
PANORAMA_IMAGE = SCRIPT_DIR / "panorama-city-park.jpg"
PANORAMA_OBJECT = "exterior.panorama-sphere"
PANORAMA_MATERIAL = "material.exterior.panorama-unlit"

REVIEW_VIEWS = (
    ("entry", (2.35, 1.58, -1.92), (1.60, 1.18, 0.90), 88.0),
    ("workspace", (-1.0, 2.02, -2.15), (0.42, 1.08, 0.72), 84.0),
    ("reading", (0.55, 1.42, 0.95), (-2.25, 1.0, -0.45), 55.0),
    ("diagonal-overview", (-1.0, 2.02, -2.15), (0.35, 1.06, 0.62), 68.0),
    ("window-detail", (1.15, 1.55, 0.20), (4.35, 1.44, 0.20), 58.0),
    ("exterior-view", (0.05, 1.56, 0.20), (8.0, 1.37, 0.20), 72.0),
    ("owner-seat", (-1.05, 1.20, 0.92), (3.75, 1.38, 0.15), 70.0),
)

PBR_TUNING = {
    "material.mineral-plaster": ("#C7C1B5", 0.82, 0.0),
    "material.warm-oak": ("#80502F", 0.43, 0.0),
    "material.oak-honey": ("#A86A3C", 0.38, 0.0),
    "material.oak-shadow": ("#57341F", 0.49, 0.0),
    "material.charcoal-metal": ("#202625", 0.29, 0.68),
    "material.muted-sage": ("#64766B", 0.70, 0.0),
    "material.sage-woven": ("#53675A", 0.90, 0.0),
    "material.soft-clay": ("#945743", 0.66, 0.0),
    "material.natural-linen": ("#B6AA94", 0.88, 0.0),
    "material.warm-paper": ("#DED5C2", 0.82, 0.0),
    "material.workspace-screen": ("#18302F", 0.34, 0.04),
    "material.plant-leaf": ("#2E533C", 0.78, 0.0),
    "material.plant-leaf-light": ("#507050", 0.80, 0.0),
    "material.plant-soil": ("#2A211B", 0.97, 0.0),
}


def arguments():
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description="Create the non-destructive Personal Workspace 0.3.0 review source.")
    parser.add_argument("--output-blend", required=True)
    parser.add_argument("--lightmap-output", required=True)
    return parser.parse_args(values)


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def decoded_build_hash():
    value = bpy.app.build_hash
    return value.decode("ascii") if isinstance(value, bytes) else str(value)


def srgb_channel(value):
    value /= 255.0
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def color(hex_value):
    return tuple(srgb_channel(int(hex_value[index:index + 2], 16)) for index in (1, 3, 5)) + (1.0,)


def semantic_position(position):
    x, y, z = position
    return (x, z, y)


def remove_object(value):
    data = value.data
    bpy.data.objects.remove(value, do_unlink=True)
    if data is not None and data.users == 0:
        bpy.data.meshes.remove(data)


def object_group(name):
    if name.startswith("architecture.window-frame") or name == "architecture.window-sill-oak":
        return "main-window"
    if name.startswith("architecture.door"):
        return "main-door"
    if name.startswith("architecture."):
        return "room-shell"
    if name.startswith("furniture.owner-chair"):
        return "owner-chair"
    if name.startswith("furniture.owner-desk"):
        return "owner-desk"
    if name.startswith("surface.workspace-main"):
        return "workspace-main"
    if name.startswith("reading.bookshelf") or name.startswith("reading.book."):
        return "reading-library"
    if name.startswith("reading.chair"):
        return "reading-chair"
    if name.startswith("reading.rug"):
        return "reading-rug"
    if name.startswith("reading.floor-lamp"):
        return "reading-floor-lamp"
    if name.startswith("reading.side-table"):
        return "reading-side-table"
    if name.startswith("storage."):
        return "storage-cabinet"
    if name.startswith("window.bench"):
        return "window-bench"
    if name.startswith("window.plant"):
        return "window-plant"
    if name.startswith("lighting."):
        return "ceiling-lighting"
    if name.startswith("workspace.pendant"):
        return "workspace-pendant"
    if name.startswith("workspace.wall-panel") or name.startswith("workspace.oak-slat"):
        return "workspace-backdrop"
    if name.startswith("workspace."):
        return "workspace-accessories"
    raise RuntimeError(f"unclassified_runtime_mesh:{name}")


def stable_part_id(name):
    signed = name.lower().replace("+", ".positive-")
    signed = re.sub(r"\.-(?=\d)", ".negative-", signed)
    value = re.sub(r"[^a-z0-9]+", "-", signed).strip("-")
    require(re.fullmatch(r"[a-z0-9][a-z0-9-]*", value) is not None, f"invalid_part_id:{name}")
    return value


def tune_materials():
    for name, (base_hex, roughness, metallic) in PBR_TUNING.items():
        material = bpy.data.materials.get(name)
        require(material is not None, f"missing_material:{name}")
        material.use_nodes = True
        shader = next((node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
        require(shader is not None, f"missing_principled_shader:{name}")
        rgba = color(base_hex)
        shader.inputs["Base Color"].default_value = rgba
        shader.inputs["Roughness"].default_value = roughness
        shader.inputs["Metallic"].default_value = metallic
        material.diffuse_color = rgba
        material.roughness = roughness
        material.metallic = metallic
        material["vrataPbrTuningRelease"] = RELEASE_VERSION


def panorama_material():
    require(PANORAMA_IMAGE.is_file(), "panorama_image_missing")
    require(sha256(PANORAMA_IMAGE) == EXPECTED_PANORAMA_SHA256, "panorama_image_sha256_mismatch")
    image_name = "image.exterior.city-park-panorama"
    old = bpy.data.images.get(image_name)
    if old is not None:
        bpy.data.images.remove(old)
    encoded = PANORAMA_IMAGE.read_bytes()
    image = bpy.data.images.new(image_name, width=4096, height=2048, alpha=False)
    image.source = "FILE"
    image.file_format = "JPEG"
    image.filepath = "//panorama-city-park.jpg"
    image.filepath_raw = "//panorama-city-park.jpg"
    image.colorspace_settings.name = "sRGB"
    image.pack(data=encoded, data_len=len(encoded))

    material = bpy.data.materials.get(PANORAMA_MATERIAL) or bpy.data.materials.new(PANORAMA_MATERIAL)
    material.use_nodes = True
    material.use_backface_culling = True
    nodes = material.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = 1.05
    texture = nodes.new("ShaderNodeTexImage")
    texture.name = "PANORAMA_SRGB"
    texture.image = image
    texture.interpolation = "Linear"
    texture.extension = "REPEAT"
    material.node_tree.links.new(texture.outputs["Color"], emission.inputs["Color"])
    material.node_tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    material["vrataRenderProfile"] = "baked-pbr-v1"
    material["vrataLightMap"] = False
    material["vrataBakePolicy"] = "exclude-unlit-background"
    material["vrataUnlit"] = True
    material["vrataColorSpace"] = "sRGB"
    material["vrataPanoramaSha256"] = EXPECTED_PANORAMA_SHA256
    return material


def add_panorama(runtime):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, radius=40.0, location=(0.0, 0.0, 1.48))
    value = bpy.context.object
    value.name = PANORAMA_OBJECT
    value.data.name = f"mesh.{PANORAMA_OBJECT}"
    mesh = bmesh.new()
    mesh.from_mesh(value.data)
    bmesh.ops.reverse_faces(mesh, faces=mesh.faces[:])
    mesh.to_mesh(value.data)
    mesh.free()
    value.rotation_euler.z = math.radians(-21.6)
    value.data.materials.append(panorama_material())
    for collection in list(value.users_collection):
        collection.objects.unlink(value)
    runtime.objects.link(value)
    value["vrataObjectId"] = "exterior-panorama"
    value["vrataPartId"] = "sphere"
    value["vrataInteractionStatus"] = "passive"
    value["vrataBakePolicy"] = "exclude-unlit-background"
    value["vrataBakeExclusionReason"] = "unlit-panorama"
    value["vrataCollisionPolicy"] = "exclude"
    value["vrataSupportPolicy"] = "exclude"
    value["vrataNavigableBoundsPolicy"] = "exclude"
    value["vrataSourceAssetId"] = "asset-panorama-city-park-project-authored"
    value["vrataPanoramaSha256"] = EXPECTED_PANORAMA_SHA256
    value["vrataPanoramaRadiusM"] = 40.0
    value["vrataPanoramaYawDegrees"] = -21.6
    for attribute in ("visible_diffuse", "visible_glossy", "visible_transmission", "visible_volume_scatter", "visible_shadow"):
        if hasattr(value, attribute):
            setattr(value, attribute, False)
    return value


def tag_interior(runtime):
    meshes = sorted((value for value in runtime.all_objects if value.type == "MESH"), key=lambda value: value.name)
    for value in meshes:
        if value.name == PANORAMA_OBJECT:
            continue
        object_id = object_group(value.name)
        value["vrataObjectId"] = object_id
        value["vrataPartId"] = stable_part_id(value.name)
        value["vrataInteractionStatus"] = "interactive" if object_id in {"owner-chair", "workspace-main"} else "deferred" if object_id == "main-door" else "passive"
        value["vrataBakePolicy"] = "include"
        value["vrataCollisionPolicy"] = "scene-default"
        value["vrataSupportPolicy"] = "included"
        value["vrataNavigableBoundsPolicy"] = "include"
    pairs = [(value["vrataObjectId"], value["vrataPartId"]) for value in meshes]
    require(len(pairs) == len(set(pairs)), "duplicate_object_part_pair")
    return meshes


def create_review_cameras(authoring):
    for name in [name for name in bpy.data.objects.keys() if name.startswith("camera.review.0.3.0.")]:
        value = bpy.data.objects[name]
        data = value.data
        bpy.data.objects.remove(value, do_unlink=True)
        if data.users == 0:
            bpy.data.cameras.remove(data)
    for view_id, position, target, fov in REVIEW_VIEWS:
        data = bpy.data.cameras.new(f"camera.review.0.3.0.{view_id}.data")
        data.lens = 32.0
        data.sensor_width = 36.0
        data.angle = math.radians(fov)
        data.dof.use_dof = False
        value = bpy.data.objects.new(f"camera.review.0.3.0.{view_id}", data)
        authoring.objects.link(value)
        value.location = semantic_position(position)
        direction = Vector(semantic_position(target)) - value.location
        value.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        value["vrataReviewViewId"] = view_id
        value["vrataHorizontalFovDegrees"] = fov


def tune_lighting():
    energies = {
        "light.window-daylight": 980.0,
        "light.workspace-focus": 470.0,
        "light.room-fill": 315.0,
        "light.reading-practical": 155.0,
    }
    for name, energy in energies.items():
        value = bpy.data.objects.get(name)
        require(value is not None and value.type == "LIGHT", f"missing_review_light:{name}")
        value.data.energy = energy
    scene = bpy.context.scene
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    require(background is not None, "world_background_missing")
    background.inputs["Color"].default_value = color("#8DA5AD")
    background.inputs["Strength"].default_value = 0.14
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -0.28


def assert_preserved_layout():
    checks = {
        "architecture.floor-slab": ((0.0, 0.0, -0.06), (6.4, 5.2, 0.12)),
        "furniture.owner-chair.seat-shell": ((-1.05, 0.92, 0.48), (0.58, 0.55, 0.11)),
        "surface.workspace-main.panel": ((-1.08, 2.415, 1.56), (1.72, 0.025, 0.97)),
    }
    for name, (location, dimensions) in checks.items():
        value = bpy.data.objects.get(name)
        require(value is not None, f"preserved_object_missing:{name}")
        require(all(abs(actual - expected) <= 1.0e-5 for actual, expected in zip(value.location, location)), f"preserved_location_drift:{name}")
        require(all(abs(actual - expected) <= 1.0e-5 for actual, expected in zip(value.dimensions, dimensions)), f"preserved_dimensions_drift:{name}")


def main():
    args = arguments()
    import runpy
    assert_output = runpy.run_path(str(SCRIPT_DIR.parents[1] / "write_safety.py"))["assert_output"]
    output_blend = assert_output(args.output_blend)
    lightmap_output = assert_output(args.lightmap_output)
    require(output_blend.parent == SCRIPT_DIR and output_blend.name == "review-scene.blend", "invalid_versioned_blend_output")
    require(lightmap_output.parent == SCRIPT_DIR and lightmap_output.name == "baked-lightmap.png", "invalid_versioned_lightmap_output")
    require(Path(bpy.data.filepath).resolve() == BASE_BLEND.resolve(), "immutable_base_blend_required")
    require(tuple(bpy.app.version[:3]) == EXPECTED_BLENDER_VERSION, "blender_version_mismatch")
    require(decoded_build_hash() == EXPECTED_BLENDER_BUILD_HASH, "blender_build_hash_mismatch")
    require(sha256(BASE_BLEND) == EXPECTED_BASE_BLEND_SHA256, "base_blend_sha256_mismatch")
    require(sha256(BASE_LIGHTMAP) == EXPECTED_LIGHTMAP_SHA256, "base_lightmap_sha256_mismatch")
    require(sha256(PANORAMA_IMAGE) == EXPECTED_PANORAMA_SHA256, "panorama_sha256_mismatch")
    require(len(bpy.data.collections.get("Runtime").all_objects) == 232, "baseline_runtime_object_count_drift")
    assert_preserved_layout()

    glass = bpy.data.objects.get("architecture.window-glass")
    require(glass is not None and glass.type == "MESH", "baseline_window_glass_missing")
    remove_object(glass)
    glass_material = bpy.data.materials.get("material.window-glass")
    if glass_material is not None and glass_material.users == 0:
        bpy.data.materials.remove(glass_material)

    runtime = bpy.data.collections["Runtime"]
    authoring = bpy.data.collections["Authoring"]
    tune_materials()
    add_panorama(runtime)
    meshes = tag_interior(runtime)
    create_review_cameras(authoring)
    tune_lighting()

    require(len(meshes) == 232, f"derived_runtime_mesh_count_drift:{len(meshes)}")
    require(bpy.data.objects.get("architecture.window-glass") is None, "window_glass_not_removed")
    require(bpy.data.objects.get(PANORAMA_OBJECT) is not None, "panorama_not_added")
    scene = bpy.context.scene
    scene["vrataSceneId"] = SCENE_ID
    scene["vrataAuthoringRelease"] = RELEASE_VERSION
    scene["vrataGeometryStatus"] = "review"
    scene["vrataRenderProfile"] = "baked-pbr-v1"
    scene["vrataSourceBaseBlendSha256"] = EXPECTED_BASE_BLEND_SHA256
    scene["vrataPanoramaSha256"] = EXPECTED_PANORAMA_SHA256
    scene["vrataInteractionSemantics"] = "passive,deferred,interactive"
    scene["vrataRuntimeCoordinates"] = "x=x,y=y,z=-z"
    scene["vrataPanoramaExcludedFromBakeCollisionSupportNavigableBounds"] = True
    scene.camera = bpy.data.objects["camera.review.0.3.0.entry"]
    scene.render.filepath = "//renders/"
    bpy.context.preferences.filepaths.save_version = 0
    output_blend.parent.mkdir(parents=True, exist_ok=True)
    bpy.data.libraries.write(str(output_blend), {scene}, path_remap="RELATIVE_ALL", fake_user=True, compress=False)
    shutil.copyfile(BASE_LIGHTMAP, lightmap_output)
    require(sha256(lightmap_output) == EXPECTED_LIGHTMAP_SHA256, "copied_lightmap_sha256_mismatch")
    print(f"Prepared {SCENE_ID}@{RELEASE_VERSION}: {len(meshes)} runtime meshes, window glass removed, panorama added")


if __name__ == "__main__":
    main()
