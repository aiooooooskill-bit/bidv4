import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {checkInstallation} from '../server/installation.mjs';
let directory=fileURLToPath(new URL('..',import.meta.url)),dshVersion,json=false;
const args=process.argv.slice(2);for(let index=0;index<args.length;index++){const arg=args[index];if(arg==='--json')json=true;else if(arg==='--dsh-version'){dshVersion=args[++index];if(!dshVersion)throw new Error('--dsh-version 需要版本参数')}else if(arg.startsWith('--'))throw new Error('未知参数：'+arg);else directory=arg}
const report=await checkInstallation(resolve(directory),{dshVersion});
if(json)console.log(JSON.stringify(report,null,2));else if(report.ok)console.log('ooo-bidpliot 目录检查通过（Node '+report.node+'，Python '+report.python.version+'）');else console.error(report.errors.join('\n'));
process.exitCode=report.ok?0:1;
