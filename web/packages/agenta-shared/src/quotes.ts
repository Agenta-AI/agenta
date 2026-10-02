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
    /** The drive mount the file lives in; two mounts can hold the same relative path. */
    mountId?: string
    /** 1-based, inclusive. Absent when the excerpt could not be located in the source. */
    startLine?: number
    endLine?: number
}

export type QuoteSource = MessageQuoteSource | FileQuoteSource

export interface Quote {
    id: string
    /** The excerpt itself, as the user selected it, line breaks kept (see `tidyQuoteText`). */
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

/** Collapse whitespace runs and trim; both sides of a match use it. */
export const normalizeQuoteText = (text: string): string => text.replace(/\s+/g, " ").trim()

/**
 * Tidy a selection for storage without flattening it: code, YAML, tables and lists must reach
 * the agent line by line. Trailing whitespace per line goes, runs of blank lines fold to one,
 * leading and trailing blank lines go, indentation stays.
 */
export const tidyQuoteText = (text: string): string => {
    const lines = text
        .replace(/\r\n?/g, "\n")
        .replace(/\u00a0/g, " ")
        .split("\n")
        .map((line) => line.replace(/\s+$/, ""))
    const kept: string[] = []
    for (const line of lines) {
        if (!line && (kept.length === 0 || !kept[kept.length - 1])) continue
        kept.push(line)
    }
    while (kept.length > 0 && !kept[kept.length - 1]) kept.pop()
    return kept.join("\n")
}

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

/** A whitespace-collapsed view of `source`, mapped back to original indices for line numbers. */
const collapseWithIndex = (source: string): {text: string; map: number[]} => {
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

/** Drop every whitespace character; what is left survives any rendering of line breaks. */
export const stripQuoteWhitespace = (text: string): string => text.replace(/\s+/g, "")

/** `stripQuoteWhitespace(source)`, mapped back to original indices for line numbers. */
const stripWithIndex = (source: string): {text: string; map: number[]} => {
    const out: string[] = []
    const map: number[] = []
    for (let i = 0; i < source.length; i++) {
        if (/\s/.test(source[i])) continue
        out.push(source[i])
        map.push(i)
    }
    return {text: out.join(""), map}
}

const lineAt = (source: string, index: number): number => {
    let line = 1
    for (let i = 0; i < index && i < source.length; i++) if (source[i] === "\n") line++
    return line
}

const locationAt = (source: string, start: number, end: number): QuoteLocation => ({
    index: start,
    startLine: lineAt(source, start),
    endLine: lineAt(source, end),
})

/** Every whitespace-normalised occurrence of `selected` in `source`, in document order. */
export const findAllInSource = (source: string, selected: string): QuoteLocation[] => {
    if (!source || !selected) return []
    const needle = normalizeQuoteText(selected)
    if (!needle) return []
    const {text, map} = collapseWithIndex(source)
    const hits: QuoteLocation[] = []
    for (let hit = text.indexOf(needle); hit !== -1; hit = text.indexOf(needle, hit + 1)) {
        hits.push(locationAt(source, map[hit], map[hit + needle.length - 1]))
    }
    return hits
}

/** The single occurrence of `selected` in `source`; null when absent or repeated. */
export const findInSource = (source: string, selected: string): QuoteLocation | null => {
    const hits = findAllInSource(source, selected)
    return hits.length === 1 ? hits[0] : null
}

/**
 * Where the selection sat in the rendered body: the text before it and the whole body. Only
 * non-whitespace characters count, so a `<br>` line break and a newline read the same.
 */
export interface RenderedSelection {
    before: string
    rendered: string
}

/**
 * Locate the excerpt the user actually selected. When the rendered body is the source (code,
 * plain text, an editor, JSON whose pretty print only moved whitespace), the selection's offset
 * picks the occurrence, so a repeated line resolves to the copy the user selected. Otherwise
 * (rendered markdown) only an unambiguous match is trusted; a repeated or reformatted excerpt
 * gets no line range rather than a guessed one.
 */
export const locateQuote = (
    source: string,
    selected: string,
    at?: RenderedSelection,
): QuoteLocation | null => {
    if (!source || !selected) return null
    if (at) {
        const needle = stripQuoteWhitespace(selected)
        const rendered = stripQuoteWhitespace(at.rendered)
        const start = stripQuoteWhitespace(at.before).length
        if (needle) {
            const {text, map} = stripWithIndex(source)
            if (text === rendered && text.startsWith(needle, start)) {
                return locationAt(source, map[start], map[start + needle.length - 1])
            }
        }
    }
    return findInSource(source, selected)
}

/**
 * Re-find a located quote after its file changed: the occurrence nearest its old start line.
 * Whitespace-blind like `locateQuote`, so a quote taken from pretty-printed JSON still finds
 * its raw text. Null when the file no longer holds the excerpt.
 */
export const relocateQuote = (
    source: string,
    selected: string,
    previousStartLine: number,
): QuoteLocation | null => {
    const needle = stripQuoteWhitespace(selected)
    if (!source || !needle) return null
    const {text, map} = stripWithIndex(source)
    const hits: QuoteLocation[] = []
    for (let hit = text.indexOf(needle); hit !== -1; hit = text.indexOf(needle, hit + 1)) {
        hits.push(locationAt(source, map[hit], map[hit + needle.length - 1]))
    }
    if (hits.length === 0) return null
    return hits.reduce((best, hit) =>
        Math.abs(hit.startLine - previousStartLine) < Math.abs(best.startLine - previousStartLine)
            ? hit
            : best,
    )
}

/**
 * What changes on a file quote once its file's text moves on: the recomputed line range, or
 * `stale` when the excerpt is gone. A quote that was never located has no range to keep fresh
 * and is never flagged. Null when nothing changes.
 */
export const refreshFileQuote = (quote: Quote, source: string): Partial<Quote> | null => {
    if (quote.source.kind !== "file" || !quote.source.startLine) return null
    const hit = relocateQuote(source, quote.text, quote.source.startLine)
    if (!hit) return quote.stale ? null : {stale: true}
    if (
        !quote.stale &&
        hit.startLine === quote.source.startLine &&
        hit.endLine === quote.source.endLine
    )
        return null
    return {
        stale: false,
        source: {...quote.source, startLine: hit.startLine, endLine: hit.endLine},
    }
}

/** "L34–L36", "L34", or "" when the excerpt was never located. */
export const formatLineRange = (start?: number, end?: number): string => {
    if (!start) return ""
    if (!end || end === start) return `L${start}`
    return `L${start}–L${end}`
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/

/** Close a code fence the selection (or the cap) cut open, so it cannot swallow what follows. */
const closeOpenFence = (text: string): string => {
    let open: string | null = null
    for (const line of text.split("\n")) {
        const fence = FENCE.exec(line)?.[1]
        if (!fence) continue
        if (!open) open = fence
        else if (fence[0] === open[0] && fence.length >= open.length && line.trim() === fence)
            open = null
    }
    return open ? `${text}\n${open}` : text
}

/** Cap one excerpt for the wire, marking the elision so the model knows it is reading a middle. */
const capExcerpt = (text: string): string => {
    if (text.length <= QUOTE_EXCERPT_CAP) return closeOpenFence(text)
    return `${closeOpenFence(text.slice(0, QUOTE_EXCERPT_CAP).trimEnd())}\n… (excerpt truncated)`
}

/** Staged quotes as markdown blockquotes ahead of the message text. */
export const quotesToMarkdown = (quotes: Quote[], text = ""): string => {
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
        // Every line, blank ones included, stays inside the blockquote.
        const body = capExcerpt(quote.text)
            .split("\n")
            .map((line) => (line ? `> ${line}` : ">"))
            .join("\n")
        const note = quote.note.trim()
        // Two trailing spaces: a hard break between the origin line and the excerpt.
        return [`> ${head}  `, body, note ? `\n${note}` : ""].filter(Boolean).join("\n")
    })
    const trimmed = text.trim()
    return trimmed ? `${blocks.join("\n\n")}\n\n${trimmed}` : blocks.join("\n\n")
}
