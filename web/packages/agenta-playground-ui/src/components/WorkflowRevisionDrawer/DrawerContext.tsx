/**
 * DrawerContext
 *
 * Dependency injection for the WorkflowRevisionDrawer.
 * The drawer lives in @agenta/playground-ui (a package that cannot import OSS components).
 * OSS provides concrete components via this context.
 */
import {createContext, useContext, type ReactNode} from "react"

// ================================================================
// TYPES
// ================================================================

export type ConfigViewMode = "form" | "json" | "yaml"

export interface PlaygroundConfigSectionProps {
    revisionId: string
    disabled?: boolean
    useServerData?: boolean
    viewMode?: ConfigViewMode
}

export interface VariantNameCellProps {
    revisionId: string
    showBadges?: boolean
}

export interface DrawerProviders {
    /** Schema-driven config renderer (from @agenta/entity-ui/drill-in) */
    PlaygroundConfigSection?: React.ComponentType<PlaygroundConfigSectionProps>
    /** Variant name + badges renderer */
    VariantNameCell?: React.ComponentType<VariantNameCellProps>
    /** Playground button renderer */
    renderPlaygroundButton?: (revisionId: string) => ReactNode
    /** Deploy button renderer */
    renderDeployButton?: (revisionId: string) => ReactNode
    /** Commit button renderer */
    renderCommitButton?: (
        revisionId: string,
        options?: {onSuccess?: (result: {revisionId?: string}) => void},
    ) => ReactNode
    /** Environment tag label renderer */
    renderEnvironmentLabel?: (envName: string) => ReactNode
    /** Variant details renderer (for deployment context) */
    renderVariantDetails?: (data: {name: string; version: number; variant: unknown}) => ReactNode
    /** Evaluator type label renderer (for evaluator contexts) */
    renderEvaluatorTypeLabel?: (revisionId: string) => ReactNode
    /** DrillIn UI provider wrapper */
    DrillInUIProvider?: React.ComponentType<{children: ReactNode}>
    /** Callback when prev/next navigation occurs (e.g., update URL) */
    onNavigate?: (entityId: string) => void
}

// ================================================================
// CONTEXT
// ================================================================

const DrawerProvidersContext = createContext<DrawerProviders>({})

export const DrawerProvidersProvider = ({
    providers,
    children,
}: {
    providers: DrawerProviders
    children: ReactNode
}) => {
    return (
        <DrawerProvidersContext.Provider value={providers}>
            {children}
        </DrawerProvidersContext.Provider>
    )
}

export const useDrawerProviders = () => useContext(DrawerProvidersContext)
