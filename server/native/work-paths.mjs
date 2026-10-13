import {posix,win32} from 'node:path';
import {BusinessError} from './business.mjs';

export function normalizeWorkPath(path){
 if(typeof path!=='string'||!path||path.includes('\0')||win32.parse(path).root)throw new BusinessError(422,'路径越界：须为 work/ 下的相对路径');
 const relative=posix.normalize(path.replaceAll('\\','/')).replace(/\/$/,'');
 if(relative==='.'||relative==='..'||relative.startsWith('../'))throw new BusinessError(422,'路径越界：须为 work/ 下的相对路径');
 return relative;
}
