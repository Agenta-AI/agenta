/**
 * Palette types + run matching for the chat composer's trigger menus.
 *
 * ONE plugin drives every palette (`/` commands, `@` file mentions): two would race for Enter at
 * CRITICAL by mount order, keep divergent dismissal latches, and clobber each other's
 * `aria-activedescendant` on the single contenteditable root.
 *
 * Kept out of the plugin file so a host can import the types without pulling Lexical in.
 */
import type {ReactNode} from "react"

/**
 * What selecting an item does: drill into a picker the host owns, run a one-shot action, type text
 * into the message, or move the palette somewhere else without closing it (`navigate` — entering a
 * folder). `open` and `action` behave identically here; they differ only in what the footer promises.
 */
export type PaletteItemKind = "open" | "insert" | "action" | "navigate"

/**
 * How an `insert` reaches the message. `code` writes an inline-code text node rather than literal
 * backticks: `$convertToMarkdownString` escapes a typed backtick in unformatted text, so a path
 * written as plain text ships as `\`a/b.md\`` and never resolves to a file chip.
 */
export type PaletteInsertAs = "text" | "code"

export interface PaletteItem {
    key: string
    /** Displayed and matched against — a command's label, or a file's path. */
    label: string
    description?: string
    /** Dim, after the label — the parent directory on a recents row. */
    secondary?: ReactNode
    /** Right-aligned label — the current value for a command, size and age for a file. */
    tail?: ReactNode
    icon?: ReactNode
    kind: PaletteItemKind
    /** `insert` items only: the text put into the message. Defaults to `label`. */
    insertText?: string
    insertAs?: PaletteInsertAs
    /** Runs after the menu closes, so a picker owns the keyboard. `navigate` runs without closing. */
    onSelect?: () => void
    /** Tab (and the touch tap target) enters this item without closing the menu. */
    onDrillIn?: () => void
}

export interface PaletteSection {
    key: string
    title: string
    items: PaletteItem[]
}

/** One palette the plugin can open, keyed on its trigger character. */
export interface PaletteSpec {
    /** Identity for the dismissal latch — an Escape in one palette must not suppress another. */
    key: string
    trigger: string
    /** May the query hold a `/`? File paths need it; a command palette must not, or `/a/b` keeps it open. */
    allowSlashInQuery: boolean
    /** aria-label for the listbox. */
    label: string
    sections: PaletteSection[]
    /** `label` filters and ranks here; `none` means the host already did (search results). */
    filterMode: "label" | "none"
    /** The run's query, or null when this palette is closed. Fires from an effect, once per change. */
    onQueryChange?: (query: string | null) => void
    header?: ReactNode
    /** The whole footer bar, as a function of the highlighted row. */
    footer?: (activeItem: PaletteItem | undefined) => ReactNode
    /** Paint shimmer rows in place of the list; the keyboard stays live against `sections`. */
    loading?: boolean
    emptyText?: (query: string) => ReactNode
    /** Return true to CONSUME Escape (stepped back a level) — the plugin then neither closes nor latches. */
    onEscape?: () => boolean
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * A run: the trigger opening a block or following a space, plus the word being typed. The boundary
 * is what keeps `and/or`, URLs, paths and `hey@agenta.ai` from opening a menu mid-sentence.
 */
export const runPatternFor = (trigger: string, allowSlash: boolean): RegExp =>
    new RegExp(`(^|\\s)${escapeRe(trigger)}(${allowSlash ? "[^\\s]*" : "[^\\s/]*"})$`)

/** The run the caret sits in, located within its text. */
export interface PaletteRun {
    /** The typed word after the trigger. */
    query: string
    /** Offset of the trigger within the text. */
    start: number
    /** False when the trigger is flush against the text start — the caller decides if that opens one. */
    afterSpace: boolean
}

/** The run ending at the caret for `pattern`, or null when there is none. */
export function readRun(textUpToCaret: string, pattern: RegExp): PaletteRun | null {
    const hit = pattern.exec(textUpToCaret)
    if (!hit) return null
    return {query: hit[2], start: hit.index + hit[1].length, afterSpace: hit[1] !== ""}
}

/**
 * Whether a run flush against the start of its own text node may still open the menu.
 *
 * `readRun` only sees one node's text, and formatting splits a paragraph into adjacent text nodes —
 * so a bolded `/model` after a plain `hello ` starts its node while the message reads `hello /model`.
 * Starting a NODE is not starting the MESSAGE: the run qualifies when everything before it in the
 * block is empty or ends in whitespace, which is the same rule the regex applies inside a node.
 */
export const runFollowsBoundary = (textBefore: string): boolean =>
    textBefore === "" || /\s$/.test(textBefore)

/** A located run — the identity a dismissal is keyed on. */
export interface LocatedRun {
    palette?: string
    nodeKey: string
    start: number
}

/**
 * Whether two runs are the same run. Dismissal is keyed on this — on PALETTE + POSITION, not on the
 * run's text (a retyped trigger gives an identical query) and not on mere existence (that leaks the
 * dismissal onto the next run, so a paste after an Escape would never open the menu).
 */
export const isSameRun = (a: LocatedRun | null, b: LocatedRun | null) =>
    !!a && !!b && a.nodeKey === b.nodeKey && a.start === b.start && a.palette === b.palette

/** A label split around the matched query, for the in-name match highlight. */
export interface LabelMatch {
    before: string
    match: string
    after: string
}

/**
 * Where `query` matches inside `label`, ignoring a leading slash so `/mo` finds `/model` at the
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
export function filterSections(sections: PaletteSection[], query: string): PaletteSection[] {
    if (!query) return sections.filter((section) => section.items.length > 0)
    const q = query.toLowerCase()
    const rank = (item: PaletteItem) => {
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
export function flattenSections(sections: PaletteSection[]): PaletteItem[] {
    return sections.flatMap((section) => section.items)
}
