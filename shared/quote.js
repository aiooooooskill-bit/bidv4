/** Shared by source verification and the rendered-document search. */
export function normalizeQuote(s) {
    return s.replace(/\s+/g, "")
        .replace(/[（）]/g, c => c === "（" ? "(" : ")")
        .replace(/：/g, ":").replace(/，/g, ",").replace(/。/g, ".");
}
/** Match the complete quote across adjacent text segments, preserving every occurrence. */
export function quoteRanges(segments, quote) {
    const needle = normalizeQuote(quote);
    if (needle.length < 2)
        return [];
    let cursor = 0;
    const parts = segments.map((text, index) => {
        const norm = normalizeQuote(text), start = cursor;
        cursor += norm.length;
        return { index, norm, start, end: cursor };
    });
    const full = parts.map(p => p.norm).join(""), matches = [];
    for (let start = full.indexOf(needle); start >= 0; start = full.indexOf(needle, start + 1)) {
        const end = start + needle.length;
        matches.push({ start, end, segmentIndexes: parts.filter(p => p.end > p.start && p.end > start && p.start < end).map(p => p.index) });
    }
    return matches;
}
