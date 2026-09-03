"""Regression tests: execute each .poly example and compare to snapshots."""
import json, math, pytest
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
EXAMPLES_DIR = SCRIPT_DIR / "examples"
SNAPSHOT_DIR = SCRIPT_DIR / "snapshots"


def _load_meta():
    return json.loads((SNAPSHOT_DIR / "meta.json").read_text())


def _load_snapshot(filename):
    return json.loads((SNAPSHOT_DIR / f"{filename}.json").read_text())


@pytest.fixture(scope="module")
def tolerance():
    return _load_meta()["tolerance"]


def _poly_files():
    files = []
    for snap_path in sorted(SNAPSHOT_DIR.glob("*.poly.json")):
        snap = json.loads(snap_path.read_text())
        if snap is not None and "error" not in snap:
            files.append(snap_path.name.removesuffix(".json"))
    return files


@pytest.mark.parametrize("filename", _poly_files())
def test_example(filename, tolerance):
    from polyscript.executor import execute
    from polyscript.ocp_kernel import shape_info

    tol = tolerance
    expected = _load_snapshot(filename)
    poly_path = EXAMPLES_DIR / filename
    result = execute(poly_path.read_text(), source_dir=poly_path.parent)
    assert result is not None, f"{filename} produced no shape"
    info = shape_info(result._shape)

    # bbox (absolute tolerance)
    for i in range(3):
        assert abs(info["bbox"]["min"][i] - expected["bbox"]["min"][i]) <= tol["bbox"], \
            f"{filename}: bbox min[{i}] {info['bbox']['min'][i]} != {expected['bbox']['min'][i]}"
        assert abs(info["bbox"]["max"][i] - expected["bbox"]["max"][i]) <= tol["bbox"], \
            f"{filename}: bbox max[{i}] {info['bbox']['max'][i]} != {expected['bbox']['max'][i]}"

    # volume (relative tolerance)
    vol_tol = max(abs(expected["volume"]) * tol["volume_percent"] / 100, 0.01)
    assert abs(info["volume"] - expected["volume"]) <= vol_tol, \
        f"{filename}: volume {info['volume']} != {expected['volume']} (tol={vol_tol})"

    # topology (exact)
    assert info["topology"] == expected["topology"], \
        f"{filename}: topology {info['topology']} != {expected['topology']}"
