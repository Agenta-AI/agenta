/**
 * The keyboard shortcut catalog: what each key does, and how it is named on screen.
 *
 * One source of truth so a rendered hint and the handler that answers it cannot disagree — the
 * failure this replaces printed a literal `⌘` on Windows. Pure data and pure functions: the
 * React bindings and the DOM helpers live in `@agenta/ui`, which is the package that can test
 * them.
 */

export {altChord, bare, code, key, modChord} from "./chord"
export {formatChord} from "./format"
export {chordAppliesTo, isAltChord, matchesChord, matchesShortcut, passesGuards} from "./matchChord"
export type {MatchContext} from "./matchChord"
export {SECTION_IDS, SECTIONS, SECTIONS_BY_ID} from "./sections"
export {MAX_DIGIT_ROWS, SESSION_SHORTCUT_MAX, SHORTCUTS} from "./catalog"
export {
    describeShortcut,
    getShortcut,
    listShortcutSections,
    SHORTCUT_IDS,
    SHORTCUTS_BY_ID,
    validateCatalog,
} from "./registry"
export type {ListShortcutsOptions} from "./registry"
export type {
    Chord,
    InlineHintPolicy,
    KeyEventLike,
    KeyRef,
    ModState,
    ReferencePolicy,
    SectionDefinition,
    SectionId,
    ShortcutDefinition,
    ShortcutGuards,
    ShortcutId,
    ShortcutListing,
    ShortcutSectionListing,
    TypingPolicy,
} from "./types"
