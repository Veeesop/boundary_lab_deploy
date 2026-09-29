"""Release gates must reject mutable dependencies and inconsistent versions."""

import hashlib
import json
import runpy
from pathlib import Path

import pytest


@pytest.fixture
def release(tmp_path, monkeypatch):
    functions = runpy.run_path(str(Path(__file__).resolve().parents[1] / "scripts/release_tools.py"))
    monkeypatch.setitem(functions["check"].__globals__, "ROOT", tmp_path)
    (tmp_path / "pyproject.toml").write_text('[project]\nname="beat-engine"\nversion="1.2.3"\n')
    (tmp_path / "docs/releases").mkdir(parents=True)
    (tmp_path / "docs/releases/1.2.3.md").write_text("Release notes")
    return tmp_path, functions


def test_rejects_wrong_tag_and_missing_notes(release):
    root, functions = release
    functions["check"]("v1.2.3")
    with pytest.raises(ValueError, match="tag"):
        functions["check"]("v1.2.4")
    (root / "docs/releases/1.2.3.md").unlink()
    with pytest.raises(ValueError, match="notes"):
        functions["check"]("v1.2.3")


@pytest.mark.parametrize(
    "dependency", ["beat-engine>=0.1.4", "beat-engine @ git+https://github.com/JWSound/BEAT_Engine.git@main"]
)
def test_rejects_unpinned_engine(release, dependency):
    root, functions = release
    with (root / "pyproject.toml").open("a") as output:
        output.write("dependencies = [" + json.dumps(dependency) + "]\n")
    with pytest.raises(ValueError, match="published BEAT"):
        functions["check"]("v1.2.3")


@pytest.mark.parametrize("owner", ["JWSound", "Veeesop"])
def test_accepts_release_pinned_beat_wheel_from_supported_fork(release, owner):
    root, functions = release
    dependency = (
        f"beat-engine @ https://github.com/{owner}/BEAT_Engine/releases/download/"
        "v0.4.0rc1/beat_engine-0.4.0rc1-py3-none-any.whl#sha256=" + "a" * 64
    )
    with (root / "pyproject.toml").open("a") as output:
        output.write("dependencies = [" + json.dumps(dependency) + "]\n")
    functions["check"]("v1.2.3")


def test_checksums_cover_exact_artifact_bytes(release):
    root, functions = release
    dist = root / "dist"
    dist.mkdir()
    payload = b"candidate artifact"
    (dist / "package.whl").write_bytes(payload)
    functions["checksums"](dist)
    expected = hashlib.sha256(payload).hexdigest() + "  package.whl\n"
    assert (dist / "SHA256SUMS.txt").read_text() == expected
    functions["checksums"](dist)
    assert (dist / "SHA256SUMS.txt").read_text() == expected


def test_engine_manifest_version_must_match(release):
    root, functions = release
    contract = root / "src/beat_engine/beat_contract/worker-v1.json"
    contract.parent.mkdir(parents=True)
    contract.write_text('{"engine":{"version":"0.0.0"}}')
    with pytest.raises(ValueError, match="manifest version"):
        functions["check"]("v1.2.3")


def test_cuda_inventory_rejects_a_worker_ready_but_gpu_incomplete_bundle():
    functions = runpy.run_path(str(Path(__file__).resolve().parents[1] / "scripts/build_runtime.py"))
    check = functions["validate_cuda_inventory"]
    with pytest.raises(RuntimeError, match="Incomplete CUDA"):
        check(["runtime/python/python.exe", "runtime/julia/bin/julia.exe"])
    complete = [
        "bin/" + name
        for name in [
            "cublas64_13.dll",
            "cublasLt64_13.dll",
            "cudart64_13.dll",
            "cusolver64_12.dll",
            "cusparse64_12.dll",
            "nvJitLink_130_0.dll",
            "cudss64_0.dll",
            "ptxas.exe",
        ]
    ]
    check(complete)
    with pytest.raises(RuntimeError, match="ptxas"):
        check(complete[:-1])
