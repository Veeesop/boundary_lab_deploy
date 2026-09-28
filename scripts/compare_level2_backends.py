"""Compare Deploy Level 2 CPU and Metal results on an identical scene."""

from __future__ import annotations

import argparse
import json
import math
import tempfile
import zipfile
from pathlib import Path
from typing import Any

import numpy as np

from boundary_deploy.solve import prepare_deploy_solve_request
from boundary_deploy.worker import _worker

DEFAULT_MAX_RELATIVE_COMPLEX_PRESSURE_L2 = 1e-4
DEFAULT_MAX_ABSOLUTE_SPL_DIFFERENCE_DB = 0.01


def _non_negative_finite(value: str) -> float:
    try:
        parsed = float(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("tolerance must be a finite non-negative number") from exc
    if not math.isfinite(parsed) or parsed < 0.0:
        raise argparse.ArgumentTypeError("tolerance must be a finite non-negative number")
    return parsed


def _comparison_metrics(
    cpu_pressure: np.ndarray,
    metal_pressure: np.ndarray,
    cpu_spl: np.ndarray,
    metal_spl: np.ndarray,
) -> dict[str, float]:
    if cpu_pressure.shape != metal_pressure.shape or cpu_pressure.size == 0:
        raise RuntimeError("CPU and Metal returned different or empty field-pressure arrays")
    if not np.isfinite(cpu_pressure).all() or not np.isfinite(metal_pressure).all():
        raise RuntimeError("CPU or Metal returned non-finite complex pressure")
    if (
        cpu_spl.shape != metal_spl.shape
        or cpu_spl.size != cpu_pressure.size
        or not np.isfinite(cpu_spl).all()
        or not np.isfinite(metal_spl).all()
    ):
        raise RuntimeError("CPU and Metal returned invalid or mismatched SPL arrays")

    difference = metal_pressure - cpu_pressure
    return {
        "relative_complex_pressure_l2": float(
            np.linalg.norm(difference) / max(np.linalg.norm(cpu_pressure), np.finfo(float).tiny)
        ),
        "maximum_absolute_complex_pressure_difference": float(np.max(np.abs(difference))),
        "maximum_absolute_spl_difference_db": float(np.max(np.abs(metal_spl - cpu_spl))),
    }


def _comparison_acceptance(
    metrics: dict[str, float],
    *,
    max_relative_complex_pressure_l2: float,
    max_absolute_spl_difference_db: float,
) -> dict[str, Any]:
    checks = {
        "relative_complex_pressure_l2": metrics["relative_complex_pressure_l2"]
        <= max_relative_complex_pressure_l2,
        "maximum_absolute_spl_difference_db": metrics["maximum_absolute_spl_difference_db"]
        <= max_absolute_spl_difference_db,
    }
    return {
        "limits": {
            "max_relative_complex_pressure_l2": max_relative_complex_pressure_l2,
            "max_absolute_spl_difference_db": max_absolute_spl_difference_db,
        },
        "checks": checks,
        "passed": all(checks.values()),
    }


def _payload(case: str, package_path: Path, frequency_hz: float) -> dict[str, Any]:
    sources: list[dict[str, Any]]
    if case == "close-speakers":
        sources = [
            {"id": "speaker-a", "positionX": 0.0, "positionHeightM": 0.4, "positionZ": 0.0},
            {"id": "speaker-b", "positionX": 1.21, "positionHeightM": 0.4, "positionZ": 0.0},
        ]
    elif case == "ground-image":
        sources = [{"id": "speaker-a", "positionX": 0.0, "positionHeightM": 0.2795, "positionZ": 0.0}]
    else:
        sources = [{"id": "speaker-a", "positionX": 0.0, "positionHeightM": 0.6, "positionZ": 0.0}]

    return {
        "packagePath": str(package_path),
        "frequencyHz": frequency_hz,
        "fidelity": "boundary",
        "sources": sources,
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


def _solve(payload: dict[str, Any], backend: str) -> dict[str, Any]:
    request_payload = {**payload, "backend": backend}
    worker = None
    try:
        with tempfile.TemporaryDirectory(prefix=f"deploy-{backend}-parity-") as directory:
            request_path, _ = prepare_deploy_solve_request(request_payload, directory)
            worker = _worker(backend)
            result = None
            for event in worker.submit(request_path, operation="solve", status_callback=lambda _message: None):
                if event.get("type") in {"failed", "error"}:
                    raise RuntimeError(str(event.get("error", event)))
                if event.get("type") == "result":
                    result = event["result"]
            if result is None:
                raise RuntimeError(f"BEAT {backend} returned no Deploy Level 2 result")
            return result
    finally:
        if worker is not None:
            worker.terminate()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", choices=("baseline", "close-speakers", "ground-image"), default="baseline")
    parser.add_argument("--package", type=Path, default=Path("desktop/library/S218BP_LOD.blabsp"))
    parser.add_argument("--frequency-hz", type=float, default=80.0)
    parser.add_argument(
        "--max-relative-complex-pressure-l2",
        type=_non_negative_finite,
        default=DEFAULT_MAX_RELATIVE_COMPLEX_PRESSURE_L2,
        help="maximum CPU-relative complex-pressure L2 difference (default: %(default)g)",
    )
    parser.add_argument(
        "--max-absolute-spl-difference-db",
        type=_non_negative_finite,
        default=DEFAULT_MAX_ABSOLUTE_SPL_DIFFERENCE_DB,
        help="maximum absolute SPL difference in dB (default: %(default)g)",
    )
    args = parser.parse_args()

    package_path = args.package.resolve()
    with zipfile.ZipFile(package_path, "r") as archive:
        frequencies = json.loads(archive.read("manifest.json"))["frequencies_hz"]
    frequency_hz = min((float(value) for value in frequencies), key=lambda value: abs(value - args.frequency_hz))
    payload = _payload(args.case, package_path, frequency_hz)
    cpu = _solve(payload, "cpu")
    metal = _solve(payload, "metal")

    cpu_pressure = cpu["field_pressure"]
    metal_pressure = metal["field_pressure"]
    cpu_values = np.asarray(cpu_pressure["real"], dtype=np.float64) + 1j * np.asarray(
        cpu_pressure["imag"], dtype=np.float64
    )
    metal_values = np.asarray(metal_pressure["real"], dtype=np.float64) + 1j * np.asarray(
        metal_pressure["imag"], dtype=np.float64
    )
    cpu_spl = np.asarray(cpu["spl_db"], dtype=np.float64)
    metal_spl = np.asarray(metal["spl_db"], dtype=np.float64)
    metrics = _comparison_metrics(cpu_values, metal_values, cpu_spl, metal_spl)
    acceptance = _comparison_acceptance(
        metrics,
        max_relative_complex_pressure_l2=args.max_relative_complex_pressure_l2,
        max_absolute_spl_difference_db=args.max_absolute_spl_difference_db,
    )

    correction_diagnostics = {
        "close_pair_count": int(cpu["diagnostics"].get("close_pair_count", 0)),
        "near_face_pair_count": int(cpu["diagnostics"].get("near_face_pair_count", 0)),
        "ground_image_near_face_pair_count": int(cpu["diagnostics"].get("ground_image_near_face_pair_count", 0)),
    }
    if args.case == "close-speakers" and correction_diagnostics["near_face_pair_count"] == 0:
        raise RuntimeError("close-speakers case did not generate near-face correction pairs")
    if args.case == "ground-image" and correction_diagnostics["ground_image_near_face_pair_count"] == 0:
        raise RuntimeError("ground-image case did not generate ground-image correction pairs")

    print(json.dumps({
        "case": args.case,
        "package": str(package_path),
        "frequency_hz": frequency_hz,
        "correction_diagnostics": correction_diagnostics,
        "metal_backend": metal["diagnostics"]["backend"],
        **metrics,
        "acceptance": acceptance,
        "cpu_spl_db": cpu_spl.tolist(),
        "metal_spl_db": metal_spl.tolist(),
    }, indent=2))
    if not acceptance["passed"]:
        raise SystemExit("CPU/Metal comparison exceeded one or more numerical tolerances")


if __name__ == "__main__":
    main()
