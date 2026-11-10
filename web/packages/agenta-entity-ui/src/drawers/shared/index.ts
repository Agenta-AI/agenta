/**
 * Shared drawer rail primitives — the `[label │ content]` rhythm used across the agent-playground
 * config drawers. Re-exported here so app-layer drawers (e.g. the agent-home template setup drawer)
 * can share the exact same field/rail layout instead of re-implementing it.
 */
export {RailField, FieldLayoutProvider, railInfoLabel, type RailFieldProps} from "./RailField"
export {SectionRail, type SectionRailItem, type SectionRailProps} from "./SectionRail"
export {DrawerFooter} from "./DrawerFooter"
export {RowRemoveButton} from "./RowRemoveButton"
export {AddItemMenu, type AddItemGroup, type AddItemMenuItem} from "./AddItemMenu"
export {AppCard, AppLogo} from "./CatalogAppCard"
export {CatalogChooser, type CatalogChooserProps, type CatalogItemState} from "./CatalogChooser"
export {
    GatewayCatalogDrawer,
    type CatalogAdapter,
    type CatalogConfig,
    type ItemTrailing,
} from "./GatewayCatalogDrawer"

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

// Grouped-section primitives (sub-headers + provider logos) shared with the config panel's sections.
export {ProviderLogo, SubSectionHeader} from "../../DrillInView/SchemaControls/sectionGroups"
