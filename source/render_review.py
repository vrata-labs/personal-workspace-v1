import argparse
from pathlib import Path
import sys

import bpy


REVIEW_VIEWS = ("entry", "workspace", "reading", "diagonal-overview")


def arguments():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True)
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])


def render_review(output_path):
    output_dir = Path(output_path)
    output_dir.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 960
    scene.render.resolution_y = 540
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGB"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -0.2
    scene.view_settings.gamma = 1.0
    scene.render.filepath = ""
    scene.eevee.taa_render_samples = 16

    for view_id in REVIEW_VIEWS:
        camera = bpy.data.objects.get(f"camera.review.{view_id}")
        if camera is None:
            raise RuntimeError(f"missing_review_camera:{view_id}")
        scene.camera = camera
        scene.render.filepath = str(output_dir / f"{view_id}.png")
        bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    render_review(arguments().output_dir)
