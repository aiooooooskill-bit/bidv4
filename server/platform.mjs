import {posix,win32} from 'node:path';

export function pythonExecutable(directory,platform=process.platform){
 return platform==='win32'?win32.join(directory,'business','python','.venv','Scripts','python.exe'):posix.join(directory,'business/python/.venv/bin/python');
}
