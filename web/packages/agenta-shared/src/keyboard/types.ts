/**
 * Types for the keyboard shortcut catalog.
 *
 * The catalog is the single source of truth for what a key does and how it is named on screen,
 * so a hint and the handler that answers it can never disagree. Everything here is data: no DOM,
 * no React, no listeners.
 */

/** How a chord names its non-modifier key. */
export type KeyRef =
    | {kind: "logical"; key: string}
    | {kind: "physical"; code: string}

/**
 * A modifier requirement. Unspecified means FORBIDDEN, deliberately: `Escape` denies an approval
 * today even with Shift or Alt held, because nobody wrote the negative.
 */
export type ModState = "required" | "forbidden"

export interface Chord {
    target: KeyRef
    /** `⌘` on Apple hardware, `Ctrl` elsewhere. Resolved at match time against a passed-in
     * platform, which is what lets one definition serve both the matcher and the formatter. */
    mod?: ModState
    alt?: ModState
    shift?: ModState
    /** Literal Control, distinct from `mod`. Overrides the `mod` derivation for this modifier. */
    ctrl?: ModState
    /** Literal Meta, distinct from `mod`. Overrides the `mod` derivation for this modifier. */
    meta?: ModState
}

/** The minimum event shape the matcher needs. A DOM `KeyboardEvent` satisfies it structurally,
 * as does a React `KeyboardEvent`, as does an object literal in a node test. */
export interface KeyEventLike {
    key: string
    code: string
    altKey: boolean
    ctrlKey: boolean
    metaKey: boolean
    shiftKey: boolean
    repeat?: boolean
    isComposing?: boolean
}

/** Whether a shortcut survives a focused text field. */
export type TypingPolicy = "block" | "allow" | "allow-with-mod"

export interface ShortcutGuards {
    /** Auto-repeat from a held key. */
    allowRepeat?: boolean
    /** A keystroke mid-IME-composition. Only three of the app's handlers check this today. */
    allowComposing?: boolean
    typing?: TypingPolicy
}

export type ShortcutId = string & {readonly __brand: "ShortcutId"}
export type SectionId = string & {readonly __brand: "SectionId"}

/** The chip drawn beside a shortcut's own control. */
export type InlineHintPolicy = "always" | "never"
/** Whether the shortcuts reference lists it. Separate from `inlineHint`: `⌘B` is deliberately
 * unadvertised in the composer yet belongs in a reference, and the Alt chords have no chip
 * surface at all yet are exactly what a reference exists to reveal. */
export type ReferencePolicy = "listed" | "hidden"

export interface ShortcutDefinition {
    /** Stable identity. Handlers and hints reference this, never a chord — which is what would
     * let a later remapping layer override bindings without touching a single call site. */
    id: ShortcutId
    section: SectionId
    /** Every binding for this action. `chords[0]` is canonical for the inline chip. Empty only
     * for actions reached by typing rather than by a chord (the slash menu's `/`). */
    chords: readonly Chord[]
    /** The action name a user reads. Imperative, sentence case, no trailing period, and no key
     * glyph — it is the reference's first column and has to stand alone. */
    label: string
    /** One clause naming when it applies: "while an approval is waiting". */
    context?: string
    inlineHint?: InlineHintPolicy
    reference?: ReferencePolicy
    /** Sort position within the section. Ties fall back to catalog order. */
    order?: number
    guards?: ShortcutGuards
}

export interface SectionDefinition {
    id: SectionId
    title: string
    summary?: string
    order: number
}

/** One row of the shortcuts reference, display-ready: no chord objects, no platform branching
 * left for the component to do. */
export interface ShortcutListing {
    id: ShortcutId
    label: string
    context?: string
    /** Every binding, formatted for this platform. */
    chords: string[]
}

export interface ShortcutSectionListing {
    id: SectionId
    title: string
    summary?: string
    shortcuts: ShortcutListing[]
}
