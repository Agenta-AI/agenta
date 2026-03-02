/**
 * InputMappingModal
 *
 * Modal for configuring input mappings between connected runnables.
 */

export {InputMappingModalWrapper} from "./InputMappingModal"
export type {
    EntityInfo,
    InputMappingModalProps,
    InputMappingModalWrapperProps,
    MappingLegendProps,
    MappingRowProps,
    MappingStatusInfo,
    MappingTableProps,
    ObjectMappingRowComponentProps,
    PathInfo,
    PathSelectorProps,
    TestRunPreviewProps,
    UseMappingStateReturn,
} from "./types"

// Export utilities for external use
export {extractPathsFromValue, getMappingStatus, buildAvailablePaths} from "./utils"

// Export hooks
export {useMappingState} from "./hooks"

// Export sub-components for potential reuse
export {
    MappingLegend,
    ObjectMappingRow,
    PathSelector,
    ScalarMappingRow,
    TestRunPreview,
} from "./components"
