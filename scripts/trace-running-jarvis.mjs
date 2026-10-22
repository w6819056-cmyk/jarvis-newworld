// Read-only tracepoints in the installed app; no separate microphone or recognizer.
const pages = await (await fetch('http://127.0.0.1:9232/json')).json();
const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
let seq=0; const pending=new Map(), scripts=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}else if(m.method==='Debugger.scriptParsed')scripts.push(m.params)};
const call=(method,params={})=>new Promise(resolve=>{const id=++seq;pending.set(id,resolve);ws.send(JSON.stringify({id,method,params}))});
await call('Runtime.enable'); await call('Debugger.enable');
const script=scripts.find(s=>s.url.endsWith('/dist-electron/main.cjs'));
if(!script)throw new Error('Main script not found: '+JSON.stringify(scripts.map(s=>s.url).filter(s=>s.includes('main'))));
const source=(await call('Debugger.getScriptSource',{scriptId:script.scriptId})).result.scriptSource;
const lineNumber=source.split('\n').findIndex(s=>s.includes('message.type === "result" &&'));
console.log(JSON.stringify(await call('Debugger.setBreakpoint',{location:{scriptId:script.scriptId,lineNumber},condition:'(message.type === "result" && (globalThis.__jarvisTrace ??= []).push({text:message.text,final:message.final,epoch:message.epoch,audioEpoch,queuedFrames,status:state.status,paused:state.paused,speaking,awake:gate.awake}), false)'})));
console.log('INSTALLED_APP_TRACE_READY');
for(let i=0;i<30;i++) {
  await new Promise(resolve=>setTimeout(resolve,2000));
  const r=await call('Runtime.evaluate',{expression:'globalThis.__jarvisTrace?.splice(0) ?? []',returnByValue:true});
  if(r.result?.result?.value?.length)console.log(JSON.stringify(r.result.result.value));
}
await call('Debugger.disable'); ws.close();
