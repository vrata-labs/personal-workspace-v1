import argparse
from pathlib import Path
import subprocess
import runpy
import sys

import bpy


RELEASE_VERSION = "0.3.0"
SCRIPT_DIR = Path(__file__).resolve().parent
REVIEW_VIEWS = (
    "entry",
    "workspace",
    "reading",
    "diagonal-overview",
    "window-detail",
    "exterior-view",
    "owner-seat",
)


def arguments():
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description="Render fixed Personal Workspace 0.3.0 source review views.")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--view", action="append", choices=REVIEW_VIEWS)
    return parser.parse_args(values)


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def main():
    args = arguments()
    assert_output = runpy.run_path(str(SCRIPT_DIR.parents[1] / "write_safety.py"))["assert_output"]
    output_dir = assert_output(args.output_dir)
    require(output_dir == SCRIPT_DIR / "review", "review_output_must_be_versioned")
    require(bpy.context.scene.get("vrataAuthoringRelease") == RELEASE_VERSION, "versioned_review_blend_required")
    output_dir.mkdir(parents=True, exist_ok=True)
    views = args.view or REVIEW_VIEWS
    for view_id in views:
        assert_output(output_dir / f"{view_id}.png")
        assert_output(output_dir / f"{view_id}.webp")
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
    scene.view_settings.exposure = -0.28
    scene.view_settings.gamma = 1.0
    scene.eevee.taa_render_samples = 16

    for view_id in views:
        camera = bpy.data.objects.get(f"camera.review.0.3.0.{view_id}")
        require(camera is not None, f"missing_review_camera:{view_id}")
        png_path = output_dir / f"{view_id}.png"
        webp_path = output_dir / f"{view_id}.webp"
        scene.camera = camera
        scene.render.filepath = str(png_path)
        bpy.ops.render.render(write_still=True)
        subprocess.run([
            "cwebp",
            "-quiet",
            "-q",
            "90",
            "-metadata",
            "none",
            str(png_path),
            "-o",
            str(webp_path),
        ], check=True)
        png_path.unlink()
        require(webp_path.is_file() and webp_path.stat().st_size > 0, f"review_output_missing:{view_id}")
        print(f"Rendered source review {view_id}: {webp_path.name}")


if __name__ == "__main__":
    main()
