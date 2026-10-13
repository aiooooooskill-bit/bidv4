import {analysisCategories,type AnalysisProgress as ColumnProgress} from '../../shared/analysis-progress.js';

export function AnalysisProgress({progress}:{progress:ColumnProgress[]}) {
 return <section className="bp-analysis-progress" aria-label="解读栏目进度">
  {analysisCategories.map(category=>{
   const column=progress.find(p=>p.key===category.key)!;
   return <div className="bp-job-line" key={category.key}>
    <span className="bp-job-label">{category.name}</span>
    <progress aria-label={category.name+'进度'} value={column.done} max={column.total}/>
    <small>{column.done}/{column.total}</small>
   </div>;
  })}
 </section>;
}
