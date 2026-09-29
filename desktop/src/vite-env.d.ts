/// <reference types="vite/client" />

interface DesktopPackageSelection {
  name: string;
  path: string;
  bytes: ArrayBuffer;
}

interface RecentProject {
  path: string; name: string; openedAt: string; modifiedAt: string | null; available: boolean;
}

interface DesktopProjectSelection {
  name: string;
  path: string;
  contents: string;
  packages: DesktopPackageSelection[];
  rigidMeshes: DesktopPackageSelection[];
}

type DesktopRigidObject = import("./model/types").RigidMeshConfiguration & {
  meshPath: string;
  scaleToMeters: number;
};

interface DesktopLevel2SolveRequest {
  packagePath: string;
  packagePaths?: Record<string, string>;
  frequencyHz: number;
  backend: "cuda" | "cpu" | "metal";
  fidelity?: "boundary" | "coupled";
  sources: import("./model/types").SourceConfiguration[];
  rigidObjects: DesktopRigidObject[];
  observation: import("./model/types").ObservationPlane;
  solutionKey?: string;
  reuseBoundary?: boolean;
  includeComplexPressure?: boolean;
}

interface DesktopSolveStatus {
  id: number;
  type: "status" | "initialized";
  message?: string;
  metadata?: Record<string, unknown>;
}

interface DesktopMicrophoneSweepRequest {
  packagePath: string;
  packagePaths?: Record<string, string>;
  backend: "cuda" | "cpu" | "metal";
  fidelity: "boundary" | "coupled";
  sources: import("./model/types").SourceConfiguration[];
  rigidObjects: DesktopRigidObject[];
  microphones: import("./model/types").MicrophoneConfiguration[];
}

interface DesktopMicrophoneSweepProgress {
  type: "microphone-progress";
  frequency_hz: number;
  completed_count: number;
  total_count: number;
  microphone_ids: string[];
  spl_db: number[];
  transducer_ids: string[];
  transducer_names: string[];
  transducer_velocity: { real: number[]; imag: number[] };
  acoustic_loading?: import("./model/acousticLoading").AcousticLoadingSample | null;
  speaker_ids: string[];
  speaker_names: string[];
  speaker_voltage: { real: number[]; imag: number[] };
  speaker_current: { real: number[]; imag: number[] };
}

interface Window {
  boundaryLabDeployProfile?: Record<string, unknown>;
  boundaryLabDesktop?: {
    getSolverBackend: () => Promise<"cpu" | "cuda" | "metal">;
    setSolverBackend: (backend: "cpu" | "cuda" | "metal") => Promise<"cpu" | "cuda" | "metal">;
    detectSolverBackend: (backend: "cuda" | "metal") => Promise<boolean>;
    readSceneClipboard: () => Promise<string>;
    writeSceneClipboard: (text: string) => Promise<void>;
    loadBundledExample: () => Promise<DesktopPackageSelection | null>;
    openProject: (path?: string) => Promise<DesktopProjectSelection | null>;
    recentProjects: () => Promise<RecentProject[]>;
    rememberProject: (path: string, name: string) => Promise<void>;
    openSpeakerPackage: () => Promise<DesktopPackageSelection | null>;
    openRigidMesh: () => Promise<DesktopPackageSelection | null>;
    saveProject: (contents: string, suggestedName: string) => Promise<string | null>;
    solveLevel2: (request: DesktopLevel2SolveRequest) => Promise<import("./model/types").Level2SolveResult>;
    calculateMicrophoneSweep: (request: DesktopMicrophoneSweepRequest) => Promise<import("./model/types").MicrophoneSweepResult>;
    cancelMicrophoneSweep: () => Promise<boolean>;
    onSolveStatus: (listener: (status: DesktopSolveStatus) => void) => () => void;
    onMicrophoneSweepProgress: (listener: (progress: DesktopMicrophoneSweepProgress) => void) => () => void;
  };
}
