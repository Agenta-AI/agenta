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
    type ChatTurnAssistantActionsProps,
    type CommitVariantChangesButtonProps,
    // Component prop types
    type EntityDrillInViewProps,
    type PlaygroundUIContextValue,
    type PlaygroundUIProviderProps,
    type PlaygroundUIProviders,
    type SaveModeConfig,
    type SettingsPreset,
    type SharedGenerationResultUtilsProps,
    type SimpleSharedEditorProps,
} from "./context"

// ============================================================================
// COMPONENTS
// ============================================================================

export {
    // Chat controls
    ControlsBar,
    EmptyState,
    EntitySelector,
    EntitySelectorModal,
    // Entity selector
    EntitySelectorProvider,
    // Focus drawer
    PlaygroundFocusDrawer,
    // Tool call view
    ToolCallView,
    ToolCallViewHeader,
    createToolCallPayloads,
    useEntitySelector,
    type ControlsBarProps,
    type EntitySelection,
    type EntitySelectorConfig,
    type EntityType,
} from "./components"

// ============================================================================
// COMPONENT TYPES
// ============================================================================

export type {ChainExecutionResult, ChainNodeInfo} from "./components/types"
