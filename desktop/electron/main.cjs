const { app, BrowserWindow, dialog, ipcMain, clipboard } = require("electron");
const { resolveRuntime } = require("./runtime.cjs");
const { RecentProjects } = require("./recentProjects.cjs");
const { SolverPreferences } = require("./solverPreferences.cjs");
const { DeployWorkerClient } = require("./workerClient.cjs");
const { readFile, unlink, writeFile } = require("node:fs/promises");
const { basename, dirname, isAbsolute, join, resolve } = require("node:path");
const { performance } = require("node:perf_hooks");

const packagedSmoke = process.argv.includes("--packaged-smoke");
if (packagedSmoke) app.setPath("userData", process.env.DEPLOY_SMOKE_DATA || join(app.getPath("temp"), `deploy-packaged-smoke-${process.pid}`));
const smokeRecentProjects = process.argv.some(arg => ["--smoke-test", "--smoke-level2", "--benchmark-level2"].includes(arg));
const recentProjects = new RecentProjects(smokeRecentProjects ? join(app.getPath("temp"), `deploy-recent-smoke-${process.pid}.json`) : join(app.getPath("userData"), "recent-projects.json"));
const here = __dirname;
const repositoryRoot = join(here, "../..");

const libraryRoot = app.isPackaged ? join(process.resourcesPath, "library") : join(here, "../library");
const deployWorker = new DeployWorkerClient(() => resolveRuntime({
  packaged: app.isPackaged, resourcesPath: process.resourcesPath,
  dataPath: app.getPath("userData"), repositoryRoot,
}));

const solverPreferences = new SolverPreferences(join(app.getPath("userData"), "solver-preferences.json"),
  async (backend) => (await deployWorker.solve({ backend }, null, "backend", "detect_backend")).backend);
ipcMain.handle("deploy:get-solver-backend", () => solverPreferences.get());
ipcMain.handle("deploy:set-solver-backend", (_event, backend) => solverPreferences.set(backend));
ipcMain.handle("deploy:detect-solver-backend", async (_event, backend) => {
  const result = await deployWorker.solve({ backend }, null, "backend", "detect_backend");
  return result.backend === backend;
});

function createWindow() {
  const level2Smoke = process.argv.includes("--smoke-level2");
  const benchmarkLevel2 = process.argv.includes("--benchmark-level2");
  const smokeTest = process.argv.includes("--smoke-test") || level2Smoke || benchmarkLevel2;
  const window = new BrowserWindow({
    width: 1540,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#101311",
    show: !packagedSmoke && (!smokeTest || benchmarkLevel2),
    titleBarStyle: "hiddenInset",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !benchmarkLevel2,
    },
  });

  if (packagedSmoke) {
    window.webContents.once("did-finish-load", async () => {
      try {
        await deployWorker.ensureStarted();
        const state = await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
          const deadline = Date.now() + 30000;
          const check = () => {
            Array.from(document.querySelectorAll('.projects-screen button')).find(b => b.textContent === 'Open example')?.click();
            const source = document.querySelector('.package-card')?.textContent || '';
            if (source.includes('S218BP')) return resolve({ title: document.title, canvas: Boolean(document.querySelector('canvas')), package: source });
            if (Date.now() > deadline) return reject(new Error('Bundled example did not load'));
            setTimeout(check, 100);
          }; check();
        })`);
        if (!app.isPackaged || !state.canvas) throw new Error('Packaged renderer did not initialize');
        const report = JSON.stringify({ packaged: true, workerReady: true, ...state });
        await writeFile(join(app.getPath("userData"), "packaged-smoke.json"), report);
        console.log(report);
        app.quit();
      } catch (error) { console.error(error); app.exit(1); }
    });
    setTimeout(() => app.exit(1), 60000).unref();
  }

  if (smokeTest) {
    const consoleErrors = [];
    window.webContents.on("console-message", (_event, level, message) => {
      if (level >= 2) consoleErrors.push(message);
    });
    window.webContents.once("did-finish-load", async () => {
      await window.webContents.executeJavaScript(`new Promise((resolve) => {
        const deadline = Date.now() + 10000;
        const check = () => {
          Array.from(document.querySelectorAll('.projects-screen button')).find(b => b.textContent === 'Open example')?.click();
          const source = document.querySelector('.package-subtitle')?.textContent || '';
          if (source.includes('S218BP_LOD.blabsp') || Date.now() >= deadline) resolve(source);
          else setTimeout(check, 50);
        };
        check();
      })`);
      let openProjectInteraction = null;
      let packageImportInteraction = null;
      let rigidMeshInteraction = null;
      if (!benchmarkLevel2 && !level2Smoke) {
        const bundledPackageId = await window.webContents.executeJavaScript("document.querySelector('.package-card')?.dataset.packageId || ''");
        const smokeProjectPath = join(app.getPath("temp"), `boundary-lab-deploy-${process.pid}.blabdeploy.json`);
        // Fixture IDs are hashes of bytes; line endings can change across checkouts.
        let rigidHash = 2166136261;
        for (const byte of await readFile(join(libraryRoot, "RigidStage_LOD.msh"))) {
          rigidHash = Math.imul(rigidHash ^ byte, 16777619);
        }
        const smokeRigidId = `rigid-mesh-${(rigidHash >>> 0).toString(16)}`;
        const smokeProject = {
          schema: "boundary-lab-deploy-project",
          schema_version: 5,
          name: "Loaded Project Smoke",
          packages: [{
            id: bundledPackageId,
            name: "S218BP",
            source_file: join(libraryRoot, "S218BP_LOD.blabsp"),
          }],
          rigid_meshes: [{
            id: smokeRigidId,
            name: "RigidStage_LOD",
            source_file: join(libraryRoot, "RigidStage_LOD.msh"),
            scale_to_meters: 0.001,
          }],
          sources: [
            { id: "subwoofer-1", name: "S218BP 1", packageId: bundledPackageId, positionX: -2, positionHeightM: 0.4, positionZ: 0, pitchDeg: 0, yawDeg: 0, rollDeg: 0, levelDb: -3, delayMs: 0, polarity: 1 },
            { id: "subwoofer-2", name: "S218BP 2", packageId: bundledPackageId, positionX: 2, positionHeightM: 0.4, positionZ: 0, pitchDeg: 0, yawDeg: 0, rollDeg: 0, levelDb: -3, delayMs: 0, polarity: 1 },
          ],
          rigid_objects: [{ id: "rigid-1", name: "Stage 1", assetId: smokeRigidId, positionX: 8, positionHeightM: 0.01, positionZ: 0, pitchDeg: 0, yawDeg: 0, rollDeg: 0 }],
          microphones: [],
          observation_plane: { widthM: 18, depthM: 16, centerXM: 1, nearM: 2, heightM: 1.4, pitchDeg: 0, yawDeg: 0, rollDeg: 0, columns: 36, rows: 32, heatmapMinimumDb: 55, heatmapMaximumDb: 135, heatmapBandingDb: 5 },
          selected_frequency_hz: 80,
          requested_fidelity: "pattern",
        };
        await writeFile(smokeProjectPath, `${JSON.stringify(smokeProject, null, 2)}\n`, "utf8");
        const showOpenDialog = dialog.showOpenDialog;
        dialog.showOpenDialog = async (options) => options?.title === "Open Boundary Lab Deploy project"
          ? { canceled: false, filePaths: [smokeProjectPath] }
          : showOpenDialog.call(dialog, options);
        try {
          openProjectInteraction = await window.webContents.executeJavaScript(`new Promise((resolve) => {
            window.confirm = () => true;
            document.querySelector('button[aria-label="Open project"]')?.click();
            const deadline = Date.now() + 10000;
            const check = () => {
              const name = document.querySelector('.project-breadcrumb strong')?.textContent?.trim() || '';
              const error = document.querySelector('.error-toast span')?.textContent || '';
              if (name === 'Loaded Project Smoke' || error || Date.now() >= deadline) {
                resolve({
                  name,
                  error: error || null,
                  sourceCount: document.querySelectorAll('.tree-button[data-object-id^="subwoofer-"]').length,
                  rigidCount: document.querySelectorAll('.tree-button[data-object-id^="rigid-"]').length,
                  edited: Boolean(document.querySelector('.project-breadcrumb i'))
                });
              } else setTimeout(check, 50);
            };
            check();
          })`);
        } finally {
          dialog.showOpenDialog = showOpenDialog;
          await unlink(smokeProjectPath).catch(() => {});
        }
      }
      if (!benchmarkLevel2 && !level2Smoke) {
        const alternatePackagePath = join(app.getPath("temp"), `S218BP_ALT_${process.pid}.blabsp`);
        await writeFile(alternatePackagePath, await readFile(join(libraryRoot, "S218BP_LOD.blabsp")));
        const showOpenDialog = dialog.showOpenDialog;
        dialog.showOpenDialog = async (options) => options?.title === "Open Boundary Lab speaker package"
          ? { canceled: false, filePaths: [alternatePackagePath] }
          : showOpenDialog.call(dialog, options);
        try {
          packageImportInteraction = await window.webContents.executeJavaScript(`new Promise((resolve) => {
            const sourcesBefore = document.querySelectorAll('.tree-button[data-object-id^="subwoofer-"]').length;
            Array.from(document.querySelectorAll('.left-panel .text-button')).find(button => button.textContent === 'Import')?.click();
            const deadline = Date.now() + 10000;
            const checkImported = () => {
              const cards = document.querySelectorAll('.package-card[data-package-id]');
              if (cards.length < 2 && Date.now() < deadline) return setTimeout(checkImported, 50);
              const sourcesAfterImport = document.querySelectorAll('.tree-button[data-object-id^="subwoofer-"]').length;
              cards[cards.length - 1]?.querySelector('button')?.click();
              requestAnimationFrame(async () => {
                const sourcesAfterAdd = document.querySelectorAll('.tree-button[data-object-id^="subwoofer-"]').length;
                window.dispatchEvent(new KeyboardEvent('keydown', {key:'c',ctrlKey:true,bubbles:true}));
                await new Promise(r=>setTimeout(r,150));
                window.dispatchEvent(new KeyboardEvent('keydown', {key:'v',ctrlKey:true,bubbles:true}));
                await new Promise(r=>setTimeout(r,250));
                requestAnimationFrame(() => {
                  const sourcesAfterPaste = document.querySelectorAll('.tree-button[data-object-id^="subwoofer-"]').length;
                  document.querySelector('button[aria-label="Remove selected objects"]')?.click();
                  requestAnimationFrame(() => {
                    document.querySelector('.tree-button[data-object-id="subwoofer-3"]')?.click();
                    requestAnimationFrame(() => {
                      document.querySelector('button[aria-label="Remove selected objects"]')?.click();
                      requestAnimationFrame(() => resolve({
                        packageCount: cards.length,
                        sourcesBefore,
                        sourcesAfterImport,
                        sourcesAfterAdd,
                        sourcesAfterPaste,
                        sourcesAfterCleanup: document.querySelectorAll('.tree-button[data-object-id^="subwoofer-"]').length
                      }));
                    });
                  });
                });
              });
            };
            checkImported();
          })`);
        } finally {
          dialog.showOpenDialog = showOpenDialog;
          await unlink(alternatePackagePath).catch(() => {});
        }
        await window.webContents.executeJavaScript(`new Promise((resolve) => {
          document.querySelector('.tree-button[data-object-id="subwoofer-1"]')?.click();
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        })`);
      }
      if (!benchmarkLevel2) {
        const rigidMeshPath = join(libraryRoot, "RigidStage_LOD.msh");
        const showOpenDialog = dialog.showOpenDialog;
        dialog.showOpenDialog = async (options) => options?.title === "Import rigid boundary mesh"
          ? { canceled: false, filePaths: [rigidMeshPath] }
          : showOpenDialog.call(dialog, options);
        try {
          rigidMeshInteraction = await window.webContents.executeJavaScript(`new Promise((resolve) => {
            const header = Array.from(document.querySelectorAll('.section-header'))
              .find((candidate) => candidate.textContent?.includes('Rigid mesh library'));
            header?.querySelector('button')?.click();
            const deadline = Date.now() + 10000;
            const checkImported = () => {
              const card = document.querySelector('.package-card[data-rigid-mesh-id]');
              const error = document.querySelector('.error-toast span')?.textContent || '';
              if (!card && !error && Date.now() < deadline) return setTimeout(checkImported, 50);
              card?.querySelector('button')?.click();
              requestAnimationFrame(() => {
                const first = document.querySelector('.tree-button[data-object-id^="rigid-"]');
                first?.click();
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }));
                requestAnimationFrame(() => {
                  const viewport = document.querySelector('.viewport');
                  const translateMode = viewport?.getAttribute('data-transform-mode');
                  const grabPointCount = viewport?.getAttribute('data-grab-point-count');
                  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true }));
                  requestAnimationFrame(async () => {
                    const rotateMode = viewport?.getAttribute('data-transform-mode');
                    window.dispatchEvent(new KeyboardEvent('keydown', {key:'c',ctrlKey:true,bubbles:true}));
                await new Promise(r=>setTimeout(r,150));
                window.dispatchEvent(new KeyboardEvent('keydown', {key:'v',ctrlKey:true,bubbles:true}));
                await new Promise(r=>setTimeout(r,250));
                    requestAnimationFrame(() => {
                      const countAfterPaste = document.querySelectorAll('.tree-button[data-object-id^="rigid-"]').length;
                      document.querySelector('button[aria-label="Remove selected objects"]')?.click();
                      requestAnimationFrame(() => {
                        const remaining = document.querySelector('.tree-button[data-object-id^="rigid-"]');
                        remaining?.click();
                        resolve({
                          error: error || null,
                          meshName: card?.querySelector('.package-name')?.textContent?.trim() || null,
                          countAfterPaste,
                          countAfterCleanup: document.querySelectorAll('.tree-button[data-object-id^="rigid-"]').length,
                          translateMode,
                          rotateMode,
                          grabPointCount
                        });
                      });
                    });
                  });
                });
              });
            };
            checkImported();
          })`);
        } finally {
          dialog.showOpenDialog = showOpenDialog;
        }
      }
      await window.webContents.executeJavaScript(`(() => {
        document.querySelectorAll('.fidelity-switcher button')[1]?.click();
        return new Promise((resolve) => setTimeout(resolve, 0));
      })()`);
      if (benchmarkLevel2) {
        const benchmark = await window.webContents.executeJavaScript(`(async () => {
          const waitForProfile = (previousGeneration, actionStarted, label) => new Promise((resolve) => {
            const deadline = performance.now() + 240000;
            const check = () => {
              const profile = window.boundaryLabDeployProfile;
              const error = document.querySelector('.error-toast span')?.textContent || '';
              if (profile?.texture_ready && Number(profile.generation || 0) > previousGeneration) {
                resolve({ label, interaction_to_texture_s: (performance.now() - actionStarted) / 1000, profile });
              } else if (error || performance.now() >= deadline) {
                resolve({ label, error: error || 'benchmark timeout', profile: profile || null });
              } else {
                setTimeout(check, 25);
              }
            };
            check();
          });
          const setNativeValue = (input, value) => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            if (!input || !setter) throw new Error('Benchmark control is unavailable.');
            setter.call(input, String(value));
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          };

          window.boundaryLabDeployProfile = undefined;
          const coldStarted = performance.now();
          document.querySelector('.primary-button')?.click();
          const cold = await waitForProfile(0, coldStarted, 'cold_54x54');
          if (cold.error) return { cases: [cold] };

          document.querySelector('.tree-button[data-object-id="subwoofer-1"]')?.click();
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const sourceX = document.querySelector('.right-panel input[aria-label="X"]');
          const warmStarted = performance.now();
          setNativeValue(sourceX, Number(sourceX.value) + 0.1);
          const warm = await waitForProfile(Number(cold.profile.generation), warmStarted, 'warm_move_54x54');
          if (warm.error) return { cases: [cold, warm] };

          document.querySelector('.tree-button[data-object-id="audience-plane"]')?.click();
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const resolution = document.querySelector('input[aria-label="Plane resolution"]');
          const highResolutionStarted = performance.now();
          setNativeValue(resolution, 200);
          const highResolution = await waitForProfile(
            Number(warm.profile.generation),
            highResolutionStarted,
            'warm_plane_200x200'
          );
          if (highResolution.error) return { cases: [cold, warm, highResolution] };

          const planeX = document.querySelector('.right-panel input[aria-label="X"]');
          const repeatedPlaneStarted = performance.now();
          setNativeValue(planeX, Number(planeX.value) + 0.1);
          const repeatedPlane = await waitForProfile(
            Number(highResolution.profile.generation),
            repeatedPlaneStarted,
            'warm_plane_repeat_200x200'
          );
          return {
            cases: [cold, warm, highResolution, repeatedPlane],
            final_grid: document.querySelector('.plane-resolution-row output')?.textContent?.trim() || null,
          };
        })()`);
        console.log(JSON.stringify({ benchmark: "deploy-level2-pipeline", ...benchmark, consoleErrors }));
        app.quit();
        return;
      }
      const transformInteraction = await window.webContents.executeJavaScript(`new Promise((resolve) => {
        const viewport = document.querySelector('.viewport');
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }));
        requestAnimationFrame(() => {
          const translateMode = viewport?.getAttribute('data-transform-mode');
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true }));
          requestAnimationFrame(() => {
            const rotateMode = viewport?.getAttribute('data-transform-mode');
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true, bubbles: true }));
            requestAnimationFrame(() => {
              const altDisablesSnap = viewport?.getAttribute('data-angle-snap-disabled');
              window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }));
              window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', bubbles: true }));
              requestAnimationFrame(() => resolve({
                  translateMode,
                  rotateMode,
                  altDisablesSnap,
                  selectMode: viewport?.getAttribute('data-transform-mode'),
                  grabPointCount: viewport?.getAttribute('data-grab-point-count')
                }));
            });
          });
        });
      })`);
      const planeResolutionInteraction = await window.webContents.executeJavaScript(`new Promise((resolve) => {
        document.querySelector('.tree-button[data-object-id="audience-plane"]')?.click();
        requestAnimationFrame(() => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }));
          requestAnimationFrame(() => {
            const planeTranslateMode = document.querySelector('.viewport')?.getAttribute('data-transform-mode');
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true }));
            requestAnimationFrame(() => {
              const planeRotateMode = document.querySelector('.viewport')?.getAttribute('data-transform-mode');
              window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
              const input = document.querySelector('input[aria-label="Plane resolution"]');
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
              if (!input || !setter) return resolve({ available: false });
              setter.call(input, '40');
              input.dispatchEvent(new Event('input', { bubbles: true }));
              requestAnimationFrame(() => {
                const result = {
                  available: true,
                  selectedObject: document.querySelector('.inspector-heading strong')?.textContent?.trim(),
                  planeTranslateMode,
                  planeRotateMode,
                  planeScaleMode: document.querySelector('.viewport')?.getAttribute('data-transform-mode'),
                  planeScaleHandleCount: document.querySelector('.viewport')?.getAttribute('data-grab-point-count'),
                  planeProperties: {
                    x: document.querySelector('input[aria-label="X"]')?.value,
                    near: document.querySelector('input[aria-label="Near"]')?.value,
                    height: document.querySelector('input[aria-label="Height"]')?.value,
                    pitch: document.querySelector('input[aria-label="Pitch"]')?.value,
                    yaw: document.querySelector('input[aria-label="Yaw"]')?.value,
                    roll: document.querySelector('input[aria-label="Roll"]')?.value,
                    heatmapMinimumDb: document.querySelector('input[aria-label="Scale minimum"]')?.value,
                    heatmapMaximumDb: document.querySelector('input[aria-label="Scale maximum"]')?.value,
                    heatmapBandingDb: document.querySelector('input[aria-label="Banding"]')?.value,
                    sizeReadout: document.querySelector('.plane-size-readout output')?.textContent?.trim(),
                    editableSizeInputs: document.querySelectorAll('input[aria-label="Width"], input[aria-label="Depth"]').length
                  },
                  value: input.value,
                  maximum: input.max,
                  shape: document.querySelector('.plane-resolution-row output')?.textContent?.trim(),
                  fieldShape: document.querySelector('.solve-status em')?.textContent?.trim()
                };
                document.querySelector('.tree-button[data-object-id="subwoofer-1"]')?.click();
                requestAnimationFrame(() => resolve(result));
              });
            });
          });
        });
      })`);
      const sceneObjectInteraction = await window.webContents.executeJavaScript(`new Promise((resolve) => {
        const first = document.querySelector('.tree-button[data-object-id="subwoofer-1"]');
        const second = document.querySelector('.tree-button[data-object-id="subwoofer-2"]');
        first?.click();
        second?.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
        requestAnimationFrame(() => {
          const viewport = document.querySelector('.viewport');
          const selectedBeforeAdd = Array.from(document.querySelectorAll('.tree-button[aria-selected="true"]'))
            .map((row) => row.getAttribute('data-object-id'));
          const selectedCountBeforeAdd = viewport?.getAttribute('data-selected-object-count');
          const sourceCountBeforeAdd = document.querySelectorAll('.tree-button[data-object-id^="subwoofer-"]').length;
          document.querySelector('button[aria-label="Add speaker"]')?.click();
          requestAnimationFrame(() => {
            const sourceCountAfterAdd = document.querySelectorAll('.tree-button[data-object-id^="subwoofer-"]').length;
            const addedId = document.querySelector('.tree-button[aria-selected="true"]')?.getAttribute('data-object-id');
            const remove = document.querySelector('button[aria-label="Remove selected objects"]');
            const removeEnabled = !remove?.disabled;
            remove?.click();
            requestAnimationFrame(() => {
              const sourceCountAfterRemove = document.querySelectorAll('.tree-button[data-object-id^="subwoofer-"]').length;
              document.querySelectorAll('.fidelity-switcher button')[1]?.click();
              requestAnimationFrame(() => {
                document.querySelector('button[aria-label="Add microphone"]')?.click();
                requestAnimationFrame(() => {
                const microphone = document.querySelector('.tree-button[data-object-id^="microphone-"]');
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }));
                requestAnimationFrame(() => {
                  const microphoneTranslateMode = viewport?.getAttribute('data-transform-mode');
                  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true }));
                  requestAnimationFrame(() => {
                    const microphoneRejectsRotation = viewport?.getAttribute('data-transform-mode') === 'translate';
                    const bemButton = document.querySelector('.bem-pressure-button');
                    const bemButtonLabel = bemButton?.textContent?.trim();
                    bemButton?.click();
                    requestAnimationFrame(() => {
                      const bemStopLabel = bemButton?.textContent?.trim();
                      bemButton?.click();
                      const deadline = Date.now() + 7000;
                      const finish = () => {
                        const resetLabel = bemButton?.textContent?.trim() || '';
                        if (resetLabel.includes('Calculate BEM Pressure') || Date.now() >= deadline) {
                          resolve({
                            selectedBeforeAdd,
                            selectedCountBeforeAdd,
                            sourceCountBeforeAdd,
                            sourceCountAfterAdd,
                            addedId,
                            removeEnabled,
                            sourceCountAfterRemove,
                            microphoneId: microphone?.getAttribute('data-object-id'),
                            microphoneGrabPointCount: viewport?.getAttribute('data-grab-point-count'),
                            microphoneTranslateMode,
                            microphoneRejectsRotation,
                            responseTraceCount: document.querySelectorAll('.pattern-trace').length,
                            bemButtonLabel,
                            bemStopLabel,
                            bemResetLabel: resetLabel
                          });
                        } else setTimeout(finish, 50);
                      };
                      finish();
                    });
                  });
                });
                });
              });
            });
          });
        });
      })`);
      const traceFilterInteraction = await window.webContents.executeJavaScript(`new Promise((resolve) => {
        const checkbox = document.querySelector('.trace-filter input[type="checkbox"]');
        const count = () => document.querySelectorAll('.pattern-trace').length;
        const before = count();
        checkbox?.click();
        requestAnimationFrame(() => {
          const afterHide = count();
          checkbox?.click();
          requestAnimationFrame(() => resolve({
            available: Boolean(checkbox),
            filterRows: document.querySelectorAll('.trace-filter-row').length,
            before,
            afterHide,
            afterRestore: count()
          }));
        });
      })`);
      if (!traceFilterInteraction.available || traceFilterInteraction.afterHide !== 0 || traceFilterInteraction.afterRestore !== traceFilterInteraction.before) {
        throw new Error("Plot trace visibility filter did not hide and restore its line.");
      }
      const chartResizeInteraction = await window.webContents.executeJavaScript(`new Promise((resolve) => {
        const shell = document.querySelector('.app-shell');
        const sample = (height) => new Promise((sampleResolve) => {
          shell?.style.setProperty('--analysis-drawer-height', height + 'px');
          requestAnimationFrame(() => requestAnimationFrame(() => {
            const svg = document.querySelector('.response-chart');
            const labels = Array.from(svg?.querySelectorAll('.axis-title') || []);
            const svgBounds = svg?.getBoundingClientRect();
            const measurements = labels.map((label) => {
              const bounds = label.getBoundingClientRect();
              return {
                text: label.textContent?.trim() || '',
                width: Number(bounds.width.toFixed(2)),
                height: Number(bounds.height.toFixed(2)),
                inside: Boolean(svgBounds) && bounds.left >= svgBounds.left - 0.5 && bounds.right <= svgBounds.right + 0.5 && bounds.top >= svgBounds.top - 0.5 && bounds.bottom <= svgBounds.bottom + 0.5
              };
            });
            sampleResolve({ height: Number(svgBounds?.height.toFixed(2) || 0), measurements });
          }));
        });
        (async () => {
          const compact = await sample(180);
          const expanded = await sample(420);
          const stable = compact.measurements.every((measurement, index) => {
            const comparison = expanded.measurements[index];
            return comparison && Math.abs(measurement.width - comparison.width) <= 1 && Math.abs(measurement.height - comparison.height) <= 1;
          });
          resolve({ compact, expanded, stable, allInside: [...compact.measurements, ...expanded.measurements].every((measurement) => measurement.inside) });
        })();
      })`);
      if (!chartResizeInteraction.stable || !chartResizeInteraction.allInside) {
        throw new Error("Plot axis labels changed size or left the SVG bounds during drawer resize.");
      }
      let emptySourceInteraction = null;
      const analysisCaptureInteraction = await window.webContents.executeJavaScript(`(async () => {
        const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const captureButton = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Capture results');
        if (!captureButton || captureButton.disabled) throw new Error('Capture control unavailable');
        const before = document.querySelectorAll('.pattern-trace').length;
        captureButton.click();
        await frame();
        const after = document.querySelectorAll('.pattern-trace').length;
        const saved = document.querySelector('.analysis-captures input[type="checkbox"]');
        if (!saved || after <= before) throw new Error('Captured overlay did not appear');
        saved.click();
        await frame();
        if (document.querySelectorAll('.pattern-trace').length !== before) throw new Error('Captured overlay did not hide');
        const dash = getComputedStyle(document.querySelector('.pattern-trace')).strokeDasharray;
        if (!dash.startsWith('1')) throw new Error('Pattern trace is not dotted');
        Array.from(document.querySelectorAll('[role="tab"]')).find((button) => button.textContent.includes('Speakers')).click();
        await frame();
        const quantity = document.querySelector('select[aria-label="Speaker response quantity"]');
        if (quantity.options.length !== 6) throw new Error('Speaker quantities missing');
        quantity.value = 'acoustic';
        quantity.dispatchEvent(new Event('change', { bubbles: true }));
        await frame();
        const reactance = Array.from(document.querySelectorAll('.electrical-view-switcher button')).find((button) => button.textContent === 'Reactance');
        if (!reactance) throw new Error('Acoustic loading controls missing');
        reactance.click();
        await frame();
        if (!reactance.classList.contains('active')) throw new Error('Reactance view did not switch');
        quantity.value = 'differential';
        quantity.dispatchEvent(new Event('change', { bubbles: true }));
        await frame();
        const peak = document.querySelector('button[aria-label="Peak pressure differential"]');
        const kpa = document.querySelector('button[aria-label="Pressure units kPa"]');
        if (!peak || !kpa) throw new Error('Pressure differential controls missing');
        peak.click();
        kpa.click();
        await frame();
        if (!peak.classList.contains('active') || !kpa.classList.contains('active')) throw new Error('Pressure differential controls did not switch');
        const subjects = document.querySelector('select[aria-label="Speaker response subjects"]');
        subjects.value = 'selection';
        subjects.dispatchEvent(new Event('change', { bubbles: true }));
        await frame();
        if (subjects.value !== 'selection' || subjects.disabled) throw new Error('Selection subject mode unavailable');
        subjects.value = 'all';
        subjects.dispatchEvent(new Event('change', { bubbles: true }));
        Array.from(document.querySelectorAll('[role="tab"]')).find((button) => button.textContent.includes('Microphones')).click();
        await frame();
        document.querySelector('button[aria-label="Remove Capture 1"]').click();
        await frame();
        return { before, after, dotted: true, followSelection: true };
      })()`);
      console.log(JSON.stringify({ analysisCaptureInteraction }));
      if (!level2Smoke) {
        emptySourceInteraction = await window.webContents.executeJavaScript(`new Promise((resolve) => {
          const sourceRows = Array.from(document.querySelectorAll('.tree-button[data-object-id^="subwoofer-"]'));
          sourceRows.forEach((row, index) => row.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: index > 0 })));
          requestAnimationFrame(() => {
            const remove = document.querySelector('button[aria-label="Remove selected objects"]');
            const removeEnabledForAll = !remove?.disabled;
            remove?.click();
            requestAnimationFrame(() => {
              const sourceCountAfterRemoveAll = document.querySelectorAll('.tree-button[data-object-id^="subwoofer-"]').length;
              const solveStatusAfterRemoveAll = document.querySelector('.solve-status strong')?.textContent?.trim() || '';
              const add = document.querySelector('button[aria-label="Add speaker"]');
              add?.click();
              requestAnimationFrame(() => {
                add?.click();
                requestAnimationFrame(() => resolve({
                  removeEnabledForAll,
                  sourceCountAfterRemoveAll,
                  solveStatusAfterRemoveAll,
                  sourceCountAfterRestore: document.querySelectorAll('.tree-button[data-object-id^="subwoofer-"]').length
                }));
              });
            });
          });
        })`);
      }
      let level2Move = null;
      if (level2Smoke) {
        level2Move = await window.webContents.executeJavaScript(`new Promise((resolve) => {
          document.querySelector('.primary-button')?.click();
          const deadline = Date.now() + 120000;
          const check = () => {
            const status = document.querySelector('.solve-status strong')?.textContent || '';
            const error = document.querySelector('.error-toast span')?.textContent || '';
            if (status.includes('Boundary solution') || error || Date.now() >= deadline) resolve({ status, error });
            else setTimeout(check, 100);
          };
          check();
        })`);
        level2Move = await window.webContents.executeJavaScript(`new Promise((resolve) => {
          document.querySelector('.tree-button[data-object-id="subwoofer-1"]')?.click();
          requestAnimationFrame(() => {
            const statusPanel = document.querySelector('.solve-status');
            const initialRevision = Number(statusPanel?.getAttribute('data-solve-revision') || 0);
            const input = document.querySelector('.right-panel .number-row input');
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            if (!input || !setter) return resolve({ initialRevision, moved: false });
            setter.call(input, '-1');
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            const deadline = Date.now() + 30000;
            const check = () => {
              const status = document.querySelector('.solve-status strong')?.textContent || '';
              const revision = Number(statusPanel?.getAttribute('data-solve-revision') || 0);
              const error = document.querySelector('.error-toast span')?.textContent || '';
              if ((status.includes('Boundary solution') && revision > initialRevision) || error || Date.now() >= deadline) {
                resolve({ initialRevision, revision, moved: input.value === '-1' && revision > initialRevision, status, error });
              } else setTimeout(check, 50);
            };
            check();
          });
        })`);
      }
      const paneLayoutInteraction = await window.webContents.executeJavaScript(`(() => {
        const properties = document.querySelector('.right-panel')?.getBoundingClientRect();
        const plots = document.querySelector('.analysis-drawer')?.getBoundingClientRect();
        return {
          propertiesReachesBottom: Boolean(properties) && Math.abs(properties.bottom - window.innerHeight) <= 1,
          plotsEndBeforeProperties: Boolean(properties && plots) && plots.right <= properties.left + 1,
          propertiesBottom: Number(properties?.bottom.toFixed(2) || 0),
          plotsRight: Number(plots?.right.toFixed(2) || 0),
          propertiesLeft: Number(properties?.left.toFixed(2) || 0)
        };
      })()`);
      if (!paneLayoutInteraction.propertiesReachesBottom || !paneLayoutInteraction.plotsEndBeforeProperties) {
        throw new Error("Properties and plot panes did not occupy their requested grid regions.");
      }
      const snapshot = await window.webContents.executeJavaScript(`({
        title: document.title,
        shell: Boolean(document.querySelector('.app-shell')),
        canvasCount: document.querySelectorAll('canvas').length,
        packageName: document.querySelector('.package-name')?.textContent,
        packageSource: document.querySelector('.package-subtitle')?.textContent,
        metricCount: document.querySelectorAll('.metrics-grid > div').length,
        sourceCount: document.querySelectorAll('.scene-tree .tree-button').length,
        activeFidelity: document.querySelector('.fidelity-switcher button.active span')?.textContent,
        boundaryButtonTitle: document.querySelectorAll('.fidelity-switcher button')[1]?.title,
        boundaryBackendLabel: document.querySelectorAll('.fidelity-switcher button')[1]?.querySelector('small')?.textContent,
        coupledButtonTitle: document.querySelectorAll('.fidelity-switcher button')[2]?.title,
        solveButtonEnabled: !document.querySelector('.primary-button')?.disabled,
        solveButtonLabel: document.querySelector('.primary-button')?.textContent?.trim(),
        openProjectAvailable: Boolean(document.querySelector('button[aria-label="Open project"]')),
        liveSolveEnabled: document.querySelector('.primary-button')?.getAttribute('aria-pressed'),
        solveStatus: document.querySelector('.solve-status strong')?.textContent,
        solveError: document.querySelector('.error-toast span')?.textContent || null
      })`);
      console.log(JSON.stringify({ ...snapshot, openProjectInteraction, packageImportInteraction, rigidMeshInteraction, transformInteraction, planeResolutionInteraction, sceneObjectInteraction, traceFilterInteraction, chartResizeInteraction, emptySourceInteraction, paneLayoutInteraction, level2Move, consoleErrors }));
      if (openProjectInteraction?.error || consoleErrors.length) {
        app.exit(1);
        return;
      }
      if (process.platform === "darwin" && (
        snapshot.boundaryBackendLabel !== "Metal" ||
        !snapshot.coupledButtonTitle?.includes("currently requires CUDA")
      )) {
        console.error("macOS Deploy must select Metal for Level 2 and explain that Level 3 requires CUDA.");
        app.exit(1);
        return;
      }
      if (level2Smoke && (!level2Move?.moved || level2Move.error)) {
        console.error("Deploy Level 2 desktop solve or follow-up edit solve did not complete.");
        app.exit(1);
        return;
      }
      app.quit();
    });
    setTimeout(() => {
      console.error("Deploy desktop smoke test timed out.");
      app.exit(1);
    }, benchmarkLevel2 ? 720000 : level2Smoke ? 130000 : 90000).unref();
  }

  if (app.isPackaged || process.argv.includes("--built")) {
    void window.loadFile(join(here, "../dist/index.html"));
  } else {
    void window.loadURL("http://127.0.0.1:5173");
  }
}

async function readPackageSelection(path) {
  const bytes = await readFile(path);
  return {
    name: path.split(/[\\/]/).pop() ?? "speaker.blabsp",
    path,
    bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

// Only text payloads are exposed, not unrestricted clipboard or Electron access.
ipcMain.handle("deploy:read-scene-clipboard", () => {
  const text = clipboard.readText();
  if (text.length > 2_000_000) throw new Error("Clipboard selection is too large.");
  return text;
});
ipcMain.handle("deploy:write-scene-clipboard", (_event, text) => {
  if (typeof text !== "string" || text.length > 2_000_000) throw new Error("Invalid scene clipboard payload.");
  const value = JSON.parse(text);
  if (value?.schema !== "boundary-lab-deploy-selection" || value.version !== 1) throw new Error("Invalid scene clipboard format.");
  clipboard.writeText(text);
});

ipcMain.handle("deploy:load-bundled-example", async () => {
  const path = join(libraryRoot, "S218BP_LOD.blabsp");
  try {
    return await readPackageSelection(path);
  } catch {
    return null;
  }
});

ipcMain.handle("deploy:open-speaker-package", async () => {
  const selection = await dialog.showOpenDialog({
    title: "Open Boundary Lab speaker package",
    filters: [
      { name: "Boundary Lab speaker packages", extensions: ["blabsp"] },
      { name: "All files", extensions: ["*"] },
    ],
    properties: ["openFile"],
  });
  if (selection.canceled || selection.filePaths.length === 0) return null;
  return readPackageSelection(selection.filePaths[0]);
});

ipcMain.handle("deploy:open-rigid-mesh", async () => {
  const selection = await dialog.showOpenDialog({
    title: "Import rigid boundary mesh",
    filters: [
      { name: "Gmsh meshes", extensions: ["msh"] },
      { name: "All files", extensions: ["*"] },
    ],
    properties: ["openFile"],
  });
  if (selection.canceled || selection.filePaths.length === 0) return null;
  return readPackageSelection(selection.filePaths[0]);
});

ipcMain.handle("deploy:recent-projects", () => recentProjects.list());
ipcMain.handle("deploy:remember-project", async (_event, path, name) => {
  if (typeof path !== "string" || !isAbsolute(path) || typeof name !== "string") throw new Error("Invalid project reference.");
  await recentProjects.remember(path, name);
});
ipcMain.handle("deploy:open-project", async (_event, recentPath) => {
  if (recentPath !== undefined && (typeof recentPath !== "string" || !(await recentProjects.list()).some(p => p.path === recentPath))) throw new Error("Unknown recent project.");
  const selection = recentPath ? { canceled: false, filePaths: [recentPath] } : await dialog.showOpenDialog({
    title: "Open Boundary Lab Deploy project",
    filters: [
      { name: "Boundary Lab Deploy projects", extensions: ["blabdeploy.json"] },
      { name: "JSON files", extensions: ["json"] },
      { name: "All files", extensions: ["*"] },
    ],
    properties: ["openFile"],
  });
  if (selection.canceled || selection.filePaths.length === 0) return null;
  const projectPath = selection.filePaths[0];
  const contents = await readFile(projectPath, "utf8");
  let project;
  try {
    project = JSON.parse(contents);
  } catch {
    return { name: basename(projectPath), path: projectPath, contents, packages: [], rigidMeshes: [] };
  }
  const packageReferences = Array.isArray(project?.packages) ? project.packages : [];
  const packages = [];
  for (const reference of packageReferences) {
    const sourceFile = typeof reference?.source_file === "string" ? reference.source_file : null;
    const candidates = sourceFile ? [
      isAbsolute(sourceFile) ? sourceFile : resolve(dirname(projectPath), sourceFile),
      join(libraryRoot, basename(sourceFile)),
    ] : [];
    let packageResult = null;
    for (const candidate of [...new Set(candidates)]) {
      try {
        packageResult = await readPackageSelection(candidate);
        break;
      } catch {
        // Try the next portable or bundled package location.
      }
    }
    if (!packageResult) {
      const packageSelection = await dialog.showOpenDialog({
        title: sourceFile ? `Locate ${basename(sourceFile)}` : `Locate ${reference?.name ?? "speaker package"}`,
        defaultPath: dirname(projectPath),
        filters: [
          { name: "Boundary Lab speaker packages", extensions: ["blabsp"] },
          { name: "All files", extensions: ["*"] },
        ],
        properties: ["openFile"],
      });
      if (packageSelection.canceled || packageSelection.filePaths.length === 0) break;
      packageResult = await readPackageSelection(packageSelection.filePaths[0]);
    }
    packages.push(packageResult);
  }
  const rigidReferences = Array.isArray(project?.rigid_meshes) ? project.rigid_meshes : [];
  const rigidMeshes = [];
  for (const reference of rigidReferences) {
    const sourceFile = typeof reference?.source_file === "string" ? reference.source_file : null;
    const candidates = sourceFile ? [
      isAbsolute(sourceFile) ? sourceFile : resolve(dirname(projectPath), sourceFile),
      join(libraryRoot, basename(sourceFile)),
    ] : [];
    let meshResult = null;
    for (const candidate of [...new Set(candidates)]) {
      try {
        meshResult = await readPackageSelection(candidate);
        break;
      } catch {
        // Try the next portable or bundled mesh location.
      }
    }
    if (!meshResult) {
      const meshSelection = await dialog.showOpenDialog({
        title: sourceFile ? `Locate ${basename(sourceFile)}` : `Locate ${reference?.name ?? "rigid mesh"}`,
        defaultPath: dirname(projectPath),
        filters: [
          { name: "Gmsh meshes", extensions: ["msh"] },
          { name: "All files", extensions: ["*"] },
        ],
        properties: ["openFile"],
      });
      if (meshSelection.canceled || meshSelection.filePaths.length === 0) break;
      meshResult = await readPackageSelection(meshSelection.filePaths[0]);
    }
    rigidMeshes.push(meshResult);
  }
  return { name: basename(projectPath), path: projectPath, contents, packages, rigidMeshes };
});

ipcMain.handle("deploy:save-project", async (_event, contents, suggestedName) => {
  const selection = await dialog.showSaveDialog({
    title: "Save Boundary Lab Deploy project",
    defaultPath: suggestedName,
    filters: [
      { name: "Boundary Lab Deploy projects", extensions: ["blabdeploy.json"] },
      { name: "JSON files", extensions: ["json"] },
    ],
  });
  if (selection.canceled || !selection.filePath) return null;
  await writeFile(selection.filePath, contents, "utf8");
  // Recent-list persistence must not turn a successful save into a failed save.
  await recentProjects.remember(selection.filePath, JSON.parse(contents).name).catch(error => console.warn("Could not update recent projects", error));
  return selection.filePath;
});

ipcMain.handle("deploy:solve-level2", async (event, payload) => deployWorker.solve(payload, event.sender));
ipcMain.handle("deploy:microphone-sweep", async (event, payload) => deployWorker.microphoneSweep(payload, event.sender));
ipcMain.handle("deploy:cancel-microphone-sweep", async () => deployWorker.cancelMicrophoneSweep());

app.whenReady().then(() => {
  createWindow();
  if (!packagedSmoke) void solverPreferences.get().then(backend => deployWorker.warmup(backend)).catch((error) => console.error("Deploy worker warmup failed", error));
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => deployWorker.close());
