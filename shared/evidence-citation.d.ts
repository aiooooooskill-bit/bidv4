export interface EvidenceReference {source:string|null;start:number;end:number;citation:string}
export interface EvidenceResolution {references:EvidenceReference[];source:string|null}
export function resolveEvidenceCitation(text:string,priorSource:string|null,sourceNames:string[]):EvidenceResolution;
export function evidenceCitationSpans(text:string,sourceNames:string[]):Array<{start:number;end:number}>;
export function evidenceSourceNames(work:Array<{path:string}>):string[];
export function locateEvidenceReference(citation:string,work:Array<{path:string}>):EvidenceReference&{path:string};
