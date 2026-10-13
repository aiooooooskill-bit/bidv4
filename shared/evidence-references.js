// 来源编号是文档关联协议；补零与组装目录的 _norm_id 保持一致。
export const evidenceIds=/\b(?:MAND|REQ|TPL|SCORE|CLAR)-\d+\b/gi;
export function normalizeEvidenceId(id){
 return id.toUpperCase().replace(/\d+$/,digits=>digits.padStart(2,'0'));
}
export function evidenceReferenceIds(text){
 return [...new Set((text.match(evidenceIds)??[]).map(normalizeEvidenceId))];
}
export function isEvidenceReferenceList(text){
 return evidenceReferenceIds(text).length>0&&text.replace(evidenceIds,'').replace(/[\s、,，;；/（）()\[\]【】]/g,'')==='';
}
export function isCitationColumn(header){
 return /^(出处|来源|原文出处(?:线索)?|原文依据)(?:\s*[（(][^）)]*[）)])?$/.test(header.trim());
}
