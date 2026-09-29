from __future__ import annotations

import json
import threading
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from boundary_deploy import worker as deploy_worker


class _PackageCache:
    def load_package(self, _path: Path):
        return SimpleNamespace(frequencies=np.asarray([40.0, 20.0, 40.0]))


class _CoupledPackageCache:
    def __init__(self, representation: str):
        self.representation = representation

    def load_package(self, _path: Path):
        model = {"representation": self.representation, "frequency_band_hz": [20.0, 40.0]}
        return SimpleNamespace(
            frequencies=np.asarray([10.0, 20.0, 40.0, 80.0]),
            coupled_model=model,
            manifest={},
        )


class _SweepWorker:
    def submit(self, request_path: Path, **_kwargs):
        request = json.loads(request_path.read_text(encoding="utf-8"))
        microphone_count = len(request["observation_points_m"])
        for frequency in request["frequencies_hz"]:
            yield {
                "type": "result",
                "result": {
                    "frequency_hz": frequency,
                    "spl_db": [frequency + index for index in range(microphone_count)],
                    "field_pressure": {
                        "real": [frequency / 100.0 for _ in range(microphone_count)],
                        "imag": [0.0 for _ in range(microphone_count)],
                    },
                },
            }
        yield {"type": "completed"}


def _payload() -> dict:
    return {
        "packagePath": "speaker.blabsp",
        "backend": "cuda",
        "sources": [{"id": "source"}],
        "microphones": [
            {"id": "mic-a", "positionX": 0.0, "positionHeightM": 1.2, "positionZ": 4.0},
            {"id": "mic-b", "positionX": 2.0, "positionHeightM": 1.2, "positionZ": 6.0},
        ],
    }


def test_microphone_sweep_uses_sorted_unique_package_frequencies(monkeypatch) -> None:
    events: list[tuple[str, dict]] = []

    def prepare(payload, work_dir, **_kwargs):
        path = Path(work_dir) / "request.json"
        request = {
            "frequencies_hz": [20.0, 40.0],
            "observation_points_m": payload["observationPointsM"],
        }
        path.write_text(json.dumps(request), encoding="utf-8")
        return path, request

    monkeypatch.setattr(deploy_worker, "prepare_deploy_microphone_sweep_request", prepare)
    monkeypatch.setattr(
        deploy_worker,
        "_emit",
        lambda event_type, **values: events.append((event_type, values)) or {},
    )
    deploy_worker._microphone_sweep(
        7,
        _payload(),
        {"cuda": _SweepWorker()},
        _PackageCache(),
        threading.Event(),
    )

    progress = [values for event_type, values in events if event_type == "microphone-progress"]
    result = next(values["result"] for event_type, values in events if event_type == "result")
    assert [value["frequency_hz"] for value in progress] == [20.0, 40.0]
    assert result["frequencies_hz"] == [20.0, 40.0]
    assert result["microphone_ids"] == ["mic-a", "mic-b"]
    assert result["spl_db"] == [[20.0, 40.0], [21.0, 41.0]]
    assert events[-1][0] == "completed"


def test_microphone_sweep_honors_stop_before_first_frequency(monkeypatch) -> None:
    event_types: list[str] = []
    monkeypatch.setattr(
        deploy_worker,
        "_emit",
        lambda event_type, **_values: event_types.append(event_type) or {},
    )
    cancel = threading.Event()
    cancel.set()

    deploy_worker._microphone_sweep(
        8,
        _payload(),
        {"cuda": _SweepWorker()},
        _PackageCache(),
        cancel,
    )

    assert event_types == ["cancelled"]


def test_level_three_rom_uses_the_shared_exterior_worker() -> None:
    assert deploy_worker._worker_key({"backend": "cuda"}) == "cuda"
    assert deploy_worker._worker_key({"backend": "cuda", "fidelity": "coupled"}) == "cuda"


def test_level_three_execution_rejects_exact_and_routes_rom_packages() -> None:
    payload = {"packagePath": "speaker.blabsp", "backend": "cuda", "fidelity": "coupled"}
    with pytest.raises(ValueError, match="parity Petrov"):
        deploy_worker._execution_worker_key(payload, _CoupledPackageCache("exact_frequency_parametric_fem"))
    assert deploy_worker._execution_worker_key(payload, _CoupledPackageCache("parity_petrov_galerkin_rom")) == "cuda"


def test_level_three_metal_execution_is_rejected_before_rom_loading() -> None:
    payload = {"packagePath": "speaker.blabsp", "backend": "metal", "fidelity": "coupled"}

    with pytest.raises(ValueError, match="Level 3.*CUDA"):
        deploy_worker._execution_worker_key(payload, _CoupledPackageCache("parity_petrov_galerkin_rom"))


def test_worker_selects_metal_julia_project(monkeypatch) -> None:
    monkeypatch.setattr(deploy_worker.sys, "platform", "darwin")
    captured = {}

    class Worker:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr(deploy_worker, "BeatEngineWorkerProcess", Worker)

    deploy_worker._worker("metal")

    assert captured["julia_project"] == deploy_worker.DEFAULT_BEAT_ENGINE_METAL_PROJECT


def test_worker_keeps_cuda_julia_project_selection(monkeypatch) -> None:
    captured = {}

    class Worker:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr(deploy_worker, "BeatEngineWorkerProcess", Worker)

    deploy_worker._worker("cuda")

    assert captured["julia_project"] == deploy_worker.DEFAULT_BEAT_ENGINE_CUDA_PROJECT


def test_worker_rejects_metal_warmup_off_macos(monkeypatch) -> None:
    monkeypatch.setattr(deploy_worker.sys, "platform", "linux")
    with pytest.raises(ValueError, match="only on macOS"):
        deploy_worker._worker("metal")


def test_transducer_velocity_result_flattens_scene_instances() -> None:
    request = {
        "transducers": [
            {"id": "left:transducer:0", "name": "Left / Transducer 1"},
            {"id": "left:transducer:1", "name": "Left / Transducer 2"},
            {"id": "right:transducer:0", "name": "Right / Transducer 1"},
            {"id": "right:transducer:1", "name": "Right / Transducer 2"},
        ]
    }
    result = {
        "diagnostics": {
            "transducer_velocity": [
                {"real": [1.0, 2.0], "imag": [0.1, 0.2]},
                {"real": [3.0, 4.0], "imag": [0.3, 0.4]},
            ]
        }
    }

    velocity = deploy_worker._transducer_velocity_result(result, request)

    assert velocity["ids"] == [item["id"] for item in request["transducers"]]
    assert velocity["names"][2] == "Right / Transducer 1"
    assert velocity["real"] == [1.0, 2.0, 3.0, 4.0]
    assert velocity["imag"] == [0.1, 0.2, 0.3, 0.4]


@pytest.mark.parametrize("rounded_frequencies", [False, True])
def test_coupled_excursion_sweep_does_not_require_a_microphone(monkeypatch, rounded_frequencies) -> None:
    events: list[tuple[str, dict]] = []
    frequencies = [20.0, 40.0] if not rounded_frequencies else [102.36312866210938, 231.57960510253906]
    reported_frequencies = [float(str(np.float32(frequency))) for frequency in frequencies]
    if rounded_frequencies:
        # Reproduce Float32 JSON rounding that previously dropped the reference.
        assert not np.any(np.isclose(frequencies, reported_frequencies, rtol=1e-8, atol=1e-8))
    package = SimpleNamespace(
        frequencies=np.asarray(frequencies),
        manifest={
            "medium": {"density_kg_per_m3": 1, "sound_speed_m_per_s": 100},
            "physical_system": {
                "components": [
                    {
                        "id": "driver",
                        "kind": "electrodynamic_transducer",
                        "parameters": {
                            "bl_n_per_a": 2,
                            "rms_n_s_per_m": 1,
                            "cms_m_per_n": 0.001,
                            "mmd_kg": 0.1,
                        },
                    }
                ],
                "metadata": {"acoustic_impedance_normalization": {"driver": {"effective_area_m2": 0.01}}},
            },
        },
        coupled_model={
            "representation": "parity_petrov_galerkin_rom",
            "arrays": {"frequencies_hz": np.asarray(frequencies)},
        },
    )
    cache = SimpleNamespace(load_package=lambda _path: package)

    def prepare(payload, work_dir, **_kwargs):
        assert payload["observationPointsM"] == [[0.0, 1.0, 1.0]]
        path = Path(work_dir) / "request.json"
        request = {
            "frequencies_hz": frequencies,
            "transducers": [{"id": "source:transducer:0", "name": "Source / Transducer 1"}],
        }
        path.write_text(json.dumps(request), encoding="utf-8")
        return path, request

    class Worker:
        def submit(self, _request_path, **_kwargs):
            for frequency, velocity in zip(reported_frequencies, (2.0, 4.0), strict=True):
                yield {
                    "type": "result",
                    "result": {
                        "frequency_hz": frequency,
                        "spl_db": [80.0],
                        "field_pressure": {"real": [0.2], "imag": [0.0]},
                        "diagnostics": {
                            "transducer_velocity": [{"real": [velocity], "imag": [0.0]}],
                            "transducer_current": [{"real": [velocity], "imag": [0.0]}],
                        },
                    },
                }
            yield {"type": "completed"}

    monkeypatch.setattr(deploy_worker, "prepare_deploy_rom_microphone_sweep_request", prepare)
    monkeypatch.setattr(deploy_worker, "_emit", lambda event_type, **values: events.append((event_type, values)) or {})
    deploy_worker._microphone_sweep(
        9,
        {
            "packagePath": "speaker.blabsp",
            "backend": "cuda",
            "fidelity": "coupled",
            "sources": [{"id": "source"}],
            "microphones": [],
        },
        {"cuda": Worker()},
        cache,
        threading.Event(),
    )

    result = next(values["result"] for event_type, values in events if event_type == "result")
    assert result["microphone_ids"] == []
    assert result["transducer_ids"] == ["source:transducer:0"]
    assert result["transducer_velocity"] == {"real": [[2.0, 4.0]], "imag": [[0.0, 0.0]]}
    assert result["acoustic_loading"]["resistance"] == [[1.0, 1.0]]
    assert result["frequencies_hz"] == frequencies
    assert not any(key.startswith("isolated_") for key in result["acoustic_loading"])
    progress = [values for event_type, values in events if event_type == "microphone-progress"]
    assert [sample["frequency_hz"] for sample in progress] == reported_frequencies
    for frequency_index, sample in enumerate(progress):
        for key, rows in result["acoustic_loading"].items():
            assert sample["acoustic_loading"][key] == [row[frequency_index] for row in rows]


def test_speaker_electrical_result_sums_coil_current_per_cabinet() -> None:
    request = {
        "speakers": [{"id": "cabinet-a", "name": "Cabinet A"}],
        "transducers": [
            {"source_id": "cabinet-a", "physical_driver_orbit_count": 1},
            {"source_id": "cabinet-a", "physical_driver_orbit_count": 2},
        ],
        "rom_sweep": {
            "frequencies": [
                {
                    "instances": [
                        {
                            "input_real": [2.83, 2.83],
                            "input_imag": [0.0, 0.0],
                        }
                    ]
                }
            ]
        },
    }
    result = {
        "diagnostics": {
            "transducer_current": [
                {
                    "real": [0.1, 0.2],
                    "imag": [-0.01, -0.02],
                }
            ]
        }
    }

    electrical = deploy_worker._speaker_electrical_result(result, request, 0)

    assert electrical["ids"] == ["cabinet-a"]
    assert electrical["voltage_real"] == [2.83]
    assert electrical["current_real"] == pytest.approx([0.5])
    assert electrical["current_imag"] == pytest.approx([-0.05])


def test_solution_identity_excludes_planes_but_tracks_physics_and_files(tmp_path):
    package = tmp_path / "speaker.blabsp"
    package.write_bytes(b"package")
    mesh = tmp_path / "rigid.msh"
    mesh.write_bytes(b"mesh")
    payload = {"packagePaths": {"a": str(package)}, "frequencyHz": 40,
               "sources": [{"id": "a", "levelDb": 0, "delayMs": 0}],
               "fidelity": "coupled", "rigidObjects": [{"meshPath": str(mesh)}]}
    key = deploy_worker._solution_identity(payload)
    assert deploy_worker._solution_identity({**payload, "observation": {"heightM": 4},
        "reuseBoundary": True, "solutionKey": "untrusted", "includeComplexPressure": True}) == key
    for change in [{"frequencyHz": 80}, {"fidelity": "boundary"},
                   {"sources": [{"id": "a", "levelDb": 1, "delayMs": 0}]},
                   {"sources": [{"id": "a", "levelDb": 0, "delayMs": 1}]}]:
        assert deploy_worker._solution_identity({**payload, **change}) != key
    package.write_bytes(b"changed package")
    assert deploy_worker._solution_identity(payload) != key
    key = deploy_worker._solution_identity(payload)
    mesh.write_bytes(b"changed mesh")
    assert deploy_worker._solution_identity(payload) != key


def test_solve_reuse_validates_physics_and_invalidates_failed_jobs(tmp_path, monkeypatch):
    package = tmp_path / "speaker.blabsp"
    package.write_bytes(b"package")
    payload = {"packagePath": str(package), "fidelity": "coupled", "frequencyHz": 40,
               "sources": [{"levelDb": 0}], "solutionKey": "same-renderer-key"}
    monkeypatch.setattr(deploy_worker, "_execution_worker_key", lambda *_: "cuda")
    monkeypatch.setattr(deploy_worker, "_emit", lambda *a, **k: {"json_encode_s": 0, "stdout_bytes": 0})
    def prepare(payload, directory, **kwargs):
        path = Path(directory) / "request.json"
        path.write_text("{}")
        return path, {"solution_key": payload["solutionKey"]}
    monkeypatch.setattr(deploy_worker, "prepare_deploy_rom_request", prepare)
    monkeypatch.setattr(deploy_worker, "prepare_deploy_field_request", prepare)
    class Worker:
        operations = []
        fail = False
        def submit(self, path, **kwargs):
            self.operations.append(kwargs["operation"])
            if self.fail:
                raise RuntimeError("worker failed")
            yield {"type": "result", "result": {}}
            yield {"type": "completed"}
    worker = Worker()
    keys = {}
    def run(value):
        deploy_worker._solve(1, value, {"cuda": worker}, {}, None, keys)
    run(payload)
    run({**payload, "reuseBoundary": True, "observation": {"heightM": 3}})
    run({**payload, "reuseBoundary": True, "observation": {"heightM": 4}})
    run({**payload, "reuseBoundary": True, "sources": [{"levelDb": 2}]})
    assert worker.operations == ["solve", "field", "field", "solve"]
    worker.fail = True
    with pytest.raises(RuntimeError, match="worker failed"):
        run(payload)
    assert keys == {}


def test_completion_follows_cleanup_and_accepts_immediate_next_job(monkeypatch):
    import io
    cleaned = []
    completed = threading.Event()
    output = io.StringIO()
    class Output:
        def write(self, text):
            message = json.loads(text)
            if message["type"] == "completed":
                assert message["id"] in cleaned
                completed.set()
            return output.write(text)
        def flush(self):
            pass
    def solve(request_id, *args):
        deploy_worker._emit("completed", request_id=request_id)
        cleaned.append(request_id)
    def lines():
        for request_id in (1, 2):
            completed.clear()
            yield json.dumps({"id": request_id, "operation": "solve", "payload": {}})
            assert completed.wait(5)
    monkeypatch.setattr(deploy_worker, "_solve", solve)
    monkeypatch.setattr(deploy_worker, "_execution_worker_key", lambda *_: "cuda")
    monkeypatch.setattr(deploy_worker.sys, "stdin", lines())
    monkeypatch.setattr(deploy_worker.sys, "stdout", Output())
    assert deploy_worker.main() == 0
    events = [json.loads(line) for line in output.getvalue().splitlines()]
    assert [event["id"] for event in events if event["type"] == "completed"] == [1, 2]
    assert not any(event["type"] == "failed" for event in events)


@pytest.mark.parametrize(
    "platform, backend, available, expected",
    [
        ("win32", "cuda", True, "cuda"),
        ("win32", "cuda", False, "cpu"),
        ("darwin", "metal", True, "metal"),
        ("darwin", "metal", False, "cpu"),
        ("darwin", "cuda", True, "cuda"),
        ("darwin", "cuda", False, "cpu"),
    ],
)
def test_detect_backend_uses_requested_engine_availability(monkeypatch, platform, backend, available, expected):
    calls = []

    class Probe:
        def __init__(self, **kwargs):
            assert kwargs["solver_script"].name == "coupled_solver.jl"
            assert kwargs["julia_project"] == getattr(deploy_worker, f"DEFAULT_BEAT_ENGINE_{backend.upper()}_PROJECT")
            self.worker_info = {"backends": {backend: {"available": available}}}

        def ensure_started(self):
            calls.append("start")

        def terminate(self):
            calls.append("stop")

    monkeypatch.setattr(deploy_worker, "BeatEngineWorkerProcess", Probe)
    monkeypatch.setattr(deploy_worker.sys, "platform", platform)
    assert deploy_worker.detect_solver_backend(backend) == expected
    assert calls == ["start", "stop"]


def test_detect_backend_falls_back_and_cleans_up_on_failure(monkeypatch):
    stopped = []
    class Probe:
        def __init__(self, **kwargs):
            pass
        def ensure_started(self):
            raise RuntimeError("No CUDA driver")
        def terminate(self):
            stopped.append(True)
    monkeypatch.setattr(deploy_worker, "BeatEngineWorkerProcess", Probe)
    assert deploy_worker.detect_solver_backend() == "cpu"
    assert stopped == [True]


@pytest.mark.parametrize("backend", ["cpu", "rocm", "unknown"])
def test_detect_backend_rejects_non_accelerator_backend(backend):
    with pytest.raises(ValueError, match="CUDA or Metal"):
        deploy_worker.detect_solver_backend(backend)
