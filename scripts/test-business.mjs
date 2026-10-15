import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {pythonExecutable} from '../server/platform.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const child=spawn(pythonExecutable(root),['-X','utf8','-m','pytest','business/python/tests','-q',...process.argv.slice(2)],{cwd:root,stdio:'inherit'});
child.on('error',error=>{console.error(error.message);process.exitCode=1});
child.on('close',code=>{process.exitCode=code??1});
