/**
 * DrillInView Context
 *
 * Provides shared state and configuration to all drill-in components.
 * This avoids prop drilling and enables consistent behavior across the tree.
 */

import type {DataPath} from "@agenta/shared/utils"

import type {DrillInClassNames, DrillInFieldBehaviors, DrillInSlots, DrillInStyles} from "./types"

// ============================================================================
// CONTEXT VALUE TYPE
// ============================================================================

/**
 * Context value for drill-in view
 *
 * Contains all shared state and configuration needed by child components.
 */
export interface DrillInContextValue<TEntity = unknown> {
    // ========== ENTITY ==========
    /**
     * The current entity being displayed
     */
    entity: TEntity | null

    /**
     * Entity ID
     */
    entityId: string

    /**
     * Whether the entity is dirty (has unsaved changes)
     */
    isDirty: boolean

    // ========== NAVIGATION ==========
    /**
     * Current navigation path
     */
    currentPath: DataPath

    /**
     * Navigate into a field
     */
    navigateInto: (key: string) => void

    /**
     * Navigate back one level
     */
    navigateBack: () => void

    /**
     * Navigate to a specific path index
     */
    navigateToIndex: (index: number) => void

    /**
     * Set path directly
     */
    setPath: (path: DataPath) => void

    // ========== MUTATIONS ==========
    /**
     * Update a value at a path
     */
    updateValue: (path: DataPath, value: unknown) => void

    /**
     * Delete a value at a path
     */
    deleteValue: (path: DataPath) => void

    /**
     * Add a new field/item at a path
     */
    addValue: (path: DataPath, key: string | number, value: unknown) => void

    /**
     * Discard all changes
     */
    discardChanges: () => void

    // ========== BEHAVIORS ==========
    /**
     * Field behavior configuration (merged from molecule + props)
     */
    behaviors: Required<DrillInFieldBehaviors>

    // ========== DISPLAY ==========
    /**
     * Root title
     */
    rootTitle: string

    /**
     * Show breadcrumb
     */
    showBreadcrumb: boolean

    /**
     * Show back arrow
     */
    showBackArrow: boolean

    // ========== CUSTOMIZATION ==========
    /**
     * Merged class names
     */
    classNames: Required<DrillInClassNames>

    /**
     * Custom styles
     */
    styles?: DrillInStyles

    /**
     * Custom slots
     */
    slots?: DrillInSlots<TEntity>

    // ========== COLLAPSE STATE ==========
    /**
     * Check if a field is collapsed
     */
    isCollapsed: (fieldKey: string) => boolean

    /**
     * Toggle collapse state for a field
     */
    toggleCollapse: (fieldKey: string) => void

    /**
     * Set collapse state for a field
     */
    setCollapsed: (fieldKey: string, collapsed: boolean) => void
}

// ============================================================================
// DEFAULT VALUES
// ============================================================================

/**
 * Default field behaviors
 */
export const defaultFieldBehaviors: Required<DrillInFieldBehaviors> = {
    editable: false,
    collapsible: true,
    copyable: true,
    deletable: false,
    addable: false,
}

// ============================================================================
// CONTEXT CREATION
// ============================================================================

/**
 * Note: Actual React context is created in the component layer (OSS)
 * since this package doesn't have React as a dependency.
 *
 * This file defines the types and default values.
 *
 * Usage in OSS:
 * ```typescript
 * import { createContext, useContext } from 'react'
 * import type { DrillInContextValue } from '@agenta/entity-ui'
 *
 * const DrillInContext = createContext<DrillInContextValue | null>(null)
 *
 * export function useDrillIn<T>() {
 *   const ctx = useContext(DrillInContext)
 *   if (!ctx) throw new Error('useDrillIn must be used within DrillInProvider')
 *   return ctx as DrillInContextValue<T>
 * }
 * ```
 */

// ============================================================================
// HELPER TYPES
// ============================================================================

/**
 * Props for the DrillInProvider component
 */
export interface DrillInProviderProps<TEntity = unknown> {
    /**
     * Context value
     */
    value: DrillInContextValue<TEntity>

    /**
     * Children to render
     */
    children: unknown // ReactNode
}

// ============================================================================
// UI INJECTION CONTEXT (re-export)
// ============================================================================

export {
    DrillInUIProvider,
    useDrillInUI,
    defaultShowMessage,
    type DrillInUIComponents,
    type DrillInUIProviderProps,
} from "./context/DrillInUIContext"
