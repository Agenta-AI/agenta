// docx-preview starts a new page only at an explicit break, so one rendered section can run
// several pages long. These turn section heights into page numbers.

/** How many pages a section spans; `pageHeight` is its paper height (0 when reflowed). */
export function sectionPageCount(height: number, pageHeight: number): number {
    if (!(pageHeight > 0) || !(height > 0)) return 1
    // A rounding hair over one page is still one page.
    return Math.max(1, Math.ceil(height / pageHeight - 0.01))
}

/** The page under `line` (viewport y), given each section's box and page count. */
export function pageAtLine(
    sections: {top: number; height: number; pages: number}[],
    line: number,
): number {
    let index = 0
    let before = 0
    for (const {top, height, pages} of sections) {
        if (top <= line) {
            const within = height > 0 ? Math.floor(((line - top) / height) * pages) : 0
            index = before + Math.min(Math.max(within, 0), pages - 1)
        }
        before += pages
    }
    return index
}
