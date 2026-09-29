"""Deploy's direct adapter to the installed BEAT Engine distribution."""
from beat_engine import EngineWorker as BeatEngineWorkerProcess
from beat_engine import engine_paths

DEFAULT_BEAT_ENGINE_SOLVER_SCRIPT = engine_paths().source_solver
DEFAULT_BEAT_ENGINE_CPU_PROJECT = engine_paths("cpu").project
DEFAULT_BEAT_ENGINE_CUDA_PROJECT = engine_paths("cuda").project
DEFAULT_BEAT_ENGINE_METAL_PROJECT = engine_paths("metal").project

__all__ = [
    "BeatEngineWorkerProcess",
    "DEFAULT_BEAT_ENGINE_SOLVER_SCRIPT",
    "DEFAULT_BEAT_ENGINE_CPU_PROJECT",
    "DEFAULT_BEAT_ENGINE_CUDA_PROJECT",
    "DEFAULT_BEAT_ENGINE_METAL_PROJECT",
]
