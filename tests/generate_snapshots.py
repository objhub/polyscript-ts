#!/usr/bin/env python3
"""Generate regression snapshots from the Python implementation (frozen oracle).

Python (OCP/OCCT 7.9.3) is a second, separately written kernel, so a snapshot
it produced is evidence that the TypeScript geometry is right, not merely
unchanged. That is why these snapshots carry no `source` block: their
provenance is the oracle recorded in snapshots/meta.json.

There is also a TypeScript generator, generate_snapshots.ts. Snapshots it
writes carry `source.implementation = "typescript"` and mean something weaker:
they detect *change*, not correctness. Prefer this script while Python can
still evaluate the model; fall back to the TS one when the oracle cannot
(OCCT 7.9.3 has known gaps -- see devel/parity-ledger202609.md section 2) and
verify the numbers another way before committing them.

Regenerate only for a deliberate model or kernel change, and say so in the
commit. Never run either generator to make a red test green.
"""
import json, sys
from pathlib import Path
from datetime import datetime, timezone

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
EXAMPLES_DIR = SCRIPT_DIR / "examples"
SNAPSHOT_DIR = SCRIPT_DIR / "snapshots"


def generate():
    # python/src をパスに追加（プロジェクトルートから実行するため）
    sys.path.insert(0, str(PROJECT_ROOT / "python" / "src"))
    from polyscript.executor import execute
    from polyscript.ocp_kernel import shape_info

    SNAPSHOT_DIR.mkdir(exist_ok=True)
    poly_files = sorted(EXAMPLES_DIR.glob("*.poly"))
    count = 0

    for poly_file in poly_files:
        name = poly_file.name
        source = poly_file.read_text()
        snap_path = SNAPSHOT_DIR / f"{name}.json"
        try:
            result = execute(source, source_dir=poly_file.parent)
            if result is None:
                snap_path.write_text(json.dumps(None) + "\n")
                count += 1
                continue
            info = shape_info(result._shape)
            snap = {
                "bbox": {
                    "min": [round(v, 4) for v in info["bbox"]["min"]],
                    "max": [round(v, 4) for v in info["bbox"]["max"]],
                },
                "volume": round(info["volume"], 4),
                "topology": info["topology"],
            }
            snap_path.write_text(json.dumps(snap, indent=2) + "\n")
            print(f"  OK: {name}")
            count += 1
        except Exception as e:
            print(f"  WARN: {name}: {e}", file=sys.stderr)
            snap_path.write_text(json.dumps({"error": str(e)}, indent=2) + "\n")
            count += 1

    # meta.json carries the frozen-oracle record (which implementation and OCCT
    # produced these numbers, and why a regeneration is not routine). Keep it:
    # only stamp the regeneration date and the oracle versions actually used.
    import OCP
    meta_path = SNAPSHOT_DIR / "meta.json"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    meta.setdefault("generator", "polyscript-python")
    meta.setdefault("frozen", True)
    meta.setdefault("tolerance", {"bbox": 0.1, "volume_percent": 1.0})
    meta["oracle"] = {
        "implementation": "python",
        "ocp_version": OCP.__version__,
        "occt_version": ".".join(OCP.__version__.split(".")[:3]),
    }
    meta["regenerated_at"] = datetime.now(timezone.utc).isoformat()
    meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n")
    print(f"Generated {count} snapshots -> {SNAPSHOT_DIR}/")


if __name__ == "__main__":
    generate()
