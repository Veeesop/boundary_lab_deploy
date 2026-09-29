# Solver backends

Preferences (the top-right settings button) selects CPU, NVIDIA CUDA, or Apple Metal for Boundary and Coupled solves, microphone sweeps, and audience-plane updates. Metal is available as an option on macOS; CUDA remains visible there for users with a separately configured CUDA-capable worker/runtime. The choice is saved in `solver-preferences.json` under Electron's user-data directory, independently of projects.

On first launch, Deploy probes Metal on macOS and CUDA on Windows/Linux through the versioned BEAT worker handshake. It selects the requested accelerator only when that backend reports available; otherwise it selects CPU. Later launches retain the saved choice exactly. Selecting a backend is disabled during a running solve or sweep. Switching backends invalidates the desktop result identity and uses the corresponding engine worker. An unavailable selected backend reports an error and does not silently switch to another backend. Use **Check Metal** or **Check CUDA** in Preferences to probe either accelerator explicitly; a failed probe does not change the selected backend.

The BEAT CUDA catalog currently targets Windows and Linux, while its Metal
catalog targets macOS. Therefore a native macOS CUDA selection requires a
separately configured environment that can actually provide the CUDA worker;
the UI preserves the selection and reports worker unavailability rather than
substituting Metal or CPU.

The CPU coupled path uses the exported parity Petrov-Galerkin speaker ROM, the CPU exterior Burton-Miller operators, one exterior LU factorization per frequency, and a host-array GMRES feedback solve. It preserves the same ROM response, phasor convention, field reuse, and sweep warm-start contracts as CUDA.

## Development and release dependency

The released dependency is BEAT Engine 0.4.0rc1, pinned by immutable wheel URL and SHA-256 in both `pyproject.toml` and `packaging/runtime-lock.json`. It supplies the Deploy fixed-source Level 2 Metal path and retains the CPU Coupled support introduced in 0.3.0. The normal source setup uses the pinned wheel; an editable companion checkout is reserved for explicit cross-repository development.

Deploy's BEAT pin must remain identical in `pyproject.toml` and `packaging/runtime-lock.json`. Boundary Lab's independent engine pin does not need to change.

## Qualification

Run from the Deploy development environment:

```powershell
python scripts/check_solver_backends.py --output runs/backend-qualification --backend both
python scripts/smoke_solver.py --backend cpu --output runs/mixed-cpu
python scripts/smoke_solver.py --backend cuda --output runs/mixed-cuda
```

The first command runs Boundary and Coupled solves, cached field evaluation, and two-frequency sweeps, checks CPU/CUDA complex-pressure agreement within a relative norm tolerance of 0.0005, and checks coupled convergence and sweep warm starts. It writes request/result artifacts under the requested new directory. The mixed smoke commands use two different speaker packages.

Also run Python tests, the desktop build, `npm run test:runtime`, and `npm run test:editing-ui`. Engine changes require the Julia reference gate and CPU GMRES tests. Qualify the final installer on a machine without NVIDIA hardware before publishing; development CPU tests and a CUDA-hidden availability probe do not replace installed-runtime qualification.

To qualify relocated or installed resources using bundled Python and Julia with
network access disabled:

```powershell
python scripts/verify_bundle.py --resources build/resources --solve --qualify-backends
```

For an existing installation, pass its resources directory and `--in-place`.
`--solve` covers mixed speaker packages; `--qualify-backends` exercises both
backends, both fidelities, cached fields, and warm-start sweeps. Verification also
checks that no installed resource changed during execution.

After building the installer, `./scripts/test_installer.ps1 -QualifyBackends`
installs it into a guarded temporary directory, verifies app launch and offline
CPU/CUDA numerical execution, then uninstalls that test copy. It refuses to
replace an existing Deploy installation.
