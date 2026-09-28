const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("boundaryLabDesktop", {
  getSolverBackend: () => ipcRenderer.invoke("deploy:get-solver-backend"),
  setSolverBackend: (backend) => ipcRenderer.invoke("deploy:set-solver-backend", backend),
  detectSolverBackend: (backend) => ipcRenderer.invoke("deploy:detect-solver-backend", backend),
  readSceneClipboard: () => ipcRenderer.invoke("deploy:read-scene-clipboard"),
  writeSceneClipboard: (text) => ipcRenderer.invoke("deploy:write-scene-clipboard", text),
  loadBundledExample: () => ipcRenderer.invoke("deploy:load-bundled-example"),
  openProject: (path) => ipcRenderer.invoke("deploy:open-project", path),
  recentProjects: () => ipcRenderer.invoke("deploy:recent-projects"),
  rememberProject: (path, name) => ipcRenderer.invoke("deploy:remember-project", path, name),
  openSpeakerPackage: () => ipcRenderer.invoke("deploy:open-speaker-package"),
  openRigidMesh: () => ipcRenderer.invoke("deploy:open-rigid-mesh"),
  saveProject: (contents, suggestedName) => ipcRenderer.invoke("deploy:save-project", contents, suggestedName),
  solveLevel2: (payload) => ipcRenderer.invoke("deploy:solve-level2", payload),
  calculateMicrophoneSweep: (payload) => ipcRenderer.invoke("deploy:microphone-sweep", payload),
  cancelMicrophoneSweep: () => ipcRenderer.invoke("deploy:cancel-microphone-sweep"),
  onSolveStatus: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("deploy:solve-status", handler);
    return () => ipcRenderer.removeListener("deploy:solve-status", handler);
  },
  onMicrophoneSweepProgress: (listener) => {
    const handler = (_event, progress) => listener(progress);
    ipcRenderer.on("deploy:microphone-sweep-progress", handler);
    return () => ipcRenderer.removeListener("deploy:microphone-sweep-progress", handler);
  },
});
