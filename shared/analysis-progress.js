export const analysisCategories = [
  {key:'basic',name:'基本信息',paths:['structure.md','requirements-submission.md']},
  {key:'requirements',name:'投标要求',paths:['requirements-business.md','requirements-qualification.md']},
  {key:'score',name:'评分标准',paths:['evaluation.md']},
  {key:'format',name:'格式要求',paths:['requirements-format.md']},
  {key:'invalid',name:'废标条款',paths:['disqualification.md']},
  {key:'extra',name:'补充说明',paths:['clarifications.md']},
];

// Count documents actually written, including identical rewrites, rather than model turns.
export function analysisProgress(files, before=null, startedAt=0) {
  const produced = new Set(files.filter(file=>file.content.trim() &&
    (!before || file.hash!==before[file.path] || file.modified_at>=startedAt))
    .map(file=>file.path));
  return analysisCategories.map(category=>({key:category.key,
    done:category.paths.filter(path=>produced.has('analysis/'+path)).length,
    total:category.paths.length}));
}
