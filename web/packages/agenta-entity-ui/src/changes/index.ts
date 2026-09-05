/**
 * Commit-diff section rendering, without an editor in the module graph.
 *
 * Its own entry point (`@agenta/entity-ui/changes`) so importing it never reaches
 * `@agenta/entity-ui/modals`, which pulls `DiffView` and the Lexical editor behind it.
 */
export {
    ChangeSections,
    SectionCard,
    DetailCard,
    StatusTags,
    HunkRows,
    SECTION_ICON,
    INLINE_TEXT_DIFF_LINES,
    CARD,
    LINK_BTN,
    kindIcon,
    kindStyle,
} from "./ChangeSections"
export type {ChangeSectionsProps} from "./ChangeSections"
