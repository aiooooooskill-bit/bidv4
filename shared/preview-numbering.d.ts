/** docx-preview starts every CSS counter at start - 1. A section preview has
 * no ancestor paragraphs to increment those counters; seed only those ancestors.
 * Keep the actual level untouched so its first paragraph still increments once.
 */
export declare function previewAncestorCounters(firstLevels: {
    id: string;
    level: number;
}[], numberings: {
    id: string;
    level: number;
    start: number;
}[]): string;
