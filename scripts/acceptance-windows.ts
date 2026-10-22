import { CodexRuntime, resolveCodexExecutable } from '../electron/codex-runtime.ts';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
const cwd=path.resolve('runtime/acceptance');mkdirSync(cwd,{recursive:true});
const file=path.join(cwd,'jarvis-acceptance.txt');writeFileSync(file,'before','utf8');
const runtime=new CodexRuntime({executablePath:resolveCodexExecutable()});
async function turn(text:string){
 let reply=''; let finish:()=>void;let fail:(e:Error)=>void;
 const done=new Promise<void>((resolve,reject)=>{finish=resolve;fail=reject;});
 const timer=setTimeout(()=>fail(new Error('acceptance turn timed out')),90000);
 const unsub=runtime.onEvent(e=>{
   if(e.id!==undefined&&e.method){console.log('server request',e.method);runtime.respond(e.id,false);}
   if(e.method==='item/completed'&&e.params?.item?.type==='agentMessage')reply=e.params.item.text;
   if(e.method==='turn/completed') e.params?.turn?.status==='failed'?fail(new Error(e.params.turn.error?.message??'turn failed')):finish();
 });
 try{await runtime.sendText(text);await done;console.log(reply);return reply;}finally{unsub();clearTimeout(timer);}
}
try{
 await runtime.start({cwd});
 await turn(`请把文件 ${file} 的内容改成 after。`);
 if(readFileSync(file,'utf8')!=='before')throw new Error('file changed before confirmation');
 console.log('PASS: fixture unchanged before confirmation');
 await turn('确认，仅将刚才指定的 jarvis-acceptance.txt 内容改为 after，其他文件不要修改。');
 if(readFileSync(file,'utf8').trim()!=='after')throw new Error('confirmed fixture was not changed');
 console.log('PASS: fixture changed after explicit confirmation');
 if(process.argv.includes('--browser')) await turn('请使用本机 PowerShell 打开默认浏览器访问 https://www.bing.com/search?q=Windows+11 ，不要用在线搜索工具代替打开本机浏览器。不修改文件或系统设置，不登录或发送信息。完成后简短回复实际结果。');
}finally{await runtime.shutdown();}
