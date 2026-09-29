"""Exercise Metal Deploy solve, field reuse, failure recovery, and sweep cleanup."""

from __future__ import annotations

import argparse
import json
import tempfile
import zipfile
from pathlib import Path
from typing import Any

from boundary_deploy.solve import (
    prepare_deploy_field_request,
    prepare_deploy_microphone_sweep_request,
    prepare_deploy_solve_request,
)
from boundary_deploy.worker import _worker


def _submit(worker: Any, request_path: Path, *, operation: str = "solve", expect_failure: bool = False) -> list[dict[str, Any]]:
    events = list(worker.submit(request_path, operation=operation, status_callback=lambda _message: None))
    errors = [str(event.get("error", event)) for event in events if event.get("type") in {"failed", "error"}]
    results = [event["result"] for event in events if event.get("type") == "result"]
    if expect_failure:
        if not errors:
            raise RuntimeError("Expected the lifecycle failure request to fail")
    elif errors:
        raise RuntimeError("; ".join(errors))
    elif not results:
        raise RuntimeError(f"BEAT returned no result for {operation}")
    return results


def _prepare_and_submit(worker: Any, prepare, payload: dict[str, Any], directory: Path, *, operation="solve"):
    request_path, request = prepare(payload, directory)
    return _submit(worker, request_path, operation=operation), request


def _field_payload(package_path: Path, frequency_hz: float, solution_key: str) -> dict[str, Any]:
    return {
        "packagePath": str(package_path),
        "frequencyHz": frequency_hz,
        "backend": "metal",
        "solutionKey": solution_key,
        "observation": {
            "widthM": 2.0,
            "depthM": 2.0,
            "nearM": 2.0,
            "heightM": 1.2,
            "columns": 3,
            "rows": 3,
        },
        "includeComplexPressure": True,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path, default=Path("desktop/library/S218BP_LOD.blabsp"))
    args = parser.parse_args()

    package_path = args.package.resolve()
    with zipfile.ZipFile(package_path, "r") as archive:
        frequencies = [float(value) for value in json.loads(archive.read("manifest.json"))["frequencies_hz"]]
    if len(frequencies) < 2:
        raise RuntimeError("Lifecycle smoke requires at least two package frequencies")
    frequency_hz = min(frequencies, key=lambda value: abs(value - 80.0))
    solve_payload = {
        **_field_payload(package_path, frequency_hz, "metal-lifecycle-initial"),
        "fidelity": "boundary",
        "sources": [{"id": "lifecycle-source", "positionX": 0.0, "positionHeightM": 0.6, "positionZ": 0.0}],
    }
    worker = _worker("metal")
    completed: dict[str, Any] = {"normal_solve": False, "field_reuse": False, "failed_solve_recovery": False}
    try:
        with tempfile.TemporaryDirectory(prefix="deploy-metal-lifecycle-") as root:
            work = Path(root)
            normal, solve_request = _prepare_and_submit(
                worker, prepare_deploy_solve_request, solve_payload, work / "normal"
            )
            completed["normal_solve"] = len(normal) == 1
            solution_key = str(solve_request["solution_key"])

            field_results, _ = _prepare_and_submit(
                worker,
                prepare_deploy_field_request,
                _field_payload(package_path, frequency_hz, solution_key),
                work / "field-reuse",
                operation="field",
            )
            completed["field_reuse"] = len(field_results) == 1

            failed_payload = {**solve_payload, "solutionKey": ""}
            _, failed_request = prepare_deploy_solve_request(failed_payload, work / "expected-failure")
            failed_request["solution_key"] = ""
            Path(failed_request_path := work / "expected-failure" / "request.json").write_text(
                json.dumps(failed_request, separators=(",", ":"), allow_nan=False), encoding="utf-8"
            )
            _submit(worker, failed_request_path, expect_failure=True)
            recovered_results, _ = _prepare_and_submit(
                worker,
                prepare_deploy_field_request,
                _field_payload(package_path, frequency_hz, solution_key),
                work / "recovery-field",
                operation="field",
            )
            completed["failed_solve_recovery"] = len(recovered_results) == 1

            sweep_payload = {
                **solve_payload,
                "includeComplexPressure": True,
                "observationPointsM": [[0.0, 1.2, 4.0], [1.0, 1.2, 5.0]],
            }
            sweep_path, sweep_request = prepare_deploy_microphone_sweep_request(
                sweep_payload,
                work / "sweep",
            )
            sweep_request["frequencies_hz"] = sweep_request["frequencies_hz"][:2]
            for name in (
                "boundary_neumann_sweep",
                "reference_boundary_pressure_sweep",
            ):
                sweep_request[name]["real"] = sweep_request[name]["real"][:2]
                sweep_request[name]["imag"] = sweep_request[name]["imag"][:2]
            sweep_path.write_text(json.dumps(sweep_request, separators=(",", ":"), allow_nan=False), encoding="utf-8")
            sweep_results = _submit(worker, sweep_path)
            if len(sweep_results) != 2:
                raise RuntimeError(f"Retained-cache sweep returned {len(sweep_results)} results; expected 2")
            completed["retained_geometry_sweep_frequencies"] = len(sweep_results)

            sweep_key = str(sweep_request["geometry_key"])
            sweep_solution_key = f"{sweep_key}:{sweep_request['frequencies_hz'][-1]}"
            stale_field_path, _ = prepare_deploy_field_request(
                _field_payload(package_path, sweep_request["frequencies_hz"][-1], sweep_solution_key),
                work / "released-sweep-field",
            )
            _submit(worker, stale_field_path, operation="field", expect_failure=True)
            completed["sweep_releases_boundary_and_geometry"] = True

            final_solve, _ = _prepare_and_submit(
                worker,
                prepare_deploy_solve_request,
                {**solve_payload, "solutionKey": "metal-lifecycle-final"},
                work / "final",
            )
            completed["solve_after_sweep_cleanup"] = len(final_solve) == 1
    finally:
        worker.terminate()

    print(json.dumps({"backend": "metal", "package": str(package_path), "checks": completed}, indent=2))


if __name__ == "__main__":
    main()
