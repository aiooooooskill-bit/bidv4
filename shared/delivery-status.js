// The action receipt describes a past attempt; current files describe delivery.
export function deliveryReady(flow) {
  return !!flow.directory && !!flow.body_sections.length &&
    flow.body_sections.every(s=>s.status==='ready' && flow.body_files.includes(s.path)) &&
    flow.build_preparation.guide==='ready' && flow.build_preparation.promises==='ready' &&
    !!flow.volume_states.length && flow.volume_states.every(v=>v.status==='ready');
}

export const actionNames={analyse:'招标解读',outline:'投标目录',guide:'写作指引',promises:'关键事实与承诺',body:'章节生成',revise:'章节修改',build:'制作与合册',review:'标书审查'};

export function actionSatisfied(flow, action) {
  if(action.kind==='build')return deliveryReady(flow);
  const after=modified=>Number.isFinite(action.created_at) && modified>=action.created_at;
  if(['guide','promises'].includes(action.kind)) {
    const path=action.kind==='guide'?'body/写作指引.md':'body/关键事实与承诺.md';
    return flow.build_preparation[action.kind]==='ready' && flow.files.some(f=>f.path===path && after(f.modified_at));
  }
  if(['body','revise'].includes(action.kind)) {
    return !!action.sections?.length && ['guide','promises'].every(s=>flow.build_preparation[s]==='ready') && action.sections.every(s=>{
      const current=flow.body_sections.find(b=>b.volume===s.volume && b.title===s.title);
      return current?.status==='ready' && flow.body_files.includes(current.path) && after(current.modified_at);
    });
  }
  if(action.kind==='review')return flow.review?.status==='reviewed' && !!flow.review.report && after(Date.parse(flow.review.report.created_at));
  return false;
}
