const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const assert=require('node:assert/strict');
app.setPath('userData',path.join(app.getPath('temp'),'jarvis-visual-check'));
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
  const output=path.resolve(__dirname,'../runtime/visual-check'); fs.mkdirSync(output,{recursive:true});
  const errors=[],measurements=[];
  const server=require('node:http').createServer((req,res)=>{const url=new URL(req.url,'http://localhost');const file=path.join(__dirname,'../dist',url.pathname==='/'?'index.html':url.pathname);if(!fs.existsSync(file)){res.writeHead(404);res.end();return}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html');res.end(fs.readFileSync(file));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  ipcMain.handle('jarvis:state',()=>({status:'ready',detail:'',voiceReady:false,paused:true,busy:false,transcript:'',reply:'',requests:[],settings:{cwd:'',codexPath:''}}));
  ipcMain.handle('jarvis:action',()=>{});
  for(const variant of ['reference','windows']) {
    const win=new BrowserWindow({width:1440,height:900,frame:false,useContentSize:true,show:false,backgroundColor:'#061018',webPreferences:{preload:variant==='windows'?path.resolve(__dirname,'../dist-electron/preload.cjs'):undefined,contextIsolation:true,sandbox:true,backgroundThrottling:false,offscreen:true}});
    win.webContents.on('console-message',event=>{if(event.level==='error'){errors.push({variant,message:event.message});console.log(JSON.stringify({variant,error:event.message}));}});
    if(variant==='reference')await win.loadURL(`http://127.0.0.1:${server.address().port}/?preview=ready`);
    else await win.loadFile(path.resolve(__dirname,'../dist-windows/windows.html'));
    await new Promise(r=>setTimeout(r,800));
    const info=await win.webContents.executeJavaScript(`(()=>{const img=document.querySelector('#jarvis-character'),rig=document.querySelector('.character-rig'),shard=document.querySelector('.armor-shard'),c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);let readable;try{ctx.getImageData(0,0,1,1);readable=true}catch(e){readable=String(e)}return {image:img.src,naturalWidth:img.naturalWidth,readable,rig:JSON.stringify(rig.getBoundingClientRect()),imageBounds:JSON.stringify(img.getBoundingClientRect()),shardImage:getComputedStyle(shard).backgroundImage,reduceMotion:matchMedia('(prefers-reduced-motion:reduce)').matches}})()`);
    console.log(JSON.stringify({variant,info}));
    measurements.push(await win.webContents.executeJavaScript(`(()=>{const rig=getComputedStyle(document.querySelector('.character-rig')),aura=getComputedStyle(document.querySelector('.character-aura'));return {width:rig.width,height:rig.height,top:rig.top,left:rig.left,auraTop:aura.top,auraRight:aura.right,shards:document.querySelectorAll('.armor-shard').length}})()`));
    if(variant==='reference') await win.webContents.executeJavaScript(`document.querySelector('#mic')?.click();`);
    else win.webContents.send('jarvis:signal','wake');
    // Exercise each renderer's real activation path; do not manually add animation classes.
    const started=Date.now();
    const frames=[];
    for(const [index,delay] of [[0,300],[1,900],[2,1100],[3,variant==='reference'?1600:2400]]) {
      await new Promise(r=>setTimeout(r,delay));
      fs.writeFileSync(path.join(output,`${variant}-${index}.png`),(await win.webContents.capturePage()).toPNG());
      console.log(JSON.stringify({variant,index,animations:await win.webContents.executeJavaScript(`document.getAnimations().filter(a=>['minimal-materialize','assembly-core-flash'].includes(a.animationName)).map(a=>({name:a.animationName,time:a.currentTime,state:a.playState}))`)}));
      frames.push(await win.webContents.executeJavaScript(`(()=>{const c=document.querySelector('#particle-field'),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let lit=0;for(let i=3;i<p.length;i+=4)if(p[i]>12)lit++;return {lit,materialize:document.getAnimations().find(a=>['minimal-materialize','windows-materialize'].includes(a.animationName))?.effect.getTiming().duration,shards:document.getAnimations().filter(a=>['armor-shard-assemble','windows-shard-assemble'].includes(a.animationName)).length}})()`));
    }
    assert.ok(frames.slice(0,3).every(f=>f.lit>100),'actual wake must draw visible canvas particles');if(variant==='windows')assert.equal(frames.at(-1).lit,0,'compact desktop particles must fade completely');
    assert.ok(frames.every(f=>f.materialize===(variant==='reference'?3200:4200)&&f.shards===19),'all original assembly layers must remain active');
    win.destroy();
  }
  console.log(JSON.stringify({errors,measurements}));server.close();
  try {assert.deepEqual(errors,[]);assert.ok(parseFloat(measurements[1].height)<=500,'Windows avatar must use compact geometry');assert.equal(measurements[1].shards,measurements[0].shards);app.exit(0)}catch(error){console.error(error);app.exit(1)}
}).catch(e=>{console.error(e);app.exit(1)});
