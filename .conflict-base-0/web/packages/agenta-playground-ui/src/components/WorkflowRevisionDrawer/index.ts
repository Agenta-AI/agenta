/**
 * WorkflowRevisionDrawer — public API
 */

// Main component
export {default as WorkflowRevisionDrawer} from "./WorkflowRevisionDrawer"

// Context / providers
export {
    DrawerProvidersProvider,
    useDrawerProviders,
    type ConfigViewMode,
    type DrawerProviders,
    type PlaygroundConfigSectionProps,
    type VariantNameCellProps,
} from "./DrawerContext"

// Store atoms + actions
export {
    // State atoms
    workflowRevisionDrawerOpenAtom,
    workflowRevisionDrawerEntityIdAtom,
    workflowRevisionDrawerContextAtom,
    workflowRevisionDrawerExpandedAtom,
    workflowRevisionDrawerIsolatedPlaygroundAtom,
    workflowRevisionDrawerInitialAppSelectionAtom,
    workflowRevisionDrawerPostCreateNavigationAtom,
    workflowRevisionDrawerScopedDirtyAtom,
    workflowRevisionDrawerNavigationIdsAtom,
    workflowRevisionDrawerCallbackAtom,
    workflowRevisionDrawerViewModeAtom,
    // Derived
    workflowRevisionDrawerAtom,
    // Actions
    openWorkflowRevisionDrawerAtom,
    closeWorkflowRevisionDrawerAtom,
    navigateWorkflowRevisionDrawerAtom,
    suppressDrawerCloseUrlCleanupAtom,
    // Helpers
    isCreateContext,
    // Types
    type DrawerContext,
    type DrawerInitialAppSelection,
    type OpenDrawerParams,
    type WorkflowCreatedResult,
} from "./store"

// Loading state (for external consumption, e.g., disabling nav buttons)
export {drawerIsLoadingAtomFamily} from "./DrawerContent"
