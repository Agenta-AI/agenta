/**
 * @agenta/playground-ui - Playground UI Components Package
 *
 * This package provides the UI components for the playground feature.
 * For state management (controllers, atoms), use @agenta/playground.
 *
 * ## Usage
 *
 * The package requires a provider to inject OSS/EE-specific components:
 *
 * ```tsx
 * import { PlaygroundUIProvider, PlaygroundContent } from "@agenta/playground-ui"
 * import { playgroundController, PlaygroundEntityProvider } from "@agenta/playground"
 * import { EntityDrillInView } from "@/oss/components/DrillInView"
 *
 * export function PlaygroundTest() {
 *   return (
 *     <PlaygroundEntityProvider providers={entityProviders}>
 *       <PlaygroundUIProvider providers={{
 *         EntityDrillInView,
 *         SharedGenerationResultUtils,
 *         LoadTestsetModal: dynamic(() => import("...LoadTestsetModal")),
 *         CommitVariantChangesButton: dynamic(() => import("...CommitVariantChangesButton")),
 *       }}>
 *         <PlaygroundContent />
 *       </PlaygroundUIProvider>
 *     </PlaygroundEntityProvider>
 *   )
 * }
 * ```
 *
 * ## State Management
 *
 * This package does NOT export state controllers or atoms.
 * Import state from @agenta/playground:
 *
 * ```typescript
 * import { playgroundController, outputConnectionController } from "@agenta/playground"
 * import { useAtomValue } from "jotai"
 *
 * const nodes = useAtomValue(playgroundController.selectors.nodes())
 * ```
 */

// ============================================================================
// CONTEXT (for OSS/EE injection)
// ============================================================================

export {
    PlaygroundUIProvider,
    usePlaygroundUI,
    usePlaygroundUIOptional,
    type PlaygroundUIProviders,
    type PlaygroundUIProviderProps,
    type PlaygroundUIContextValue,
    // Component prop types
    type EntityDrillInViewProps,
    type SharedGenerationResultUtilsProps,
    type LoadTestsetModalProps,
    type LoadTestsetSelectionPayload,
    type CommitVariantChangesButtonProps,
    type SettingsPreset,
    type SaveModeConfig,
    type SimpleSharedEditorProps,
} from "./context"

// ============================================================================
// COMPONENTS
// ============================================================================

export {
    EmptyState,
    // Entity selector
    EntitySelectorProvider,
    EntitySelector,
    EntitySelectorModal,
    useEntitySelector,
    type EntitySelectorConfig,
    type EntitySelection,
    type EntityType,
    // Tool call view
    ToolCallView,
    ToolCallViewHeader,
    createToolCallPayloads,
    // Chat controls
    ControlsBar,
    type ControlsBarProps,
    // Focus drawer
    PlaygroundFocusDrawer,
} from "./components"

// ============================================================================
// COMPONENT TYPES
// ============================================================================

export type {ChainExecutionResult, ChainNodeInfo} from "./components/types"
