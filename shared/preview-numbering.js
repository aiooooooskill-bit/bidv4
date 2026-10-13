/** docx-preview starts every CSS counter at start - 1. A section preview has
 * no ancestor paragraphs to increment those counters; seed only those ancestors.
 * Keep the actual level untouched so its first paragraph still increments once.
 */
export function previewAncestorCounters(firstLevels, numberings) {
    return firstLevels.flatMap(first => numberings
        .filter(n => String(n.id) === first.id && n.level < first.level)
        .map(n => `docx-num-${n.id}-${n.level} ${n.start}`)).join(' ');
}
