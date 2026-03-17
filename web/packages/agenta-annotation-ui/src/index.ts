/**
 * @agenta/annotation-ui
 *
 * React UI components for annotation queues.
 * Depends on @agenta/annotation for state, @agenta/ui for design system.
 *
 * @packageDocumentation
 */

export {
    AnnotationQueuesView,
    AnnotationSession,
    AddToQueuePopover,
    CreateQueueDrawer,
    ScenarioContent,
    AnnotationTasksView,
} from "./components"

export {
    AnnotationUIProvider,
    useAnnotationUI,
    useAnnotationNavigation,
    useTraceContentRenderer,
    useTestcaseContentRenderer,
    type AnnotationUIProviderProps,
    type AnnotationUINavigation,
    type AnnotationUIContextValue,
    type TraceContentRendererProps,
    type TestcaseContentRendererProps,
} from "./context"

export {createQueueDrawerOpenAtom} from "./state"
