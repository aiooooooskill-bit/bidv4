export const analysisCategories: Array<{key:string;name:string;paths:string[]}>;
export interface AnalysisProgress {key:string;done:number;total:number}
export function analysisProgress(files:Array<{path:string;content:string;hash:string;modified_at:number}>,before?:Record<string,string>|null,startedAt?:number):AnalysisProgress[];
