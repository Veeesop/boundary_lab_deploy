const {app,BrowserWindow}=require('electron');
const {build}=require('esbuild');
const assert=require('node:assert/strict');
const {join}=require('node:path');
const {readFileSync,writeFileSync,mkdirSync}=require('node:fs');
app.whenReady().then(async()=>{
  setTimeout(()=>{console.error('Editing test timed out');app.exit(1);},90000).unref();
  const win=new BrowserWindow({show:false,width:1500,height:1000,webPreferences:{backgroundThrottling:false,offscreen:true}});
  const errors=[];
  win.webContents.on('console-message',(_e,level,message)=>{if(level>=3) errors.push(message);});
  try {
    const mesh=Array.from(readFileSync(join(__dirname,'../library/RigidStage_LOD.msh')));
    const bundle=await build({absWorkingDir:join(__dirname,'..'),bundle:true,write:false,format:'iife',jsx:'automatic',
      plugins:[{name:'disk-backed-demo',setup(b){b.onLoad({filter:/SceneView\.tsx$/},args=>({contents:readFileSync(args.path,'utf8').replace('export function SceneView(props: SceneViewProps) {','export function SceneView(props: SceneViewProps) { (window as any).planeFrames = props.planes?.map(p => ({ id: p.observation.id, spl: p.field.splDb[0] }));'),loader:'tsx'}));b.onLoad({filter:/demoPackage\.ts$/},args=>({
        contents:readFileSync(args.path,'utf8').replace('sourcePath: null','sourcePath: "fixture.blabsp"'),loader:'ts'}));}}],
      outdir:'unused',define:{'process.env.NODE_ENV':'"production"'},stdin:{resolveDir:join(__dirname,'..'),loader:'tsx',contents:`
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {App} from './src/App'; import './src/styles.css';
      window.clipText=''; window.failWrite=false;
      window.testDesktop={getSolverBackend:async()=>"cuda",setSolverBackend:async(backend)=>{window.savedBackend=backend;return backend;},detectSolverBackend:async(backend)=>backend==="metal",recentProjects:async()=>window.saved?[{path:'E:/Studies/test.blabdeploy.json',name:window.saved.name,modifiedAt:'2026-09-20T12:00:00Z',openedAt:'2026-09-22T12:00:00Z',available:true}]:[],rememberProject:async()=>{},
        openProject:async(path)=>{window.openedPath=path;return {name:'test.blabdeploy.json',path,contents:JSON.stringify(window.saved),packages:[],rigidMeshes:[]};},loadBundledExample:async()=>null,onSolveStatus:()=>()=>{},onMicrophoneSweepProgress:()=>()=>{},
        solveLevel2:async(request)=>new Promise(resolve=>{(window.solveRequests ||= []).push(request);window.finishSolve=resolve;}),
        calculateMicrophoneSweep:async()=>new Promise(resolve=>{window.finishSweep=resolve;}),
        cancelMicrophoneSweep:async()=>{window.cancelledSweeps=(window.cancelledSweeps||0)+1;return true;},
        readSceneClipboard:async()=>window.clipText,writeSceneClipboard:async(text)=>{if(window.failWrite)throw Error('Clipboard unavailable');window.clipText=text;},
        saveProject:async(text)=>{window.saved=JSON.parse(text);return 'study.blabdeploy.json';},
        openRigidMesh:async()=>({name:'Stage.msh',path:'Stage.msh',bytes:Uint8Array.from(${JSON.stringify(mesh)}).buffer})};
      window.boundaryLabDesktop=window.testDesktop;window.confirm=()=>true;
      createRoot(document.getElementById('root')).render(<App/>);
      `}});
    const css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
    const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text;
    const dir=join(__dirname,'../node_modules/.tmp');mkdirSync(dir,{recursive:true});
    const html=join(dir,'scene-editing.html');writeFileSync(html,'<div id="root"></div><style>'+css+'</style>');
    await win.loadFile(html);await win.webContents.executeJavaScript(js+";void 0;");
    const run=code=>win.webContents.executeJavaScript(code).catch(error=>{throw Error(code+"\n"+error);});
    const delay=ms=>new Promise(r=>setTimeout(r,ms));
    async function wait(code){for(let i=0;i<100;i++){if(await run(`Boolean(${code})`))return;await delay(50);}throw Error('Waiting for '+code);}
    const click=async selector=>{await run(`document.querySelector(${JSON.stringify(selector)}).click()`);await delay(80);};
    const key=async(k,mods='')=>{
      const modifiers=['control',...(mods.includes('shiftKey:true')?['shift']:[])];
      win.webContents.sendInputEvent({type:'keyDown',keyCode:k.toUpperCase(),modifiers});
      win.webContents.sendInputEvent({type:'keyUp',keyCode:k.toUpperCase(),modifiers});
      await delay(150);
    };
    const count=prefix=>run(`document.querySelectorAll('.tree-button[data-object-id^="${prefix}-"]').length`);
    const save=async()=>{await click('button[title="Save project"]');return run('window.saved');};
    await wait('document.querySelector(".projects-screen")');
    assert.equal(await run('document.querySelectorAll("canvas").length'),0,'Launcher does not mount a viewport');
    await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='New').click()`);
    await wait('document.querySelector(".app-shell")');
    await click('button[aria-label="Preferences"]');
    await wait('document.querySelector("dialog[open]")');
    assert.equal(await run('document.querySelector("#solver-backend").value'), 'cuda');
    assert.equal(await run('[...document.querySelector("#solver-backend").options].some(option=>option.value==="metal")'), true);
    await run(`(()=>{const select=document.querySelector('#solver-backend');select.value='cpu';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await wait('window.savedBackend === "cpu"');
    assert.equal(await run('document.querySelector("#solver-backend").value'), 'cpu');
    await run(`(()=>{const select=document.querySelector('#solver-backend');select.value='cuda';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await wait('window.savedBackend === "cuda"');
    assert.equal(await run('document.querySelector("#solver-backend").value'), 'cuda', 'Explicit CUDA remains selected on macOS');
    await win.webContents.capturePage().then(image=>writeFileSync(join(dir,'solver-preferences.png'),image.toPNG()));
    await click('dialog button.processing-button');
    await click('button[aria-label="Preferences"]');
    assert.equal(await run('document.querySelector("#solver-backend").value'), 'cuda');
    await run(`(()=>[...document.querySelectorAll('dialog button')].find(button=>button.textContent==='Check CUDA').click())()`);
    await wait('document.querySelector(".error-toast")');
    assert.ok(await run('document.querySelector(".error-toast")?.textContent?.includes("unavailable")'));
    assert.equal(await run('document.querySelector("#solver-backend").value'), 'cuda', 'An unavailable probe does not silently change selection');
    await click('dialog button.processing-button');
    assert.equal((await save()).system_gain_db,32);
    assert.equal((await save()).channels[0].levelDb,-24);
    await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Scene').click()`);
    await delay(80);
    assert.equal(await run(`document.querySelector('input[aria-label="System gain"]').value`),'32');
    await run(`(()=>{const input=document.querySelector('input[aria-label="System gain"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'26');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await delay(80);
    assert.equal((await save()).system_gain_db,26);
    await key('z');assert.equal((await save()).system_gain_db,32);
    await key('y');assert.equal((await save()).system_gain_db,26);
    await key('z');
    await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Library').click()`);
    await delay(80);

    const blank=await save();
    assert.equal(blank.packages.length,0);assert.equal(blank.sources.length,0);assert.equal(blank.audience_planes.length,0);
    await click('button[aria-label="Add audience plane"]');
    await click('button[aria-label="Add audience plane"]');
    let planes=(await save()).audience_planes;assert.equal(planes.length,2);assert.notEqual(planes[0].id,planes[1].id);
    await key('z');assert.equal((await save()).audience_planes.length,1);
    await key('y');assert.equal((await save()).audience_planes.length,2);
    await click('button[aria-label="Remove selected objects"]');assert.equal((await save()).audience_planes.length,1);
    await key('z');assert.equal((await save()).audience_planes.length,2);
    assert.equal(await run('document.querySelectorAll(".solve-status em").length'),0);
    assert.equal((await save()).heatmap_scale.heatmapMinimumDb,70);
    assert.equal((await save()).heatmap_scale.heatmapMaximumDb,125);
    assert.equal(await run(`document.querySelector('input[aria-label="Points per meter"]').min`),'0.5');
    assert.equal(await run(`document.querySelector('input[aria-label="Points per meter"]').max`),'10');
    await run(`(()=>{const input=document.querySelector('input[aria-label="Points per meter"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'10');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await delay(100);
    assert.equal((await save()).audience_planes[1].pointsPerMeter,10);
    assert.equal((await save()).audience_planes[1].columns,241);
    writeFileSync(join(dir,'plane-density.png'),(await win.capturePage()).toPNG());
    await key('z');assert.equal((await save()).audience_planes[1].pointsPerMeter,2);
    await key('y');assert.equal((await save()).audience_planes[1].pointsPerMeter,10);
    await key('z');

    for (const [label,value] of [['Scale minimum',65],['Scale maximum',125],['Banding',7]]) {
      await run(`(()=>{const input=document.querySelector('input[aria-label="${label}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'${value}');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await delay(80);
    }
    const scaled=await save();
    assert.ok(scaled.audience_planes.every(p=>p.heatmapMinimumDb===65 && p.heatmapMaximumDb===125 && p.heatmapBandingDb===7));
    await key('z');assert.ok((await save()).audience_planes.every(p=>p.heatmapBandingDb===planes[0].heatmapBandingDb));
    await key('y');
    await click('button[aria-label="Add audience plane"]');
    assert.equal((await save()).audience_planes.at(-1).heatmapBandingDb,7,'New planes inherit the shared scale');
    await key('z');await save();
    await run('Object.assign(window.saved.audience_planes[0],{widthM:100,depthM:100,pointsPerMeter:2,columns:201,rows:201})');
    await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Projects').click()`);
    await wait('document.querySelector(".recent-project-link")');
    assert.equal(await run('document.querySelectorAll(".projects-heading p, .projects-section-title span").length'),0);
    assert.ok(await run(`document.querySelector('.recent-project-link').textContent.includes('E:/Studies/test.blabdeploy.json')`));
    writeFileSync(join(dir,'projects-screen.png'),(await win.capturePage()).toPNG());
    await click('.recent-project-link');
    await wait('document.querySelector(".app-shell")');
    assert.equal(await run('window.openedPath'),'E:/Studies/test.blabdeploy.json');
    assert.equal((await save()).audience_planes.length,2,'Recent project restores every plane without speaker packages');
    assert.ok((await save()).audience_planes.every(p=>p.heatmapBandingDb===7),'Global scales survive reopening');
    await run(`document.querySelector('.tree-button[data-object-id="audience-plane-1"]').click()`);await delay(80);
    await run(`(()=>{const input=document.querySelector('input[aria-label="Points per meter"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'10');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await delay(80);
    assert.ok(await run('document.querySelector(".plane-sampling-error").textContent.includes("250,000")'));
    assert.equal((await save()).audience_planes[0].pointsPerMeter,2,'Over-limit setting preserves density');
    assert.equal((await save()).audience_planes[0].columns,201,'Over-limit setting preserves grid');

    await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Projects').click()`);
    await wait('document.querySelector(".projects-screen")');
    // Use the generated browser example here; disk package parsing has separate coverage.
    await run(`window.boundaryLabDesktop=undefined;Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Open example').click()`);
    await wait('document.querySelectorAll(".tree-button").length>=3');
    await run("window.boundaryLabDesktop=window.testDesktop;void 0;");
    const start=await save();assert.equal(start.sources.length,2);
    // Actual app integration: editor identity, adaptive rows, preview and persisted history.
    const buttonText=async text=>{await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes(${JSON.stringify(text)})).click()`);await delay(100);};
    const setParameter=async(label,value,select=false)=>{
      await run(`(()=>{const input=document.querySelector('[aria-label="${label}"]');input.focus();Object.getOwnPropertyDescriptor(${select?'HTMLSelectElement':'HTMLInputElement'}.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('${select?'change':'input'}',{bubbles:true}));})()`);
      await delay(80);await run(`document.querySelector('[aria-label="${label}"]').dispatchEvent(new FocusEvent('focusout',{bubbles:true}))`);await delay(80);
    };
    await buttonText('Open speaker EQ');
    assert.equal(await run('document.querySelectorAll("[data-eq-slot]").length'),8);
    assert.equal(await run('document.querySelectorAll("[data-eq-slot] .eq-parameter").length'),32);
    assert.equal((await save()).sources[0].equalizer.filters.length,0,'Opening does not write filters');
    const flatMagnitude=await run('document.querySelector("[data-eq-magnitude]").getAttribute("d")');
    await click('input[aria-label="Filter 6 enabled"]');
    await setParameter('Filter 6 gain','6');
    assert.notEqual(await run('document.querySelector("[data-eq-magnitude]").getAttribute("d")'),flatMagnitude);
    await run('document.querySelector(".filter-bank-editor").focus()');
    await key('z');assert.equal((await save()).sources[0].equalizer.filters[0].gainDb,0);
    await key('y');assert.equal((await save()).sources[0].equalizer.filters[0].gainDb,6);
    await setParameter('Filter 6 type','allpass',true);
    assert.equal(await run(`document.querySelector('input[aria-label="Filter 6 gain (not used)"]').disabled`),true);
    const phase=await run('document.querySelector("[data-eq-phase]").getAttribute("d")');
    await click('input[aria-label="Bypass filter bank"]');
    assert.notEqual(await run('document.querySelector("[data-eq-phase]").getAttribute("d")'),phase);
    await click('input[aria-label="Bypass filter bank"]');
    await click('input[aria-label="High-pass enabled"]');
    await setParameter('High-pass family','linkwitz-riley',true);
    await setParameter('High-pass slope','4',true);
    assert.equal(await run(`document.querySelector('input[aria-label="High-pass Q (set by family)"]').disabled`),true);
    await setParameter('High-pass frequency','40');
    await run(`(()=>{const input=document.querySelector('input[aria-label="High-pass frequency"]');input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'999');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await delay(80);
    await run(`(()=>{const input=document.querySelector('input[aria-label="High-pass frequency"]');input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));input.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));})()`);
    await delay(80);
    assert.equal((await save()).sources[0].equalizer.filters.find(f=>f.type==='highpass').frequencyHz,40,'Escape cancels a numeric draft');
    const speakerBank=(await save()).sources[0].equalizer;
    assert.equal(speakerBank.filters.find(f=>f.type==='highpass').order,4);
    writeFileSync(join(dir,'filter-bank-gui.png'),(await win.capturePage()).toPNG());
    win.setSize(900,700);await delay(200);
    assert.ok(await run('document.querySelector(".eq-bank-scroll").scrollWidth > document.querySelector(".eq-bank-scroll").clientWidth'));
    assert.ok(await run('document.querySelector(".filter-bank-editor").getBoundingClientRect().bottom <= innerHeight'));
    writeFileSync(join(dir,'filter-bank-gui-narrow.png'),(await win.capturePage()).toPNG());
    win.setSize(1500,1000);await delay(200);
    await setParameter('High-pass frequency','');
    assert.equal((await save()).sources[0].equalizer.filters.find(f=>f.type==='highpass').frequencyHz,40,'Blank input does not change frequency');

    // Scene shortcuts cannot delete or cut behind the modal; Tab stays inside it.
    await run('document.querySelector(".filter-bank-editor").focus()');
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Delete'});await delay(80);
    assert.equal((await save()).sources.length,2);
    await run('document.querySelector(".filter-bank-editor footer button").focus()');
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});await delay(80);
    assert.equal(await run('document.activeElement.getAttribute("aria-label")'),'Bypass filter bank');
    await click('button[aria-label="Close equalizer"]');
    await buttonText('Open speaker EQ');
    assert.equal(await run(`document.querySelector('select[aria-label="Filter 6 type"]').value`),'allpass');
    await click('button[aria-label="Close equalizer"]');
    await buttonText('Channels');await buttonText('Open channel EQ');
    await click('input[aria-label="Low-pass enabled"]');
    await setParameter('Low-pass frequency','120');
    await click('button[aria-label="Close equalizer"]');
    const withEQ=await save();
    assert.equal(withEQ.channels[0].equalizer.filters[0].type,'lowpass');
    assert.deepEqual(withEQ.sources[0].equalizer,speakerBank,'Channel editing does not overwrite speaker EQ');
    await buttonText('Library');

    await key('d');assert.equal(await count('subwoofer'),2,'Ctrl+D is removed');
    assert.equal(await run('document.querySelectorAll(\'button[aria-label="Duplicate selected boundary objects"]\').length'),0);
    await key('c');await key('v');assert.equal(await count('subwoofer'),3);
    await key('z');assert.equal(await count('subwoofer'),2);await key('y');assert.equal(await count('subwoofer'),3);
    await key('z');
    await click('button[aria-label="Add microphone"]');
    await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Import mesh').click()`);
    await wait('document.querySelector(".rigid-mesh-library .package-card")');
    await click('button[aria-label="Add rigid object"]');
    await run(`document.querySelector('.tree-button[data-object-id="subwoofer-1"]').click();`);
    await delay(50);
    for(const id of ['rigid-1','microphone-1']) {
      await run(`document.querySelector('.tree-button[data-object-id="${id}"]').dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true}))`);await delay(50);
    }
    await key('c');const mixedBefore=await save();await key('v');const mixed=await save();
    assert.equal(mixed.sources.length,mixedBefore.sources.length+1);assert.equal(mixed.rigid_objects.length,2);assert.equal(mixed.microphones.length,2);
    const dx=mixed.sources.at(-1).positionX-mixedBefore.sources[0].positionX;
    assert.ok(Math.abs(mixed.rigid_objects.at(-1).positionX-mixedBefore.rigid_objects[0].positionX-dx)<1e-8);
    assert.ok(Math.abs(mixed.microphones.at(-1).positionX-mixedBefore.microphones[0].positionX-dx)<1e-8);
    await key('z');assert.deepEqual((await save()).sources,mixedBefore.sources);assert.equal(await count('rigid'),1);
    await key('z','shiftKey:true');assert.equal(await count('rigid'),2);
    await key('x');assert.equal(await count('rigid'),1);assert.equal(await count('microphone'),1);
    await key('z');assert.equal(await count('rigid'),2);assert.equal(await count('microphone'),2);
    await run('window.failWrite=true');await key('x');assert.equal(await count('rigid'),2,'Failed clipboard write must not cut');await run('window.failWrite=false');
    // A controlled number-field edit is one history step, and text shortcuts do not reach the scene.
    await click('.tree-button[data-object-id="subwoofer-1"]');
    const beforeProperty=await save();
    await run(`(()=>{const input=document.querySelector('.right-panel input[aria-label="X"]');input.focus();
      const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      for(const value of [-20,-21,-22]){set.call(input,String(value));input.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
    await delay(100);
    const focusedCount=await count('subwoofer');
    await run(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'x',ctrlKey:true,bubbles:true}))`);
    await delay(50);assert.equal(await count('subwoofer'),focusedCount,'Input cut must not delete objects');
    await run('document.activeElement.blur()');await delay(100);
    assert.equal((await save()).sources[0].positionX,-22);
    await key('z');
    assert.deepEqual((await save()).sources,beforeProperty.sources,'Typing one property is one undo step');
    assert.equal(await run(`document.querySelectorAll('.edit-menu, [aria-label="Edit commands"]').length`),0);
    // Range gestures coalesce all intermediate values, including keyboard focus.
    const beforeSlider=await save();
    await run(`(()=>{const input=document.querySelector('input[aria-label="Object delay"][type=range]');input.focus();
      input.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
      const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      for(const value of [1,2,3]){set.call(input,String(value));input.dispatchEvent(new Event('input',{bubbles:true}));}
      input.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));})()`);
    await delay(100);assert.equal((await save()).sources[0].delayMs,3);
    await key('z');assert.equal((await save()).sources[0].delayMs,beforeSlider.sources[0].delayMs);
    // Offscreen windows do not emit native focus notifications: dispatch them explicitly.
    // Blurring one property must not prematurely end the next property's transaction.
    const beforeFocus=await save();
    await run(`(()=>{const x=document.querySelector('.right-panel input[aria-label="X"]');x.focus();x.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(x,'-30');x.dispatchEvent(new Event('input',{bubbles:true}));
      x.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));
      const depth=document.querySelector('.right-panel input[aria-label="Depth"]');depth.focus();depth.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));})()`);
    for(const value of [10,11]) {
      await delay(80);
      await run(`(()=>{const d=document.activeElement;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(d,'${value}');d.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    }
    await run(`document.activeElement.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));document.activeElement.blur()`);await delay(50);await key('z');
    const afterFocus=await save();assert.equal(afterFocus.sources[0].positionX,-30);assert.equal(afterFocus.sources[0].positionZ,beforeFocus.sources[0].positionZ);
    await key('z');assert.equal((await save()).sources[0].positionX,beforeFocus.sources[0].positionX);
    // Late backend completions cannot revive results after undo/redo restores an old key.
    await run(`Array.from(document.querySelectorAll('.fidelity-switcher button')).find(b=>b.textContent.includes('Boundary')).click()`);
    await delay(100);await click('button[aria-label="Add microphone"]');
    await click('button[aria-label="Add audience plane"]');
    await run(`Array.from(document.querySelectorAll('.topbar button')).find(b=>b.textContent.includes('Solve field')).click()`);
    await wait('window.solveRequests?.length === 1');
    await run(`window.finishSolve({columns:2,rows:2,spl_db:[40,40,40,40],sample_indices:[0,1,2,3],field_pressure:{real:[1,1,1,1],imag:[0,0,0,0]},timings:{}})`);
    await wait('window.solveRequests?.length === 2');
    assert.equal(await run('window.solveRequests[1].reuseBoundary'),true,'Reuse the boundary solution for the next plane');
    await run(`window.finishSolve({columns:2,rows:2,spl_db:[90,90,90,90],sample_indices:[0,1,2,3],field_pressure:{real:[2,2,2,2],imag:[0,0,0,0]},timings:{}})`);
    await wait('window.planeFrames?.[1]?.spl === 90');
    assert.deepEqual(await run('window.planeFrames.map(p=>p.spl)'),[40,90],'Distinct solver fields are routed to the matching planes');
    await run(`Array.from(document.querySelectorAll('.topbar button')).find(b=>b.textContent.includes('Pause solve')).click()`);
      await click('button[aria-label="Preferences"]');
      await run(`(()=>{const select=document.querySelector('#solver-backend');select.value='cuda';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await wait('window.savedBackend === "cuda"');
      await click('dialog button.processing-button');
    await run(`Array.from(document.querySelectorAll('.topbar button')).find(b=>b.textContent.includes('Solve field')).click()`);
    await wait('window.solveRequests?.length === 3');
    assert.equal(await run('window.solveRequests[2].backend'),'cuda');
      assert.equal(await run('window.solveRequests[2].reuseBoundary'),false,'Backend switch invalidates cached CPU boundary');
      await click('button[aria-label="Preferences"]');
      assert.equal(await run('document.querySelector("#solver-backend").disabled'),true,'Do not switch during a solve');
      await click('dialog button.processing-button');
    await run(`window.finishSolve({columns:2,rows:2,spl_db:[40,40,40,40],sample_indices:[0,1,2,3],field_pressure:{real:[1,1,1,1],imag:[0,0,0,0]},timings:{}})`);
    await wait('window.solveRequests?.length === 4');
    assert.equal(await run('window.solveRequests[3].reuseBoundary'),true);
    await run(`window.finishSolve({columns:2,rows:2,spl_db:[90,90,90,90],sample_indices:[0,1,2,3],field_pressure:{real:[2,2,2,2],imag:[0,0,0,0]},timings:{}})`);
    await wait('window.planeFrames?.[1]?.spl === 90');
    await click('button[aria-label="Add audience plane"]');
    await wait('window.solveRequests?.length === 5');
    const revision=await run(`document.querySelector('.solve-status').dataset.solveRevision`);
    await key('z');await key('y');
    await run(`window.finishSolve({columns:2,rows:2,spl_db:[80,80,80,80],sample_indices:[0,1,2,3],field_pressure:{real:[1,1,1,1],imag:[0,0,0,0]},timings:{}})`);
    await delay(100);
    assert.equal(await run(`document.querySelector('.solve-status').dataset.solveRevision`),revision);
    await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Calculate BEM Pressure')).click()`);
    await wait('typeof window.finishSweep === "function"');
    await key('z');await key('y');
    await run(`window.finishSweep({completed_count:0,total_count:0,frequencies_hz:[],microphone_ids:[],spl_db:[],transducer_ids:[],speaker_ids:[]})`);
    await delay(100);
    assert.ok(await run('window.cancelledSweeps>0'));
    assert.equal(await run(`document.querySelectorAll('.solve-error').length`),0);
    assert.ok(await run('window.solveRequests.slice(0,2).every(request=>request.backend === "cpu") && window.solveRequests.slice(2).every(request=>request.backend === "cuda")'));
    assert.deepEqual(errors,[]);
    console.log('Projects and editing UI passed: blank startup, recent reopen, multiple planes and distinct fields, clipboard/history, late result rejection.');
    app.exit(0);
  }catch(error){console.error(error);console.error(errors);app.exit(1);}
});
