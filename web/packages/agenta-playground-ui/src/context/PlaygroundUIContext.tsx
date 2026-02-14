/**
 * PlaygroundUIContext
 *
 * Provides context injection for OSS-specific components that vary between OSS and EE.
 * This allows the @agenta/playground package to remain environment-agnostic while
 * the consuming app (OSS or EE) provides the actual component implementations.
 *
 * @example
 * ```tsx
 * // In OSS app
 * import { PlaygroundUIProvider } from "@agenta/playground-ui"
 * import { EntityDrillInView } from "@/oss/components/DrillInView"
 *
 * export function PlaygroundTest() {
 *   return (
 *     <PlaygroundUIProvider providers={{
 *       EntityDrillInView,
 *       SharedGenerationResultUtils,
 *       LoadTestsetModal: dynamic(() => import("...LoadTestsetModal")),
 *       CommitVariantChangesButton: dynamic(() => import("...CommitVariantChangesButton")),
 *     }}>
 *       <PlaygroundContent />
 *     </PlaygroundUIProvider>
 *   )
 * }
 * ```
 */

import {createContext, useContext, type ReactNode, type ComponentType} from "react"

import type {ModalProps, ButtonProps} from "antd"

// ============================================================================
// PROP TYPES FOR INJECTABLE COMPONENTS
// ============================================================================

/**
 * Props for EntityDrillInView component
 * Renders configuration editing with DrillIn navigation
 */
export interface EntityDrillInViewProps {
    entityId: string
    entity: unknown // EntityAPI type - kept generic to avoid circular deps
    columns?: unknown
    editable?: boolean
    showAddControls?: boolean
    showDeleteControls?: boolean
    rootTitle?: string
    showCollapse?: boolean
    hideBreadcrumb?: boolean
    currentPath?: string[]
    onPathChange?: (path: string[]) => void
}

/**
 * Props for SharedGenerationResultUtils component
 * Displays execution metrics, trace info, and status
 */
export interface SharedGenerationResultUtilsProps {
    traceId?: string | null
    showStatus?: boolean
    className?: string
}

/**
 * Payload returned when testset data is selected
 */
export interface LoadTestsetSelectionPayload {
    testcases: Record<string, unknown>[]
    revisionId?: string
    testsetName?: string
    testsetId?: string
    revisionVersion?: number | null
}

/**
 * Props for LoadTestsetModal component
 * Modal for selecting/loading testset data
 */
export interface LoadTestsetModalProps extends ModalProps {
    setTestsetData: (payload: LoadTestsetSelectionPayload | null) => void
}

/**
 * Props for CommitVariantChangesButton component
 * Button for committing variant changes
 *
 * Note: Uses ButtonProps (not Omit<ButtonProps, "onClick">) for compatibility
 * with OSS implementations that handle onClick internally.
 */
export interface CommitVariantChangesButtonProps extends ButtonProps {
    entityId: string
    label?: ReactNode
    icon?: boolean
    children?: ReactNode
    onSuccess?: (props: {revisionId?: string; entityId?: string}) => void
}

// SettingsPreset type is imported from @agenta/entities/runnable
// Re-export it for context consumers who need it
export type {SettingsPreset} from "@agenta/entities/runnable"

/**
 * Config for initializing testset save mode
 *
 * Supports two modes:
 * 1. Entity-based (preferred): Pass loadableId to read directly from loadable entity
 * 2. Data-based (legacy): Pass testcases array to copy into modal state
 */
export interface SaveModeConfig {
    /** Loadable ID to read rows from (entity-based, preferred) */
    loadableId?: string
    /** Testcases data to copy (legacy, used when no loadableId) */
    testcases?: Record<string, unknown>[]
    /** Default name for the new testset */
    defaultName?: string
}

// ============================================================================
// PROP TYPES FOR FOCUS DRAWER INJECTABLE COMPONENTS
// ============================================================================

/**
 * Props for SimpleSharedEditor component
 * Editor with header, minimize/expand, and format controls
 */
export interface SimpleSharedEditorProps {
    value?: string
    initialValue?: string
    editorType?: string
    headerName?: string | ReactNode
    headerClassName?: string
    isJSON?: boolean
    isMinimizeVisible?: boolean
    isFormatVisible?: boolean
    defaultMinimized?: boolean
    minimizedHeight?: number
}

// ============================================================================
// CONTEXT DEFINITION
// ============================================================================

/**
 * Injectable components provided by the consuming app
 */
export interface PlaygroundUIProviders {
    /**
     * EntityDrillInView component for config editing
     */
    EntityDrillInView: ComponentType<EntityDrillInViewProps>

    /** SharedGenerationResultUtils for trace info display */
    SharedGenerationResultUtils: ComponentType<SharedGenerationResultUtilsProps>

    /** LoadTestsetModal for testset selection */
    LoadTestsetModal: ComponentType<LoadTestsetModalProps>

    /** CommitVariantChangesButton for saving variants */
    CommitVariantChangesButton: ComponentType<CommitVariantChangesButtonProps>

    /** SimpleSharedEditor for displaying editable content blocks */
    SimpleSharedEditor?: ComponentType<SimpleSharedEditorProps>

    /**
     * Initialize save mode for the LoadTestsetModal.
     * Called before opening the modal to set up testcases for saving.
     * This allows the modal to switch to "save" mode instead of "load" mode.
     */
    initializeSaveMode?: (config: SaveModeConfig) => void
}

export interface PlaygroundUIContextValue {
    providers: PlaygroundUIProviders
}

const PlaygroundUIContext = createContext<PlaygroundUIContextValue | null>(null)

// ============================================================================
// PROVIDER
// ============================================================================

export interface PlaygroundUIProviderProps {
    providers: PlaygroundUIProviders
    children: ReactNode
}

/**
 * Provider for injecting OSS/EE-specific components into the playground
 */
export function PlaygroundUIProvider({providers, children}: PlaygroundUIProviderProps) {
    return (
        <PlaygroundUIContext.Provider value={{providers}}>{children}</PlaygroundUIContext.Provider>
    )
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook to access injectable components
 *
 * @throws Error if used outside PlaygroundUIProvider
 * @returns The injectable component providers
 */
export function usePlaygroundUI(): PlaygroundUIProviders {
    const context = useContext(PlaygroundUIContext)
    if (!context) {
        throw new Error("usePlaygroundUI must be used within PlaygroundUIProvider")
    }
    return context.providers
}

/**
 * Optional hook that returns null if outside provider
 * Useful for components that can work with or without the context
 */
export function usePlaygroundUIOptional(): PlaygroundUIProviders | null {
    const context = useContext(PlaygroundUIContext)
    return context?.providers ?? null
}
