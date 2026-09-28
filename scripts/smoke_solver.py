"""Opt-in real BEAT check: two different packages, one frequency, two probes."""
import argparse
import json
from pathlib import Path

import numpy as np

from boundary_deploy.assets import DeploySolveCache
from boundary_deploy.packages import common_frequencies, scene_packages
from boundary_deploy.solve import prepare_deploy_rom_request
from boundary_deploy.worker import _worker


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backend', choices=['cpu', 'cuda', 'metal'], default='cuda')
    parser.add_argument('--output', type=Path, default=Path('runs/standalone-mixed-smoke'))
    parser.add_argument("--library", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    library = args.library or root / "desktop/library"
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    payload = {
        'packagePaths': {'a': str(library / 'S218BP_LOD.blabsp'),
                         'b': str(library / 'SKHORN.blabsp')},
        'sources': [dict(id='cabinet-' + key, packageId=key, positionX=x, positionHeightM=1.0,
                         positionZ=0.0, yawDeg=0.0, pitchDeg=0.0, rollDeg=0.0,
                         levelDb=0.0, delayMs=0.0, polarity=1) for key, x in [('a', -2.0), ('b', 2.0)]],
        'fidelity': 'coupled', 'backend': args.backend, 'includeComplexPressure': True,
        'observationPointsM': [[0, 1.2, 5], [3, 1.2, 8]],
    }
    cache = DeploySolveCache()
    worker = None
    try:
        packages = scene_packages(payload, cache)
        payload['frequencyHz'] = float(common_frequencies(packages, coupled=True)[0])
        (output / 'payload.json').write_text(json.dumps(payload, indent=2))
        request_path, request = prepare_deploy_rom_request(payload, output, cache=cache)
        assert request['schema_version'] == 3
        worker = _worker(args.backend)
        result = None
        with (output / 'events.jsonl').open('w') as log:
            for event in worker.submit(request_path, operation='solve', status_callback=lambda s: print(s, flush=True)):
                log.write(json.dumps(event) + '\n')
                log.flush()
                if event.get('type') in ('failed', 'error'):
                    raise RuntimeError(event)
                if event.get('type') == 'result':
                    result = event['result']
        if result is None:
            raise RuntimeError('BEAT returned no result')
        pressure = result['field_pressure']
        assert len(pressure['real']) == 2 and np.isfinite(pressure['real']).all()
        assert len(pressure['imag']) == 2 and np.isfinite(pressure['imag']).all()
        (output / 'result.json').write_text(json.dumps(result, indent=2))
        print(json.dumps(result.get('diagnostics', {}), indent=2))
    finally:
        if worker is not None:
            worker.terminate()
        cache.close()


if __name__ == '__main__':
    main()
