"""Opt-in Deploy Level 2 solve smoke test for the BEAT Metal backend."""

from __future__ import annotations

import argparse
import json
import math
import tempfile
import zipfile
from pathlib import Path

import numpy as np

from boundary_deploy.solve import prepare_deploy_solve_request
from boundary_deploy.worker import _worker


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend", choices=("metal", "cpu", "cuda"), default="metal")
    parser.add_argument("--package", type=Path, default=Path("desktop/library/S21HL.blabsp"))
    parser.add_argument("--frequency-hz", type=float, default=80.0)
    args = parser.parse_args()

    package = args.package.resolve()
    with zipfile.ZipFile(package, "r") as archive:
        frequencies = json.loads(archive.read("manifest.json"))["frequencies_hz"]
    frequency_hz = min((float(value) for value in frequencies), key=lambda value: abs(value - args.frequency_hz))
    payload = {
        "packagePath": str(package),
        "frequencyHz": frequency_hz,
        "backend": args.backend,
        "fidelity": "boundary",
        "sources": [{"id": "smoke-source", "positionX": 0.0, "positionHeightM": 1.0, "positionZ": 0.0}],
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
    worker = None
    try:
        with tempfile.TemporaryDirectory(prefix="deploy-metal-smoke-") as directory:
            request_path, request = prepare_deploy_solve_request(payload, directory)
            worker = _worker(args.backend)
            result = None
            for event in worker.submit(request_path, operation="solve", status_callback=lambda _message: None):
                if event.get("type") in {"failed", "error"}:
                    raise RuntimeError(str(event.get("error", event)))
                if event.get("type") == "result":
                    result = event["result"]
            if result is None:
                raise RuntimeError("BEAT returned no Deploy Level 2 result")
            pressure = result.get("field_pressure", {})
            real = np.asarray(pressure.get("real", []), dtype=np.float32)
            imag = np.asarray(pressure.get("imag", []), dtype=np.float32)
            if real.size == 0 or real.shape != imag.shape or not np.isfinite(real).all() or not np.isfinite(imag).all():
                raise RuntimeError("BEAT returned invalid complex pressure values")
            if not all(math.isfinite(float(value)) for value in result.get("spl_db", [])):
                raise RuntimeError("BEAT returned non-finite SPL values")
            print(json.dumps({"request_backend": request["beat_engine_backend"], **result["diagnostics"]}, indent=2))
    finally:
        if worker is not None:
            worker.terminate()


if __name__ == "__main__":
    main()
