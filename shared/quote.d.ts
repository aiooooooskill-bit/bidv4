/** Shared by source verification and the rendered-document search. */
export declare function normalizeQuote(s: string): string;
export interface QuoteRange {
    start: number;
    end: number;
    segmentIndexes: number[];
}
/** Match the complete quote across adjacent text segments, preserving every occurrence. */
export declare function quoteRanges(segments: string[], quote: string): QuoteRange[];
