import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import runpy
import struct
import sys

import bpy


SCENE_ID = "personal-workspace-v1"
RELEASE_VERSION = "0.3.0"
EXPECTED_BLENDER_VERSION = (4, 5, 12)
EXPECTED_BLENDER_BUILD_HASH = "84afd5f785f7"
EXPECTED_BLENDER_BINARY_SHA256 = "33ac108ebce3c271f5357e5c664d0488717263bcf2145c80300edd0b12c31880"
EXPECTED_LIGHTMAP_SHA256 = "99efa06a464e15f04b496b2f21916de4b4e97603fafecb07edca35478a37283b"
EXPECTED_PANORAMA_SHA256 = "f974eaeb4d19bdf3ce25b4d2d3f9fe65b9b6c1ac2fc38a74757edbd5a17656d6"
EXPECTED_MESH_COUNT = 232
EXPECTED_BAKED_MATERIAL_COUNT = 15
EXPECTED_MATERIAL_COUNT = 16
PANORAMA_OBJECT = "exterior.panorama-sphere"
PANORAMA_MATERIAL = "material.exterior.panorama-unlit"
LIGHTMAP_UV = "VRATA_LIGHTMAP_UV"
LIGHTMAP_NODE = "VRATA_LIGHTMAP_BAKE"
LIGHTMAP_UV_NODE = f"{LIGHTMAP_NODE}_UV"
REQUIRED_TAGS = (
    "vrataObjectId",
    "vrataPartId",
    "vrataInteractionStatus",
    "vrataBakePolicy",
    "vrataCollisionPolicy",
    "vrataSupportPolicy",
    "vrataNavigableBoundsPolicy",
)
LIGHTMAP_INTENSITIES = {
    "material.charcoal-metal": 2.7,
    "material.mineral-plaster": 3.0,
    "material.muted-sage": 3.2,
    "material.natural-linen": 3.1,
    "material.oak-honey": 4.0,
    "material.oak-shadow": 4.3,
    "material.plant-leaf": 3.2,
    "material.plant-leaf-light": 3.2,
    "material.plant-soil": 3.0,
    "material.sage-woven": 3.2,
    "material.soft-clay": 3.35,
    "material.warm-oak": 4.2,
    "material.warm-paper": 3.0,
    "material.warm-practical-glow": 3.2,
    "material.workspace-screen": 2.8,
}


def arguments():
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description="Export the Personal Workspace 0.3.0 review GLB.")
    parser.add_argument("--output", required=True)
    parser.add_argument("--lightmap", required=True)
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


def principled_node(material):
    if not material.use_nodes or material.node_tree is None:
        return None
    return next((node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)


def visible_runtime_meshes():
    runtime = bpy.data.collections.get("Runtime")
    require(runtime is not None, "runtime_collection_missing")
    return sorted(
        (
            value
            for value in runtime.all_objects
            if value.type == "MESH" and not value.hide_get() and not value.hide_render and value.visible_get()
        ),
        key=lambda value: value.name,
    )


def assert_toolchain():
    require(tuple(bpy.app.version[:3]) == EXPECTED_BLENDER_VERSION, "blender_version_mismatch")
    require(decoded_build_hash() == EXPECTED_BLENDER_BUILD_HASH, "blender_build_hash_mismatch")
    binary = Path(bpy.app.binary_path).resolve()
    require(binary.is_file(), "blender_binary_missing")
    require(sha256(binary) == EXPECTED_BLENDER_BINARY_SHA256, "blender_binary_sha256_mismatch")


def assert_portable_source():
    require(len(bpy.data.libraries) == 0, "external_blend_library_forbidden")
    unpacked = list(bpy.utils.blend_paths(absolute=False, packed=False, local=True))
    require(not unpacked, f"unpacked_external_paths_forbidden:{unpacked}")
    stored = list(bpy.utils.blend_paths(absolute=False, packed=True, local=True))
    require(all(path.startswith("//") and "://" not in path for path in stored), f"nonportable_stored_path:{stored}")
    for image in bpy.data.images:
        if image.source == "FILE":
            require(image.packed_file is not None, f"unpacked_file_image_forbidden:{image.name}")


def validate_source(objects, lightmap_path):
    assert_portable_source()
    scene = bpy.context.scene
    require(scene.get("vrataSceneId") == SCENE_ID, "scene_id_mismatch")
    require(scene.get("vrataAuthoringRelease") == RELEASE_VERSION, "authoring_release_mismatch")
    require(scene.get("vrataGeometryStatus") == "review", "geometry_status_mismatch")
    require(scene.get("vrataRenderProfile") == "baked-pbr-v1", "render_profile_mismatch")
    require(scene.get("vrataPanoramaSha256") == EXPECTED_PANORAMA_SHA256, "panorama_scene_hash_mismatch")
    require(len(objects) == EXPECTED_MESH_COUNT, f"mesh_count_mismatch:{len(objects)}")
    require(not any(value.name == "architecture.window-glass" for value in objects), "window_glass_must_be_absent")
    require(lightmap_path.is_file() and sha256(lightmap_path) == EXPECTED_LIGHTMAP_SHA256, "lightmap_sha256_mismatch")

    pairs = []
    statuses = Counter()
    baked = []
    excluded = []
    for value in objects:
        for tag in REQUIRED_TAGS:
            require(tag in value, f"mesh_tag_missing:{value.name}:{tag}")
        object_id = value["vrataObjectId"]
        part_id = value["vrataPartId"]
        require(re.fullmatch(r"[a-z0-9][a-z0-9-]*", object_id) is not None, f"invalid_object_id:{value.name}")
        require(re.fullmatch(r"[a-z0-9][a-z0-9-]*", part_id) is not None, f"invalid_part_id:{value.name}")
        pairs.append((object_id, part_id))
        statuses[value["vrataInteractionStatus"]] += 1
        if value["vrataBakePolicy"] == "include":
            require(value["vrataCollisionPolicy"] == "scene-default", f"interior_collision_policy_drift:{value.name}")
            require(value["vrataSupportPolicy"] == "included", f"interior_support_policy_drift:{value.name}")
            require(value["vrataNavigableBoundsPolicy"] == "include", f"interior_bounds_policy_drift:{value.name}")
            baked.append(value)
        elif value["vrataBakePolicy"] == "exclude-unlit-background":
            require(value.name == PANORAMA_OBJECT, f"unexpected_unlit_exclusion:{value.name}")
            require(value.get("vrataBakeExclusionReason") == "unlit-panorama", "panorama_bake_reason_drift")
            require(value["vrataCollisionPolicy"] == "exclude" and value["vrataSupportPolicy"] == "exclude", "panorama_physics_exclusion_drift")
            require(value["vrataNavigableBoundsPolicy"] == "exclude", "panorama_bounds_exclusion_drift")
            require(value.get("vrataPanoramaSha256") == EXPECTED_PANORAMA_SHA256, "panorama_object_hash_drift")
            excluded.append(value)
        else:
            raise RuntimeError(f"invalid_bake_policy:{value.name}:{value['vrataBakePolicy']}")
    require(len(pairs) == len(set(pairs)), "duplicate_object_part_pair")
    require(len(excluded) == 1 and len(baked) == EXPECTED_MESH_COUNT - 1, "bake_partition_mismatch")
    require(set(statuses) == {"passive", "deferred", "interactive"}, "interaction_status_coverage_missing")
    return baked, excluded, statuses


def unwrap_lightmap(objects):
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    for value in objects:
        layers = value.data.uv_layers
        old = layers.get(LIGHTMAP_UV)
        if old is not None:
            layers.remove(old)
        layers.new(name=LIGHTMAP_UV)
        layers.active = layers[LIGHTMAP_UV]
        value.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(
        angle_limit=1.15192,
        margin_method="SCALED",
        rotate_method="AXIS_ALIGNED_Y",
        island_margin=0.006,
        area_weight=0.0,
        correct_aspect=True,
        scale_to_bounds=True,
    )
    bpy.ops.object.mode_set(mode="OBJECT")


def prepare_baked_materials(objects, image):
    materials = sorted(
        {material for value in objects for material in value.data.materials if material is not None},
        key=lambda material: material.name,
    )
    require(len(materials) == EXPECTED_BAKED_MATERIAL_COUNT, f"baked_material_count_mismatch:{len(materials)}")
    require(set(LIGHTMAP_INTENSITIES) == {material.name for material in materials}, "lightmap_intensity_map_drift")
    for material in materials:
        shader = principled_node(material)
        require(shader is not None, f"principled_shader_missing:{material.name}")
        nodes = material.node_tree.nodes
        for node_name in (LIGHTMAP_NODE, LIGHTMAP_UV_NODE):
            old = nodes.get(node_name)
            if old is not None:
                nodes.remove(old)
        texture = nodes.new("ShaderNodeTexImage")
        texture.name = LIGHTMAP_NODE
        texture.label = "Vrata baked irradiance"
        texture.image = image
        texture.interpolation = "Linear"
        texture.extension = "EXTEND"
        uv = nodes.new("ShaderNodeUVMap")
        uv.name = LIGHTMAP_UV_NODE
        uv.uv_map = LIGHTMAP_UV
        material.node_tree.links.new(uv.outputs["UV"], texture.inputs["Vector"])
        emission_color = shader.inputs.get("Emission Color")
        emission_strength = shader.inputs.get("Emission Strength")
        require(emission_color is not None and emission_strength is not None, f"emission_inputs_missing:{material.name}")
        original_color = list(emission_color.default_value[:3])
        original_intensity = float(emission_strength.default_value)
        material.node_tree.links.new(texture.outputs["Color"], emission_color)
        emission_strength.default_value = 1.0
        material["vrataRenderProfile"] = "baked-pbr-v1"
        material["vrataLightMap"] = True
        material["vrataLightMapIntensity"] = LIGHTMAP_INTENSITIES[material.name]
        material["vrataOriginalEmissive"] = original_color
        material["vrataOriginalEmissiveIntensity"] = original_intensity
    image.pack()
    return materials


def validate_panorama_material(excluded):
    materials = sorted(
        {material for value in excluded for material in value.data.materials if material is not None},
        key=lambda material: material.name,
    )
    require(len(materials) == 1 and materials[0].name == PANORAMA_MATERIAL, "panorama_material_set_drift")
    material = materials[0]
    require(material.get("vrataRenderProfile") == "baked-pbr-v1", "panorama_render_profile_missing")
    require(material.get("vrataLightMap") is False, "panorama_lightmap_flag_drift")
    require(material.get("vrataBakePolicy") == "exclude-unlit-background", "panorama_material_bake_policy_drift")
    require(material.get("vrataUnlit") is True and material.get("vrataColorSpace") == "sRGB", "panorama_unlit_srgb_contract_drift")
    require(material.get("vrataPanoramaSha256") == EXPECTED_PANORAMA_SHA256, "panorama_material_hash_drift")
    return material


def export_glb(path, objects):
    bpy.ops.object.select_all(action="DESELECT")
    for value in objects:
        value.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_cameras=False,
        export_lights=False,
        export_yup=True,
        export_extras=True,
        export_animations=False,
    )


def glb_document(path):
    with path.open("rb") as stream:
        header = stream.read(12)
        require(len(header) == 12, "glb_header_missing")
        magic, version, total_length = struct.unpack("<4sII", header)
        require(magic == b"glTF" and version == 2 and total_length == path.stat().st_size, "invalid_glb_header")
        chunk_length, chunk_type = struct.unpack("<II", stream.read(8))
        require(chunk_type == 0x4E4F534A, "glb_first_chunk_not_json")
        return json.loads(stream.read(chunk_length).decode("utf-8").rstrip(" \t\r\n\x00"))


def validate_glb(path, source_objects):
    document = glb_document(path)
    require(not document.get("cameras") and not document.get("animations"), "camera_or_animation_exported")
    require("KHR_lights_punctual" not in document.get("extensionsUsed", []), "light_extension_exported")
    mesh_nodes = [node for node in document.get("nodes", []) if "mesh" in node]
    require(len(mesh_nodes) == EXPECTED_MESH_COUNT, f"exported_mesh_count_mismatch:{len(mesh_nodes)}")
    require({node.get("name") for node in mesh_nodes} == {value.name for value in source_objects}, "exported_mesh_name_set_drift")
    for node in mesh_nodes:
        extras = node.get("extras", {})
        for tag in REQUIRED_TAGS:
            require(tag in extras, f"exported_tag_missing:{node.get('name')}:{tag}")
        mesh = document["meshes"][node["mesh"]]
        if extras["vrataBakePolicy"] == "include":
            for primitive in mesh["primitives"]:
                require("TEXCOORD_1" in primitive.get("attributes", {}), f"lightmap_uv1_missing:{node['name']}")
        else:
            require(node["name"] == PANORAMA_OBJECT, f"unexpected_export_exclusion:{node['name']}")
    materials = document.get("materials", [])
    require(len(materials) == EXPECTED_MATERIAL_COUNT, f"exported_material_count_mismatch:{len(materials)}")
    panorama = next((material for material in materials if material.get("name") == PANORAMA_MATERIAL), None)
    require(panorama is not None, "exported_panorama_material_missing")
    panorama_extras = panorama.get("extras", {})
    require(panorama_extras.get("vrataLightMap") is False and panorama_extras.get("vrataUnlit") is True, "exported_panorama_material_contract_drift")
    require("emissiveTexture" in panorama or "KHR_materials_unlit" in panorama.get("extensions", {}), "panorama_not_unlit_or_emissive")
    scene = document["scenes"][document.get("scene", 0)]
    require(scene.get("extras", {}).get("vrataSceneId") == SCENE_ID, "exported_scene_id_missing")
    require(scene.get("extras", {}).get("vrataAuthoringRelease") == RELEASE_VERSION, "exported_release_tag_missing")
    return document


def main():
    args = arguments()
    assert_output = runpy.run_path(str(Path(__file__).resolve().parents[2] / "write_safety.py"))["assert_output"]
    output = assert_output(args.output, scratch=True)
    lightmap_path = Path(args.lightmap).resolve()
    current_blend = Path(bpy.data.filepath).resolve() if bpy.data.filepath else None
    require(current_blend is not None and current_blend.name == "review-scene.blend", "versioned_review_blend_required")
    require(output.suffix.lower() == ".glb" and output != current_blend, "invalid_glb_output")
    assert_toolchain()
    objects = visible_runtime_meshes()
    baked, excluded, statuses = validate_source(objects, lightmap_path)
    unwrap_lightmap(baked)
    image = bpy.data.images.load(str(lightmap_path), check_existing=False)
    image.name = "baked-lightmap"
    image.colorspace_settings.name = "sRGB"
    require(tuple(image.size) == (2048, 2048), "lightmap_dimensions_mismatch")
    materials = prepare_baked_materials(baked, image)
    validate_panorama_material(excluded)
    scene = bpy.context.scene
    scene["vrataLightMapTextureSlot"] = "emissiveTexture"
    scene["vrataLightMapTexCoord"] = 1
    scene["vrataLightMappedMaterialCount"] = len(materials)
    output.parent.mkdir(parents=True, exist_ok=True)
    export_glb(output, objects)
    document = validate_glb(output, objects)
    print(json.dumps({
        "bakedMaterialCount": len(materials),
        "bakedMeshCount": len(baked),
        "excludedMeshCount": len(excluded),
        "glbSha256": sha256(output),
        "interactionMeshStatuses": dict(sorted(statuses.items())),
        "materialCount": len(document.get("materials", [])),
        "meshCount": len([node for node in document.get("nodes", []) if "mesh" in node]),
        "output": output.name,
        "releaseVersion": RELEASE_VERSION,
        "textureCount": len(document.get("textures", [])),
    }, sort_keys=True))


if __name__ == "__main__":
    main()
