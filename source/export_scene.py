import argparse
from pathlib import Path
import sys

import bpy


def arguments():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])


def export_scene(output_path):
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    runtime = bpy.data.collections.get("Runtime")
    if runtime is None:
        raise RuntimeError("missing_runtime_collection")

    bpy.ops.object.select_all(action="DESELECT")
    selected = [obj for obj in runtime.all_objects if obj.type == "MESH" and not obj.hide_get()]
    if not selected:
        raise RuntimeError("empty_runtime_collection")
    for obj in sorted(selected, key=lambda item: item.name):
        obj.select_set(True)
    bpy.context.view_layer.objects.active = sorted(selected, key=lambda item: item.name)[0]

    bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_yup=True,
        export_extras=True,
        export_animations=False,
    )


if __name__ == "__main__":
    export_scene(arguments().output)
