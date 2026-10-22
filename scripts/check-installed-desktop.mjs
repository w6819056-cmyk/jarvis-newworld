// Own app only: inspect display bounds and native click-through calls over loopback.
import assert from 'node:assert/strict';
async function connect(port,select=pages=>pages[0]) {
  const page=select(await (await fetch(`http://127.0.0.1:${port}/json`)).json());
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
  let seq=0;const pending=new Map();
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}};
  return {ws,call:(method,params={})=>new Promise(r=>{const id=++seq;pending.set(id,r);ws.send(JSON.stringify({id,method,params}))})};
}
const main=await connect(9232),renderer=await connect(9231,pages=>pages.find(p=>p.url==='file:///E:/Jarvis/resources/app.asar/dist-windows/windows.html'));
const evaluate=async(client,expression)=>{
  const result=await client.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(result.result?.exceptionDetails)throw Error(JSON.stringify(result.result.exceptionDetails));
  return result.result?.result?.value;
};
try {
  const info=await evaluate(main,`(()=>{const {BrowserWindow,screen,app}=process.mainModule.require('electron'),w=BrowserWindow.getAllWindows()[0];globalThis.__desktopWindow=w;globalThis.__desktopIgnoreCalls=[];globalThis.__desktopOriginalIgnore=w.setIgnoreMouseEvents;w.setIgnoreMouseEvents=function(...args){__desktopIgnoreCalls.push(args);return __desktopOriginalIgnore.apply(this,args)};return {version:app.getVersion(),bounds:w.getBounds(),display:screen.getDisplayMatching(w.getBounds()).bounds,visible:w.isVisible(),transparent:w.getBackgroundColor()}})()`);
  assert.equal(info.version,'0.3.0');assert.deepEqual(info.bounds,info.display);
  const packaged=await evaluate(main,`(()=>{const fs=process.mainModule.require('node:fs'),path=process.mainModule.require('node:path'),root=require('electron').app.getAppPath();return {handModel:fs.existsSync(path.join(root,'dist-windows/models/hand_landmarker.task')),ironManModel:fs.existsSync(path.join(root,'dist-windows/models/iron_man.glb')),mark46Model:fs.existsSync(path.join(root,'dist-windows/models/mark46-original-red-gold.glb')),wasm:fs.existsSync(path.join(root,'dist-windows/mediapipe/wasm/vision_wasm_internal.wasm'))}})()`);
  assert.deepEqual(packaged,{handModel:true,ironManModel:true,mark46Model:true,wasm:true});
  const gesture=await evaluate(renderer,`(()=>{const c=document.querySelector('.helmet-3d-canvas');return {toggle:document.querySelector('#gesture-toggle').getAttribute('aria-pressed'),indicatorHidden:document.querySelector('#gesture-indicator').hidden,canvas:!!c,webgl:!!c?.getContext('webgl2'),modelVisible:c?.dataset.modelVisible,fallbackHidden:document.querySelector('#jarvis-character').classList.contains('is-3d-hidden'),modelReady:c?.dataset.modelReady==='true',partCount:Number(c?.dataset.partCount)}})()`);
  const {partCount,...gestureState}=gesture;
  assert.deepEqual(gestureState,{toggle:'false',indicatorHidden:true,canvas:true,webgl:true,modelVisible:'false',fallbackHidden:false,modelReady:true});
  assert.ok(gesture.partCount>=40&&gesture.partCount<=55);
  assert.equal(await evaluate(renderer,`getComputedStyle(document.querySelector('.win-toolbar')).opacity`),'0');
  await evaluate(renderer,`document.querySelector('.character-rig').click();document.querySelector('#settings').click();new Promise(r=>setTimeout(r,100))`);
  assert.equal(await evaluate(renderer,`document.querySelector('#settings-dialog').open`),true);
  await evaluate(renderer,`document.querySelector('#close-settings').click();document.dispatchEvent(new MouseEvent('pointermove',{clientX:1,clientY:1,bubbles:true}));new Promise(r=>setTimeout(r,100))`);
  await evaluate(renderer,`(()=>{const r=document.querySelector('#settings').getBoundingClientRect();document.dispatchEvent(new MouseEvent('pointermove',{clientX:r.x+5,clientY:r.y+5,bubbles:true}))})();new Promise(r=>setTimeout(r,100))`);
  const calls=await evaluate(main,'globalThis.__desktopIgnoreCalls');
  assert.ok(calls.some(([ignore])=>ignore===true),'blank desktop must pass mouse events through');
  assert.ok(calls.some(([ignore])=>ignore===false),'settings and dialogs must accept mouse events');
  const geometry=await evaluate(renderer,`(()=>{const h=document.querySelector('.character-rig').getBoundingClientRect(),i=document.querySelector('#command').getBoundingClientRect();return {helmetHeight:h.height,inputWidth:i.width,toolbarOpacity:getComputedStyle(document.querySelector('.win-toolbar')).opacity,canvas:[innerWidth,innerHeight]}})()`);
  assert.ok(geometry.helmetHeight>=460&&geometry.helmetHeight<=500&&geometry.inputWidth<=300);assert.equal(geometry.toolbarOpacity,'1');
  const thinking=await evaluate(renderer,`(()=>{const r=document.querySelector('.windows-shell'),h=document.querySelector('.helmet-character'),rig=document.querySelector('.character-rig');r.dataset.mode='working';r.dataset.status='working';return {animation:getComputedStyle(rig).animationName,glow:getComputedStyle(h).filter}})()`);
  assert.equal(thinking.animation,'windows-thinking');assert.match(thinking.glow,/255, 155, 47/);
  await evaluate(renderer,`document.querySelector('.windows-shell').dataset.status='approval'`);
  assert.equal(await evaluate(renderer,`getComputedStyle(document.querySelector('.character-rig')).animationName`),'windows-approval-nod');
  await evaluate(renderer,`document.querySelector('.character-rig').click()`);assert.equal(await evaluate(renderer,`getComputedStyle(document.querySelector('.win-caption')).visibility`),'hidden');
  console.log(JSON.stringify({info,geometry,nativeMouseCalls:calls,collapsedAgain:true}));
} finally {
  await evaluate(main,`if(globalThis.__desktopOriginalIgnore){__desktopWindow.setIgnoreMouseEvents=__desktopOriginalIgnore;delete globalThis.__desktopOriginalIgnore;delete globalThis.__desktopIgnoreCalls;delete globalThis.__desktopWindow}`);
  main.ws.close();renderer.ws.close();
}
