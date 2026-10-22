// Developer diagnostic for the local Jarvis renderer, started with a loopback debug port.
const pages = await (await fetch('http://127.0.0.1:9231/json')).json();
const page = pages.find(p => p.url === 'file:///E:/Jarvis/resources/app.asar/dist-windows/windows.html');
if (!page) throw new Error('Installed Jarvis page not found');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0;
const pending = new Map(), events = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } else events.push(m); };
const call = (method, params = {}) => new Promise(resolve => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
console.log(JSON.stringify(await call('Runtime.evaluate', { expression: 'window.jarvis.getState()', awaitPromise: true, returnByValue: true })));
await call('WebAudio.enable');
await new Promise(resolve => setTimeout(resolve, 1000));
console.log(JSON.stringify(events));
ws.close();
