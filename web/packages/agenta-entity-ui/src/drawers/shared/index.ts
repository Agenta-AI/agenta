/**
 * Shared drawer rail primitives — the `[label │ content]` rhythm used across the agent-playground
 * config drawers. Re-exported here so app-layer drawers (e.g. the agent-home template setup drawer)
 * can share the exact same field/rail layout instead of re-implementing it.
 */
export {RailField, railInfoLabel, type RailFieldProps} from "./RailField"
export {SectionRail, type SectionRailItem, type SectionRailProps} from "./SectionRail"

// "Which properties have uncommitted changes" — lets a rail row mark the exact changed property and
// a sub-section open itself when it owns one. Structural, so any config surface can provide it.
export {
    ChangedPathsProvider,
    useChangedDetail,
    useChangedPath,
    useHasChangedUnder,
    useRevertPath,
    useRevertUnder,
    type ChangedPaths,
} from "./ChangedPathsContext"

// Narrow a surface to the properties that matter right now — the real controls, filtered, rather
// than a second rendering of them. Rows self-filter on the `path` they already declare.
export {
    FocusPathsProvider,
    useFocusPaths,
    useIsPathVisible,
    useHasFocusUnder,
    type FocusPaths,
} from "./FocusPathsContext"

// Grouped-section primitives (uppercase sub-headers + collapsible provider cards) shared with the
// config panel's Tools/Triggers sections, so app-layer previews render identical provider groups.
export {
    CollapsibleProviderGroup,
    ProviderLogo,
    SubSectionHeader,
} from "../../DrillInView/SchemaControls/sectionGroups"
