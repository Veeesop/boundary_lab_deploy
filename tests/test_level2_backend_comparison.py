from __future__ import annotations

import argparse
import json
import sys
import zipfile

import numpy as np
import pytest

import scripts.compare_level2_backends as comparison
from scripts.compare_level2_backends import (
    DEFAULT_MAX_ABSOLUTE_SPL_DIFFERENCE_DB,
    DEFAULT_MAX_RELATIVE_COMPLEX_PRESSURE_L2,
    _comparison_acceptance,
    _comparison_metrics,
    _non_negative_finite,
)


def test_comparison_metrics_and_default_acceptance() -> None:
    cpu_pressure = np.asarray([1 + 2j, 3 - 1j], dtype=np.complex128)
    metal_pressure = cpu_pressure * (1 + 2e-6)
    cpu_spl = np.asarray([80.0, 82.0])
    metal_spl = cpu_spl + np.asarray([0.001, -0.002])

    metrics = _comparison_metrics(cpu_pressure, metal_pressure, cpu_spl, metal_spl)
    acceptance = _comparison_acceptance(
        metrics,
        max_relative_complex_pressure_l2=DEFAULT_MAX_RELATIVE_COMPLEX_PRESSURE_L2,
        max_absolute_spl_difference_db=DEFAULT_MAX_ABSOLUTE_SPL_DIFFERENCE_DB,
    )

    assert metrics["relative_complex_pressure_l2"] == pytest.approx(2e-6)
    assert metrics["maximum_absolute_spl_difference_db"] == pytest.approx(0.002)
    assert acceptance == {
        "limits": {
            "max_relative_complex_pressure_l2": DEFAULT_MAX_RELATIVE_COMPLEX_PRESSURE_L2,
            "max_absolute_spl_difference_db": DEFAULT_MAX_ABSOLUTE_SPL_DIFFERENCE_DB,
        },
        "checks": {
            "relative_complex_pressure_l2": True,
            "maximum_absolute_spl_difference_db": True,
        },
        "passed": True,
    }


@pytest.mark.parametrize(
    ("metric_name", "limit_name", "limit", "exceeded"),
    [
        ("relative_complex_pressure_l2", "max_relative_complex_pressure_l2", 1e-6, 2e-6),
        ("maximum_absolute_spl_difference_db", "max_absolute_spl_difference_db", 0.001, 0.002),
    ],
)
def test_comparison_acceptance_fails_when_either_limit_is_exceeded(
    metric_name: str,
    limit_name: str,
    limit: float,
    exceeded: float,
) -> None:
    metrics = {
        "relative_complex_pressure_l2": 0.0,
        "maximum_absolute_spl_difference_db": 0.0,
    }
    metrics[metric_name] = exceeded

    acceptance = _comparison_acceptance(
        metrics,
        max_relative_complex_pressure_l2=limit if limit_name == "max_relative_complex_pressure_l2" else 1.0,
        max_absolute_spl_difference_db=limit if limit_name == "max_absolute_spl_difference_db" else 1.0,
    )

    assert acceptance["passed"] is False
    assert acceptance["checks"][metric_name] is False


def test_comparison_cli_exits_nonzero_when_configured_limit_is_exceeded(tmp_path, monkeypatch, capsys) -> None:
    package_path = tmp_path / "package.blabsp"
    with zipfile.ZipFile(package_path, "w") as archive:
        archive.writestr("manifest.json", json.dumps({"frequencies_hz": [80.0]}))
    pressure = {"real": [1.0, 2.0], "imag": [0.0, 0.0]}
    monkeypatch.setattr(
        comparison,
        "_solve",
        lambda _payload, backend: {
            "field_pressure": pressure if backend == "cpu" else {"real": [1.001, 2.0], "imag": [0.0, 0.0]},
            "spl_db": [80.0, 81.0],
            "diagnostics": {"backend": backend},
        },
    )
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "compare_level2_backends.py",
            "--package",
            str(package_path),
            "--max-relative-complex-pressure-l2",
            "1e-5",
        ],
    )

    with pytest.raises(SystemExit, match="exceeded one or more numerical tolerances"):
        comparison.main()

    output = json.loads(capsys.readouterr().out)
    assert output["acceptance"]["passed"] is False
    assert output["acceptance"]["limits"]["max_relative_complex_pressure_l2"] == 1e-5


def test_comparison_metrics_reject_mismatched_shapes_and_non_finite_values() -> None:
    pressure = np.asarray([1 + 0j, 2 + 0j])
    spl = np.asarray([80.0, 81.0])

    with pytest.raises(RuntimeError, match="different or empty"):
        _comparison_metrics(pressure, pressure[:1], spl, spl[:1])
    with pytest.raises(RuntimeError, match="non-finite complex pressure"):
        _comparison_metrics(pressure, np.asarray([np.nan + 0j, 2 + 0j]), spl, spl)
    with pytest.raises(RuntimeError, match="invalid or mismatched SPL"):
        _comparison_metrics(pressure, pressure, spl, spl[:1])
    with pytest.raises(RuntimeError, match="invalid or mismatched SPL"):
        _comparison_metrics(pressure, pressure, spl, np.asarray([80.0, np.inf]))


@pytest.mark.parametrize("value", ["-1", "nan", "inf", "invalid"])
def test_tolerance_argument_rejects_negative_or_non_finite_values(value: str) -> None:
    with pytest.raises(argparse.ArgumentTypeError):
        _non_negative_finite(value)


@pytest.mark.parametrize("value", ["0", "1e-4", "0.01"])
def test_tolerance_argument_accepts_finite_non_negative_values(value: str) -> None:
    assert _non_negative_finite(value) == float(value)
