import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const home=await mkdtemp(join(tmpdir(),'bidv4-test-home-'));
try{
 const child=spawn(process.execPath,['--test','--test-concurrency=1',...(process.argv.length>2?process.argv.slice(2):['tests/*.test.mjs'])],{env:{...process.env,DSH_HOME:join(home,'harness'),DATA_DIR:join(home,'ooo-bidpliot-data')},stdio:'inherit'});
 process.exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>resolve(code??1))});
}finally{await rm(home,{recursive:true,force:true})}
