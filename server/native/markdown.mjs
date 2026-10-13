import {parseMarkdown} from '../../shared/markdown.js';

/** JSON 响应可以是原文或单个代码块；代码围栏由 Markdown AST 识别。 */
export function jsonResponse(content){
 const nodes=parseMarkdown(content).children;
 const text=nodes.length===1&&nodes[0].type==='code'?nodes[0].value:content;
 return JSON.parse(text);
}
