import {build} from 'esbuild';
import {mkdtemp,writeFile,readFile,cp,rm,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {assertStopped} from '../server/installation.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
await assertStopped(root);
const out=await mkdtemp(join(root,'.dist-build-'));
try{
const result=await build({absWorkingDir:root,tsconfig:join(root,'tsconfig.json'),entryPoints:['src/plugin.tsx'],bundle:true,format:'cjs',platform:'browser',target:'es2022',jsx:'automatic',write:false,external:['react','react-dom','react/jsx-runtime','@deepseek-ai/*'],plugins:[{name:'css-text',setup(b){b.onLoad({filter:/\.css$/},async({path})=>({loader:'js',contents:`export default ${JSON.stringify(await readFile(path,'utf8'))};`}))}}]});
await writeFile(join(out,'client.js'),`window.__ModuleLoader__.load({id:'ooo-bidpliot',factory:(require)=>{var module={exports:{}};var exports=module.exports;Object.defineProperty(exports,Symbol.toStringTag,{value:'Module'});\n${result.outputFiles[0].text}\nreturn module.exports;}});`);
await build({absWorkingDir:root,tsconfig:join(root,'tsconfig.json'),entryPoints:['src/lib/figureRenderer.ts'],outdir:join(out,'renderer'),bundle:true,format:'esm',splitting:true,platform:'browser',target:'es2022',minify:true,logLevel:'silent'});
const pdf=join(root,'node_modules/pdfjs-dist');
await cp(join(pdf,'cmaps'),join(out,'pdfjs/cmaps'),{recursive:true});
await cp(join(pdf,'standard_fonts'),join(out,'pdfjs/standard_fonts'),{recursive:true});
await cp(join(pdf,'wasm'),join(out,'pdfjs/wasm'),{recursive:true});
await cp(join(pdf,'build/pdf.worker.min.mjs'),join(out,'pdfjs/pdf.worker.min.mjs'));
await assertStopped(root);
const previous=join(root,'.dist-previous-'+Date.now());let moved=false;
try{await rename(join(root,'dist'),previous);moved=true}catch(error){if(error.code!=='ENOENT')throw error}
try{await rename(out,join(root,'dist'))}catch(error){if(moved)await rename(previous,join(root,'dist'));throw error}
if(moved)await rm(previous,{recursive:true,force:true});
console.log('正式插件和 PDF 本地资源已构建');
}finally{await rm(out,{recursive:true,force:true})}
