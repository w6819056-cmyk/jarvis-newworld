// Run against the installed app started with a wake-only fake microphone and loopback CDP.
import assert from 'node:assert/strict';
const targets=await (await fetch('http://127.0.0.1:9231/json')).json();
const page=targets.find(p=>p.url==='file:///E:/Jarvis/resources/app.asar/dist-windows/windows.html');
assert.ok(page,'installed Jarvis renderer must exist');
const ws=new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
let seq=0; const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}};
const evaluate=expression=>new Promise(resolve=>{const id=++seq;pending.set(id,resolve);ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}))});
await evaluate(`window.__wakeStates=[]; window.__wakeCleanup=window.jarvis.onState(s=>window.__wakeStates.push({status:s.status,busy:s.busy,detail:s.detail})); window.jarvis.getState().then(s=>window.__wakeStates.push({status:s.status,busy:s.busy,detail:s.detail}))`);
if(process.argv.includes('--visuals'))await evaluate(`window.__wakeMotion=[];window.__wakeMotionCleanup=window.jarvis.onSignal(signal=>{if(signal!=='wake'||window.__wakeMotionStarted)return;window.__wakeMotionStarted=true;const start=performance.now();function sample(){const animations=document.getAnimations(),materialize=animations.find(a=>a.animationName==='windows-materialize');window.__wakeMotion.push({elapsed:performance.now()-start,time:materialize?.currentTime,duration:materialize?.effect.getTiming().duration,shards:animations.filter(a=>a.animationName==='windows-shard-assemble').length});if(performance.now()-start<5300)requestAnimationFrame(sample)}requestAnimationFrame(sample)})`);
// Model startup and the fake-device's first buffered syllable vary by machine.
// Wait for the observed sequence rather than assuming it finishes in 16 seconds.
for(let i=0;i<60;i++) {
  await new Promise(resolve=>setTimeout(resolve,500));
  const probe=(await evaluate(`({spoken:window.__wakeStates.some(s=>s.status==='speaking'),listening:window.__wakeStates.at(-1)?.status==='listening',motionDone:window.__wakeMotion?.at(-1)?.elapsed>=5300})`)).result.result.value;
  if(probe.spoken&&probe.listening&&(!process.argv.includes('--visuals')||probe.motionDone))break;
}
const result=await evaluate('window.__wakeCleanup(); window.__wakeStates');
const motion=process.argv.includes('--visuals')?(await evaluate('window.__wakeMotionCleanup(); window.__wakeMotion')).result.result.value:undefined;
ws.close();
const states=result.result.result.value;
console.log(JSON.stringify(states));
if(motion) {
  assert.ok(motion.length>=30,'installed transparent window must render the full wake sequence');
  assert.ok(motion.some(f=>f.time>600&&f.time<2400),'assembly must render intermediate frames');
  assert.ok(motion.some(f=>f.time===4200),'materialization must reach its 4200ms endpoint');
  assert.ok(motion.every(f=>f.duration===4200&&f.shards===19),'installed animation must keep the compact timing and all armor pieces');
  const gaps=motion.slice(1).map((f,i)=>f.elapsed-motion[i].elapsed);const crossover=motion.slice(1).map((f,i)=>({elapsed:f.elapsed,gap:f.elapsed-motion[i].elapsed})).filter(f=>f.elapsed>=2800&&f.elapsed<=4500);console.log(JSON.stringify({motionFrames:motion.length,first:motion[0],last:motion.at(-1),maxFrameGap:Math.max(...gaps),crossoverMaxGap:Math.max(...crossover.map(f=>f.gap)),gapsOver50ms:gaps.filter(g=>g>50).length}));
}
assert.ok(states.some(s=>s.status==='listening'),'installed recognizer must wake the real gate');
assert.ok(states.some(s=>s.status==='speaking'),'wake-only speech must invoke the real acknowledgment');
assert.ok(states.every(s=>!s.busy),'wake-only speech must not send a Codex task');
assert.ok(states.every(s=>s.status!=='degraded'),'native voice playback must not report failure');
console.log('Installed wake and native speech acknowledgment passed');
