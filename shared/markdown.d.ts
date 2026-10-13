import type {Root,Nodes} from 'mdast';
import type {PluggableList} from 'unified';
export const markdownPlugins:PluggableList;
export function parseMarkdown(content:string):Root;
export function markdownText(node:Nodes):string;
export function markdownSourceMap(node:Nodes,content:string):{text:string;positions:Array<{start:number;end:number}>};
