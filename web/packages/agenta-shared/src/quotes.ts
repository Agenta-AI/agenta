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

/** A picked element in a rendered HTML app, DOCX page or PPTX slide. */
/** A Word body block, 1-based like python-docx `document.paragraphs` / `document.tables`. */
export interface WordBlock {
    kind: "paragraph" | "table"
    index: number
}

export interface ElementAnchor {
    type: "element"
    format: "html" | "document" | "presentation"
    /** Search hint inside the rendered document. */
    selector: string
    tag: string
    /** DOCX page (Pages layout only) or PPTX slide, 1-based. */
    page?: number
    /** DOCX only: the Word block, the same in both layouts. */
    block?: WordBlock
    /** HTML only: the element's opening tag with its attributes. */
    openTag?: string
    /** 0..1 inside the element; where the pin sits. */
    point: {x: number; y: number}
}

/** A cell range in a spreadsheet preview, in the sheet's own A1 coordinates. */
export interface CellAnchor {
    type: "cells"
    /** Absent for a CSV, which has one unnamed sheet. */
    sheet?: string
    range: string
}

export type PreviewAnchor = ElementAnchor | CellAnchor

/** A comment on a location in a rendered file preview. */
export interface PreviewQuoteSource {
    kind: "preview"
    path: string
    displayPath: string
    fileName: string
    mountId?: string
    anchor: PreviewAnchor
}

export type QuoteSource = MessageQuoteSource | FileQuoteSource | PreviewQuoteSource

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

export type PreviewQuote = Quote & {source: PreviewQuoteSource}

export const isPreviewQuote = (quote: Quote): quote is PreviewQuote =>
    quote.source.kind === "preview"

/** A staged comment's number on its document, in store order: the label of its pin and chip. */
export const previewCommentNumber = (quotes: Quote[], quote: Quote): number | null => {
    if (!quote.staged || !isPreviewQuote(quote)) return null
    const {path, mountId} = quote.source
    let number = 0
    for (const held of quotes) {
        if (!held.staged || !isPreviewQuote(held)) continue
        if (held.source.path !== path || held.source.mountId !== mountId) continue
        number++
        if (held.id === quote.id) return number
    }
    return null
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

/** A CommonMark code span for any text: fence one backtick longer than the longest run inside. */
export const inlineCode = (text: string): string => {
    const flat = text.replace(/\r\n?|\n/g, " ")
    const longest = (flat.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0)
    const fence = "`".repeat(longest + 1)
    const pad =
        flat.startsWith("`") ||
        flat.endsWith("`") ||
        (flat.startsWith(" ") && flat.endsWith(" ") && flat.trim() !== "")
    return pad ? `${fence} ${flat} ${fence}` : `${fence}${flat}${fence}`
}

/** The location in a preview quote's head: what the agent searches the file for. */
export const formatPreviewLocation = (anchor: PreviewAnchor): string => {
    if (anchor.type === "cells")
        return anchor.sheet === undefined
            ? `cells ${anchor.range}`
            : `sheet ${inlineCode(anchor.sheet)}, ${anchor.range}`
    // A Word block is what python-docx indexes; the rendered page is only a hint.
    if (anchor.block) return `${anchor.block.kind} ${anchor.block.index}`
    if (anchor.format === "document" && anchor.page) return `page ${anchor.page}`
    if (anchor.format === "presentation" && anchor.page) return `slide ${anchor.page}`
    return `element ${inlineCode(anchor.selector)}`
}

/** The short location a composer chip shows. */
export const formatPreviewChipLocation = (anchor: PreviewAnchor): string => {
    if (anchor.type === "cells")
        return anchor.sheet === undefined ? anchor.range : `${anchor.sheet}!${anchor.range}`
    if (anchor.block?.kind === "paragraph") return `¶ ${anchor.block.index}`
    if (anchor.block) return `table ${anchor.block.index}`
    if (anchor.format === "document" && anchor.page) return `p. ${anchor.page}`
    if (anchor.format === "presentation" && anchor.page) return `slide ${anchor.page}`
    return `<${anchor.tag}>`
}

const tableCell = (value: string): string =>
    value
        .replace(/\r\n?|\n/g, " ")
        .replace(/[\\|]/g, "\\$&")
        .trim()

/** Cells as a markdown pipe table; a null header makes the first row the header. */
export const cellsToTable = (header: string[] | null, rows: string[][]): string => {
    const head = header ?? rows[0]
    const body = header ? rows : rows.slice(1)
    if (!head) return ""
    const width = Math.max(head.length, ...body.map((row) => row.length), 1)
    const line = (row: string[]) =>
        `| ${Array.from({length: width}, (_, i) => tableCell(row[i] ?? "")).join(" | ")} |`
    return [line(head), `|${" --- |".repeat(width)}`, ...body.map(line)].join("\n")
}

const tableRow = (line: string): string[] =>
    line
        .replace(/^\|\s?|\s?\|$/g, "")
        .split(" | ")
        .map((cell) => cell.replace(/\\([\\|])/g, "$1").trim())

/** A quote's text for people: a cell quote reads "Plan: 80", not its Markdown table. */
export const readableQuoteText = (quote: Quote): string => {
    if (!isPreviewQuote(quote) || quote.source.anchor.type !== "cells") return quote.text
    const [head, , ...body] = quote.text.split("\n").map(tableRow)
    if (!head) return quote.text
    if (body.length === 1)
        return head
            .map((name, i) => {
                const value = body[0][i] ?? ""
                // A column past the sheet's header row has no name; the value stands alone.
                return name ? `${name}: ${value}` : value
            })
            .join(", ")
    return [head, ...body].map((row) => row.join(" · ")).join(" / ")
}

const quoteHead = (source: QuoteSource): string => {
    // The drive path, not the bare name: it is what the agent opens the file by.
    if (source.kind === "preview")
        return `**\`${source.displayPath || source.path}\`** (${formatPreviewLocation(source.anchor)})`
    if (source.kind === "file") {
        const range = formatLineRange(source.startLine, source.endLine)
        return `**\`${source.displayPath || source.path}\`**${range ? ` (${range})` : ""}`
    }
    return "**Agent reply**"
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
        // Every line, blank ones included, stays inside the blockquote.
        const lines = quote.text ? capExcerpt(quote.text).split("\n") : []
        const {source} = quote
        if (source.kind === "preview" && source.anchor.type === "element" && source.anchor.openTag)
            lines.push(inlineCode(source.anchor.openTag))
        const body = (lines.length ? lines : [""])
            .map((line) => (line ? `> ${line}` : ">"))
            .join("\n")
        const note = quote.note.trim()
        // Two trailing spaces: a hard break between the origin line and the excerpt.
        return [`> ${quoteHead(source)}  `, body, note ? `\n${note}` : ""]
            .filter(Boolean)
            .join("\n")
    })
    const trimmed = text.trim()
    return trimmed ? `${blocks.join("\n\n")}\n\n${trimmed}` : blocks.join("\n\n")
}

/** One quote read back out of `quotesToMarkdown` output. */
export interface QuotedExcerpt {
    /** The quote's origin: a drive path, or "Agent reply". */
    origin: string
    text: string
}

// The whole origin line `quotesToMarkdown` writes, so a hand-written blockquote is not taken for one.
// A preview location's greedy `.+` runs to the line's last `)`, so brackets inside it are safe.
const QUOTE_HEAD =
    /^> \*\*(?:`([^`]+)`|(Agent reply))\*\*(?: \((?:L\d+(?:–L\d+)?|(?:element|page|slide|sheet|cells|paragraph|table) .+)\))? *$/

/** A sent message's leading quotes and the user's own words; inverts `quotesToMarkdown`. */
export const splitQuotedMessage = (markdown: string): {quotes: QuotedExcerpt[]; text: string} => {
    if (!QUOTE_HEAD.test(markdown.split("\n", 1)[0])) return {quotes: [], text: markdown}
    const quotes: QuotedExcerpt[] = []
    const rest: string[] = []
    let current: string[] | null = null
    let blockStart = true
    for (const line of markdown.split("\n")) {
        // Inside an excerpt, a head-shaped line is excerpt content.
        if (current && (line === ">" || line.startsWith("> "))) {
            current.push(line.slice(2))
            quotes[quotes.length - 1].text = current.join("\n")
            continue
        }
        const head = blockStart ? QUOTE_HEAD.exec(line) : null
        if (head) {
            current = []
            quotes.push({origin: head[1] ?? head[2], text: ""})
        } else {
            current = null
            rest.push(line)
        }
        blockStart = line === ""
    }
    return {
        quotes,
        text: rest
            .join("\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim(),
    }
}
