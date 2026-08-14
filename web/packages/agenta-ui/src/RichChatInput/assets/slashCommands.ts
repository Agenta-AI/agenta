/**
 * Slash-command types + matching for the chat composer's `/` palette.
 *
 * The composer is generic — a host supplies its own sections (the playground chat gives
 * `/model` and the agent's tools and skills). Kept out of the plugin file so a host
 * can import the types without pulling Lexical in.
 */
import type {ReactNode} from "react"

/**
 * What selecting an item does: drill into a picker the host owns, run a one-shot action, or type
 * text into the message. `open` and `action` behave identically here — the menu closes and the host's
 * `onSelect` runs — they differ only in what the footer promises the next keystroke will do.
 */
export type SlashCommandKind = "open" | "insert" | "action"

export interface SlashCommandItem {
    key: string
    /** Displayed and matched against, leading slash included (e.g. `/model`). */
    label: string
    description?: string
    /** Right-aligned label — the current value for a command, the type tag for a tool. */
    tail?: ReactNode
    icon?: ReactNode
    kind: SlashCommandKind
    /** `insert` items only: the text typed into the message. Defaults to `label`. */
    insertText?: string
    /** `open`/`action` items: runs after the menu closes, so the picker owns the keyboard. */
    onSelect?: () => void
}

export interface SlashCommandSection {
    key: string
    title: string
    items: SlashCommandItem[]
}

/** A command run: a `/` opening the block or following a space, plus the word being typed. */
export const COMMAND_RUN = /(^|\s)\/([^\s/]*)$/

/** The run the caret sits in, located within its text node. */
export interface CommandRun {
    /** The typed word after the `/`. */
    query: string
    /** Offset of the `/` within the text. */
    start: number
    /** False when the `/` is flush against the text start — the caller decides if that opens one. */
    afterSpace: boolean
}

/**
 * The command run ending at the caret, or null when there is none. Requiring a space (or the very
 * start) before the `/` is what keeps `and/or`, URLs, and paths from opening the menu mid-sentence.
 */
export function readCommandRun(textUpToCaret: string): CommandRun | null {
    const hit = COMMAND_RUN.exec(textUpToCaret)
    if (!hit) return null
    return {query: hit[2], start: hit.index + hit[1].length, afterSpace: hit[1] !== ""}
}

/**
 * Whether a run flush against the start of its own text node may still open the menu.
 *
 * `readCommandRun` only sees one node's text, and formatting splits a paragraph into adjacent text
 * nodes — so a bolded `/model` after a plain `hello ` starts its node while the message reads
 * `hello /model`. Starting a NODE is not starting the MESSAGE: the run qualifies when everything
 * before it in the block is empty or ends in whitespace, which is the same rule the regex applies
 * inside a single node.
 */
export const runFollowsBoundary = (textBefore: string): boolean =>
    textBefore === "" || /\s$/.test(textBefore)

/**
 * Whether two runs are the same run. Dismissal is keyed on this — on POSITION, not on the run's
 * text (a retyped `/` gives an identical query) and not on mere existence (that leaks the dismissal
 * onto the next run, so a paste after an Escape would never open the menu).
 */
export const isSameRun = (
    a: {nodeKey: string; start: number} | null,
    b: {nodeKey: string; start: number} | null,
) => !!a && !!b && a.nodeKey === b.nodeKey && a.start === b.start

/** A label split around the matched query, for the in-name match highlight. */
export interface LabelMatch {
    before: string
    match: string
    after: string
}

/**
 * Where `query` matches inside `label`, ignoring the leading slash so `/mo` finds `/model` at the
 * start rather than one character in. Case-insensitive substring; null when it does not match.
 */
export function matchLabel(label: string, query: string): LabelMatch | null {
    const body = label.startsWith("/") ? label.slice(1) : label
    const prefix = label.slice(0, label.length - body.length)
    if (!query) return {before: label, match: "", after: ""}
    const at = body.toLowerCase().indexOf(query.toLowerCase())
    if (at < 0) return null
    return {
        before: prefix + body.slice(0, at),
        match: body.slice(at, at + query.length),
        after: body.slice(at + query.length),
    }
}

/**
 * Sections keeping only items that match, with empty sections dropped. Prefix matches sort above
 * substring matches within a section so `/mo` puts `/model` over `/notion.move_page`.
 */
export function filterSections(
    sections: SlashCommandSection[],
    query: string,
): SlashCommandSection[] {
    if (!query) return sections.filter((section) => section.items.length > 0)
    const q = query.toLowerCase()
    const rank = (item: SlashCommandItem) => {
        const body = (item.label.startsWith("/") ? item.label.slice(1) : item.label).toLowerCase()
        return body.startsWith(q) ? 0 : 1
    }
    return sections
        .map((section) => ({
            ...section,
            items: section.items
                .filter((item) => matchLabel(item.label, query) !== null)
                .sort((a, b) => rank(a) - rank(b)),
        }))
        .filter((section) => section.items.length > 0)
}

/** Every visible item in order, so arrow keys can walk the sections as one list. */
export function flattenSections(sections: SlashCommandSection[]): SlashCommandItem[] {
    return sections.flatMap((section) => section.items)
}
