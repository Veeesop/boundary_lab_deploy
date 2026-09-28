# Boundary Lab Deploy

Standalone desktop application for loudspeaker-array placement, coverage, and loading analysis.
The Electron/React application is in `desktop/`; its Python worker is in `src/boundary_deploy/`.
Boundary Lab is the speaker-package authoring application, not a runtime dependency.
Deploy reads portable `.blabsp` packages and stores `.blabdeploy.json` projects.

## Development setup (Windows)

From this repository:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
$env:DEPLOY_PYTHON_EXE = (Resolve-Path .venv/Scripts/python.exe).Path
cd desktop
npm ci
npm run build
npm start
```

Use `npm run dev` for development. Pattern preview needs no Python or Julia solve runtime.
Boundary/Coupled require Julia and the BEAT Julia environment for the selected backend.
The desktop currently requests CUDA; it does not automatically fall back to CPU.
Set `DEPLOY_JULIA_EXE` and optionally `DEPLOY_JULIA_THREADS` if Julia is not on PATH.
Legacy `BLAB_PYTHON_EXE` / `BLAB_JULIA_EXE` / `BLAB_JULIA_THREADS` remain accepted.
Prepare the engine runtime explicitly with `.\.venv\Scripts\python.exe -m beat_engine instantiate --backend cuda`
from the repository root. Julia package setup may download dependencies on a fresh machine.

After setup, `powershell -File scripts/start.ps1` launches the standalone app.

## Development setup (macOS Apple Silicon)

Source development on Apple Silicon uses BEAT Engine's Metal backend for Level 2
boundary solves. Install Python 3.11+, Julia 1.10–1.12, and Node.js, then from
this repository:

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -e ".[dev]"
python -m pip install --no-deps -e ../BEAT_Engine
python -m beat_engine instantiate --backend metal
python -m beat_engine doctor --backend metal --threads 2
```

Install the desktop dependencies and start Deploy from the checkout:

```bash
cd desktop
npm ci
npm run dev
```

Because `beat-engine` is already installed as a dependency, install the checkout
version into the same environment only when developing both repositories
together:

```bash
python -m pip install --no-deps -e ../BEAT_Engine
```

On macOS, Deploy selects BEAT Metal for Level 2 Boundary solves. Level 3
coupled speaker-ROM solving remains CUDA-only; use a CUDA-capable system for
that fidelity. Pattern preview does not require Julia or Metal. A Windows
packaged runtime is not used by this source workflow.

Run a real Metal Level 2 smoke solve from the repository root after setup:

```bash
.venv/bin/python scripts/smoke_metal_level2.py --backend metal
```

Compare CPU and Metal on identical Deploy Level 2 requests, including cases with
close-speaker or ground-image corrections:

```bash
.venv/bin/python scripts/compare_level2_backends.py --case baseline
.venv/bin/python scripts/compare_level2_backends.py --case close-speakers
.venv/bin/python scripts/compare_level2_backends.py --case ground-image
```

Each command is an acceptance gate: it fails if its corresponding correction-pair
count is zero or if either numerical difference exceeds the default limits of
`1e-4` relative complex-pressure L2 and `0.01 dB` maximum absolute SPL difference.
These are regression thresholds for the checked package, frequency, and cases,
not a general accuracy guarantee for other scenes or configurations. Override
either threshold explicitly when investigating a comparison:

```bash
.venv/bin/python scripts/compare_level2_backends.py --case close-speakers \
  --max-relative-complex-pressure-l2 1e-4 \
  --max-absolute-spl-difference-db 0.01
```

The JSON result includes the measured differences, applied limits, individual
checks, and overall acceptance status.

Exercise the Metal worker's field reuse, error recovery, retained-geometry sweep,
and post-sweep cleanup on Apple Silicon:

```bash
.venv/bin/python scripts/smoke_metal_lifecycle.py
```

Run the desktop Level 2 smoke on macOS with the active Python environment set;
it also asserts that the fidelity switch labels Level 2 as Metal and explains
the CUDA-only Level 3 restriction:

```bash
cd desktop
DEPLOY_PYTHON_EXE="$(cd .. && pwd)/.venv/bin/python" npm run test:level2
```

No `PYTHONPATH` injection or Boundary Lab checkout is required.

The BEAT dependency is pinned to a published wheel and SHA-256 in `pyproject.toml`.
The bundled runtime uses the same pin in `packaging/runtime-lock.json`. The
released BEAT 0.3.0 wheel includes the mixed-package schema 3 support required
for Coupled solves. The Metal Level 2 work described above is still source-candidate
work and does not change this released wheel pin.

Development against a candidate engine must be explicit and use a unique version
in a separate virtual environment. Such results do not certify the released pin.
Restore the declared dependency before validating a release build.

## Verification

```powershell
.\.venv\Scripts\python.exe -m pytest tests
.\.venv\Scripts\python.exe -m ruff check src tests
cd desktop
npm run build
npm run test:viewport
npm run test:placement
npm run test:pattern
npm run test:package
```

See [the user guide](desktop/docs/user-guide.md), [system model](desktop/docs/system-model.md),
and [extraction notes](docs/extraction.md). Desktop installer/runtime bundling is a subsequent
milestone; this repository currently supports source installation.

For an opt-in numerical check, run `.\.venv\Scripts\python.exe scripts/smoke_solver.py --backend cuda`.
This validates two different bundled packages at one common frequency and two pressure probes.

Windows bundle and installer instructions: [distribution guide](docs/distribution.md).

## Contributing and releases

Use scoped PRs targeting `main`. See [contributing](CONTRIBUTING.md) and the
[release process](docs/development.md). Stable releases are independent of main.
