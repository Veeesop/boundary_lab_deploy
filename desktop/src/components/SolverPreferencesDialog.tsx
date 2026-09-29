import { useEffect, useRef } from "react";

export function SolverPreferencesDialog({ backend, busy, isMacOS, availability, onDetect, onChange, onClose }: {
  backend: "cpu" | "cuda" | "metal" | null;
  busy: boolean;
  isMacOS: boolean;
  availability: Partial<Record<"cuda" | "metal", boolean>>;
  onDetect: (backend: "cuda" | "metal") => void;
  onChange: (backend: "cpu" | "cuda" | "metal") => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="solver-preferences" aria-labelledby="solver-preferences-title"
    onCancel={onClose} onClose={onClose}>
    <h2 id="solver-preferences-title">Preferences</h2>
    <label htmlFor="solver-backend">Solver backend</label>
    <select id="solver-backend" value={backend ?? ""} disabled={busy || backend === null}
      onChange={event => onChange(event.target.value as "cpu" | "cuda" | "metal")}>
      {backend === null && <option value="">Checking availability...</option>}
      {isMacOS && <option value="metal">Metal (Apple Silicon GPU){availability.metal === false ? " — unavailable" : ""}</option>}
      <option value="cuda">CUDA (NVIDIA GPU){availability.cuda === false ? " — unavailable" : ""}</option>
      <option value="cpu">CPU</option>
    </select>
    {isMacOS && <div className="solver-detection-actions">
      <button type="button" disabled={busy} onClick={() => onDetect("metal")}>Check Metal</button>
      <button type="button" disabled={busy} onClick={() => onDetect("cuda")}>Check CUDA</button>
    </div>}
    <p>Used for Boundary and Coupled solves.</p>
    <button className="processing-button" onClick={onClose}>Close</button>
  </dialog>;
}
