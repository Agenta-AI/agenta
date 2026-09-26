// Quote-to-reply's pure half: normalise, locate in source, serialise. No React, no DOM.

export interface MessageQuoteSource {
    kind: "message"
    /** The assistant message the excerpt was selected in. */
    messageId: string
}

export interface FileQuoteSource {
    kind: "file"
    /** Mount-relative path — what reads the bytes back. */
    path: string
    /** Folded path as shown to the user (`agent-files/…`). */
    displayPath: string
    fileName: string
    /** 1-based, inclusive. Absent when the excerpt could not be located in the source. */
    startLine?: number
    endLine?: number
}

export type QuoteSource = MessageQuoteSource | FileQuoteSource

export interface Quote {
    id: string
    /** The excerpt itself, as the user selected it (whitespace already tidied). */
    text: string
    /** What the user wants changed about this part. Empty until the note box is submitted. */
    note: string
    /** Staged onto the composer (a chip), as opposed to a draft the note box still owns. */
    staged: boolean
    /** The file no longer contains the excerpt. */
    stale: boolean
    source: QuoteSource
}

/** Excerpts go straight into the prompt, so an unbounded drag-select is a token-cost regression. */
export const QUOTE_EXCERPT_CAP = 2000
/** What a chip or a quote card shows before it truncates. */
export const QUOTE_DISPLAY_CAP = 120

/** Collapse whitespace runs and trim; both sides of a match use it. */ export const normalizeQuoteText =
    (text: string): string => text.replace(/\s+/g, " ").trim()

/** Truncate for display, on a word boundary where one is close enough to the cut. */
export const truncateQuoteText = (text: string, cap = QUOTE_DISPLAY_CAP): string => {
    const flat = normalizeQuoteText(text)
    if (flat.length <= cap) return flat
    const cut = flat.slice(0, cap)
    const lastSpace = cut.lastIndexOf(" ")
    return `${(lastSpace > cap * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

export interface QuoteLocation {
    /** Character offset of the match in the ORIGINAL source. */
    index: number
    /** 1-based, inclusive. */
    startLine: number
    endLine: number
}

/** A whitespace-collapsed view of `source`, mapped back to original indices for line numbers. */ const collapseWithIndex =
    (source: string): {text: string; map: number[]} => {
        const out: string[] = []
        const map: number[] = []
        let pendingSpace = false
        for (let i = 0; i < source.length; i++) {
            const ch = source[i]
            if (/\s/.test(ch)) {
                pendingSpace = out.length > 0
                continue
            }
            if (pendingSpace) {
                out.push(" ")
                map.push(i)
                pendingSpace = false
            }
            out.push(ch)
            map.push(i)
        }
        return {text: out.join(""), map}
    }

const lineAt = (source: string, index: number): number => {
    let line = 1
    for (let i = 0; i < index && i < source.length; i++) if (source[i] === "\n") line++
    return line
}

/** Locate `selected` in `source`: exact first, then whitespace-normalised; null if absent. */ export const findInSource =
    (source: string, selected: string): QuoteLocation | null => {
        if (!source || !selected) return null

        const exact = source.indexOf(selected)
        if (exact !== -1) {
            return {
                index: exact,
                startLine: lineAt(source, exact),
                endLine: lineAt(source, exact + selected.length - 1),
            }
        }

        const needle = normalizeQuoteText(selected)
        if (!needle) return null
        const {text, map} = collapseWithIndex(source)
        const hit = text.indexOf(needle)
        if (hit === -1) return null
        const start = map[hit]
        const end = map[Math.min(hit + needle.length - 1, map.length - 1)]
        return {index: start, startLine: lineAt(source, start), endLine: lineAt(source, end)}
    }

/** "L34–L36", "L34", or "" when the excerpt was never located. */
export const formatLineRange = (start?: number, end?: number): string => {
    if (!start) return ""
    if (!end || end === start) return `L${start}`
    return `L${start}–L${end}`
}

/** Cap one excerpt for the wire, marking the elision so the model knows it is reading a middle. */
const capExcerpt = (text: string): string => {
    if (text.length <= QUOTE_EXCERPT_CAP) return text
    return `${text.slice(0, QUOTE_EXCERPT_CAP).trimEnd()}\n… (excerpt truncated)`
}

/** Staged quotes as markdown blockquotes ahead of the message text. */ export const quotesToMarkdown =
    (quotes: Quote[], text = ""): string => {
        if (quotes.length === 0) return text
        const blocks = quotes.map((quote) => {
            const head =
                quote.source.kind === "file"
                    ? // The drive path, not the bare name: it is what the agent opens the file by.
                      `**\`${quote.source.displayPath || quote.source.path}\`**${
                          formatLineRange(quote.source.startLine, quote.source.endLine)
                              ? ` (${formatLineRange(quote.source.startLine, quote.source.endLine)})`
                              : ""
                      }`
                    : "**Agent reply**"
            const body = capExcerpt(quote.text)
                .split("\n")
                .map((line) => `> ${line}`)
                .join("\n")
            const note = quote.note.trim()
            // Two trailing spaces: a hard break between the origin line and the excerpt.
            return [`> ${head}  `, body, note ? `\n${note}` : ""].filter(Boolean).join("\n")
        })
        const trimmed = text.trim()
        return trimmed ? `${blocks.join("\n\n")}\n\n${trimmed}` : blocks.join("\n\n")
    }
