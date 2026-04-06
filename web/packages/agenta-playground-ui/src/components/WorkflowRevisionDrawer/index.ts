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
    workflowRevisionDrawerNavigationIdsAtom,
    workflowRevisionDrawerCallbackAtom,
    workflowRevisionDrawerViewModeAtom,
    // Derived
    workflowRevisionDrawerAtom,
    // Actions
    openWorkflowRevisionDrawerAtom,
    closeWorkflowRevisionDrawerAtom,
    navigateWorkflowRevisionDrawerAtom,
    // Types
    type DrawerContext,
    type OpenDrawerParams,
} from "./store"

// Loading state (for external consumption, e.g., disabling nav buttons)
export {drawerIsLoadingAtomFamily} from "./DrawerContent"
