// Use the product's existing renderer and queue protocol in isolated headless tests.
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,appendFile} from 'node:fs/promises';
import {join,resolve,extname} from 'node:path';
import {chromium} from '/Users/ooo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const base=process.env.BID_E2E_ROOT||(await readFile('/tmp/bidv4-e2e-location','utf8')).trim(),log=join(base,'renderer-events.jsonl');
const server=createServer(async(req,res)=>{try{
 const [variant,...segments]=new URL(req.url,'http://localhost').pathname.slice(1).split('/');if(!['before','after'].includes(variant))throw new Error('Invalid variant');
 if(!segments.length||!segments[0]){res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><body></body>');return}
 const dir=join(base,variant,'dist/renderer'),path=resolve(dir,segments.join('/'));if(!path.startsWith(dir+'/'))throw new Error('Invalid asset path');
 res.setHeader('Content-Type',extname(path)==='.js'?'text/javascript':extname(path)==='.css'?'text/css':'application/octet-stream');res.end(await readFile(path));
 }catch{res.writeHead(404);res.end()}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true}),pages={};let stopping=false;
process.once('SIGTERM',()=>{stopping=true});process.once('SIGINT',()=>{stopping=true});
for(const v of ['before','after']){pages[v]=await browser.newPage({viewport:{width:1200,height:1000}});await pages[v].goto('http://127.0.0.1:'+server.address().port+'/'+v+'/')}
const {spawn}=await import('node:child_process');
async function invoke(v,operation,args={}){const root=join(base,v);return new Promise((resolve,reject)=>{const child=spawn(join(root,'business/python/.venv/bin/python'),[join(root,'business/python/runner.py')],{cwd:root,stdio:['pipe','pipe','pipe']});let out='',error='';child.stdout.on('data',b=>{out+=b});child.stderr.on('data',b=>{error+=b});child.on('error',reject);child.on('close',code=>{try{const value=JSON.parse(out);if(code||value.error)throw Error(value.error||error);resolve(value.result)}catch(e){reject(e)}});child.stdin.end(JSON.stringify({operation,args,data_root:join(root,'data')}))})}
await appendFile(log,JSON.stringify({event:'renderer-start',at:new Date().toISOString(),renderer:'existing product dist/renderer/figureRenderer.js',browser:chromium.executablePath()})+'\n');
try{while(!stopping){for(const v of ['before','after']){
 const {requests}=await invoke(v,'render_pending');for(const request of requests){let file;
 try{
  const bytes=await pages[v].evaluate(async({variant,pending})=>{const lib=await import('/'+variant+'/figureRenderer.js');const blob=pending.kind==='flow'?await lib.renderMermaidToPng(pending.mermaid):await lib.renderHtmlToPng(pending.html);return Array.from(new Uint8Array(await blob.arrayBuffer()))},{variant:v,pending:request});
  const folder=join(base,v+'-evidence/rendered-figures');await mkdir(folder,{recursive:true});file=join(folder,request.request_id+'.png');await writeFile(file,Buffer.from(bytes));
  await invoke(v,'render_fulfill',{request_id:request.request_id,file});await appendFile(log,JSON.stringify({event:'rendered',variant:v,id:request.request_id,kind:request.kind,bytes:bytes.length,at:new Date().toISOString()})+'\n');
 }catch(error){await appendFile(log,JSON.stringify({event:'render-error',variant:v,id:request.request_id,error:error.message,at:new Date().toISOString()})+'\n');await invoke(v,'render_fulfill',{request_id:request.request_id,file:''}).catch(()=>{})}
 }}await new Promise(r=>setTimeout(r,1500))}}finally{await browser.close();await new Promise(r=>server.close(r))}
