"""Acquire public CC0 material inputs with actual source-byte records."""
import hashlib
import json
from pathlib import Path
import sys
import time
import urllib.request
import subprocess

HEADERS = {"User-Agent": "Vrata scene authoring / public CC0 acquisition"}


def get(url):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=180) as response:
                return response.read()
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2)


def main():
    root = Path(sys.argv[1]).resolve()
    assert root.name in ("personal-workspace-v1", "presentation-room-v1")
    target = root / "source/releases/0.4.0/textures"
    target.mkdir(parents=True, exist_ok=True)
    license_url = "https://polyhaven.com/license"
    license_bytes = get(license_url)
    (target / "polyhaven-license.html").write_bytes(license_bytes)
    records = []
    for asset in ("wood_floor", "wood_table_001", "fabric_pattern_05", "leather_red_02"):
        info_bytes = get(f"https://api.polyhaven.com/info/{asset}")
        info = json.loads(info_bytes)
        files = json.loads(get(f"https://api.polyhaven.com/files/{asset}"))
        (target / f"{asset}-info.json").write_bytes(info_bytes)
        for channel in ("diff", "nor_gl", "rough"):
            source_channel = ("Diffuse" if "Diffuse" in files else "col_01" if "col_01" in files else "coll1") if channel == "diff" else "Rough" if channel == "rough" else channel
            options = files[source_channel]["1k"]
            ext = "jpg" if "jpg" in options else "png"
            entry = options[ext]
            name = f"{asset}-{channel}.{ext}"
            data = get(entry["url"])
            if entry.get("md5"):
                assert hashlib.md5(data).hexdigest() == entry["md5"], name
            (target / name).write_bytes(data)
            records.append({"assetId": asset, "name": info["name"], "authors": info["authors"],
                "channel": channel, "publisherChannel": source_channel, "publisherMd5": entry.get("md5"), "file": name, "sourceUrl": entry["url"], "sourceInfoUrl": f"https://api.polyhaven.com/info/{asset}",
                "license": "CC0-1.0", "licenseUrl": license_url, "sizeBytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                "dimensionsMillimeters": info.get("dimensions")})
            print(f"{asset}/{channel}: {len(data)} bytes", flush=True)
    if root.name == "personal-workspace-v1":
        url = "https://dl.polyhaven.org/file/ph-assets/HDRIs/extra/Tonemapped%20JPG/cannon.jpg"
        data = get(url)
        assert hashlib.sha256(data).hexdigest() == "4e960796faa85fc88d8e8647a713c695bcba92f8b6b27832a28f436428425d30"
        source = target / "cannon.jpg"
        derived = target / "cannon-4k.jpg"
        source.write_bytes(data)
        subprocess.run(["convert", str(source), "-resize", "4096x2048!", "-quality", "85", "-strip", str(derived)], check=True)
        derived_data = derived.read_bytes()
        records.append({"assetId": "cannon", "authors": {"Greg Zaal": "All"}, "channel": "panorama-source", "file": "cannon.jpg", "sourceUrl": url,
            "license": "CC0-1.0", "licenseUrl": license_url, "sizeBytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
        records.append({"assetId": "cannon-4k", "authors": {"Greg Zaal": "All"}, "channel": "panorama", "file": "cannon-4k.jpg", "sourceAssetId": "cannon",
            "derivation": {"tool": "ImageMagick convert", "version": "6.9.12-98 Q16", "argv": ["-resize", "4096x2048!", "-quality", "85", "-strip"]},
            "license": "CC0-1.0", "licenseUrl": license_url, "sizeBytes": len(derived_data), "sha256": hashlib.sha256(derived_data).hexdigest(), "width": 4096, "height": 2048})
    (target / "source-ledger.json").write_text(json.dumps({"schemaVersion": 1, "licenseSnapshotSha256": hashlib.sha256(license_bytes).hexdigest(),
        "sourceLicenseEvidence": "public CC0 terms; no invented human approval", "records": records}, indent=2) + "\n")


main()
