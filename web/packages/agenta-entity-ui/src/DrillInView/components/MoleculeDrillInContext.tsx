/**
 * MoleculeDrillIn Context
 *
 * React context implementation for molecule-first drill-in views.
 * Provides shared state and configuration to all drill-in components.
 */

import {createContext, useContext, useMemo, useState, useCallback, type ReactNode} from "react"

import {type DataPath, setValueAtPath, deleteValueAtPath} from "@agenta/shared/utils"
import {useAtomValue, useSetAtom} from "jotai"

import {defaultFieldBehaviors} from "../context"
import type {DrillInContextValue} from "../context"
import type {
    DrillInClassNames,
    DrillInFieldBehaviors,
    DrillInSlots,
    DrillInStyles,
    MoleculeDrillInAdapter,
} from "../types"
import {mergeClassNames} from "../utils/classNames"

// ============================================================================
// CONTEXT
// ============================================================================

const DrillInContext = createContext<DrillInContextValue | null>(null)

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook to access drill-in context
 *
 * @throws Error if used outside DrillInProvider
 */
export function useDrillIn<TEntity = unknown>(): DrillInContextValue<TEntity> {
    const ctx = useContext(DrillInContext)
    if (!ctx) {
        throw new Error("useDrillIn must be used within MoleculeDrillInView")
    }
    return ctx as DrillInContextValue<TEntity>
}

// ============================================================================
// PROVIDER PROPS
// ============================================================================

export interface MoleculeDrillInProviderProps<TEntity = unknown, TDraft = Partial<TEntity>> {
    /**
     * The entity ID to display/edit
     */
    entityId: string

    /**
     * The molecule with drillIn configuration
     */
    molecule: MoleculeDrillInAdapter<TEntity, TDraft>

    /**
     * Initial path to start navigation at
     */
    initialPath?: DataPath

    /**
     * Controlled current path (when managing path externally)
     */
    currentPath?: DataPath

    /**
     * Callback when path changes
     */
    onPathChange?: (path: DataPath) => void

    /**
     * Override editable setting from molecule config
     */
    editable?: boolean

    /**
     * Override collapsible setting from molecule config
     */
    collapsible?: boolean

    /**
     * CSS class names for component parts
     */
    classNames?: DrillInClassNames

    /**
     * Inline styles for component parts
     */
    styles?: DrillInStyles

    /**
     * Custom rendering slots
     */
    slots?: DrillInSlots<TEntity>

    /**
     * Title shown at root level
     * @default 'data'
     */
    rootTitle?: string

    /**
     * Show breadcrumb navigation
     * @default true
     */
    showBreadcrumb?: boolean

    /**
     * Show back arrow in breadcrumb
     * @default true
     */
    showBackArrow?: boolean

    /**
     * Children to render
     */
    children: ReactNode
}

// ============================================================================
// PROVIDER
// ============================================================================

/**
 * Provider component for MoleculeDrillInView
 *
 * Sets up all the shared state and configuration for child components.
 */
export function MoleculeDrillInProvider<TEntity = unknown, TDraft = Partial<TEntity>>({
    entityId,
    molecule,
    initialPath = [],
    currentPath: controlledPath,
    onPathChange,
    editable,
    collapsible,
    classNames: userClassNames,
    styles,
    slots,
    rootTitle = "data",
    showBreadcrumb = true,
    showBackArrow = true,
    children,
}: MoleculeDrillInProviderProps<TEntity, TDraft>) {
    // ========== ENTITY STATE ==========
    const entity = useAtomValue(molecule.atoms.data(entityId))
    const isDirty = useAtomValue(molecule.atoms.isDirty(entityId))
    const updateEntity = useSetAtom(molecule.reducers.update)
    const discardEntity = useSetAtom(molecule.reducers.discard)

    // ========== NAVIGATION STATE ==========
    const [internalPath, setInternalPath] = useState<DataPath>(initialPath)
    const currentPath = controlledPath ?? internalPath

    const setPath = useCallback(
        (path: DataPath) => {
            if (onPathChange) {
                onPathChange(path)
            } else {
                setInternalPath(path)
            }
        },
        [onPathChange],
    )

    const navigateInto = useCallback(
        (key: string) => {
            setPath([...currentPath, key])
        },
        [currentPath, setPath],
    )

    const navigateBack = useCallback(() => {
        setPath(currentPath.slice(0, -1))
    }, [currentPath, setPath])

    const navigateToIndex = useCallback(
        (index: number) => {
            setPath(currentPath.slice(0, index))
        },
        [currentPath, setPath],
    )

    // ========== COLLAPSE STATE ==========
    const [collapsedFields, setCollapsedFields] = useState<Record<string, boolean>>({})

    const isCollapsed = useCallback(
        (fieldKey: string) => {
            return collapsedFields[fieldKey] ?? false
        },
        [collapsedFields],
    )

    const toggleCollapse = useCallback((fieldKey: string) => {
        setCollapsedFields((prev) => ({...prev, [fieldKey]: !prev[fieldKey]}))
    }, [])

    const setCollapsed = useCallback((fieldKey: string, collapsed: boolean) => {
        setCollapsedFields((prev) => ({...prev, [fieldKey]: collapsed}))
    }, [])

    // ========== MUTATIONS ==========
    const updateValue = useCallback(
        (path: DataPath, value: unknown) => {
            if (!entity) return

            // Get root data from molecule config
            const rootData = molecule.drillIn.getRootData(entity)
            // Set value at path
            const updatedRoot = setValueAtPath(rootData, path, value)
            // Convert back to entity changes
            const changes = molecule.drillIn.getChangesFromRoot(entity, updatedRoot, path)
            // Update via molecule reducer
            updateEntity(entityId, changes)
        },
        [entity, entityId, molecule.drillIn, updateEntity],
    )

    const deleteValue = useCallback(
        (path: DataPath) => {
            if (!entity) return

            // Get root data from molecule config
            const rootData = molecule.drillIn.getRootData(entity)
            // Delete value at path
            const updatedRoot = deleteValueAtPath(rootData, path)
            // Convert back to entity changes
            const changes = molecule.drillIn.getChangesFromRoot(entity, updatedRoot, path)
            // Update via molecule reducer
            updateEntity(entityId, changes)
        },
        [entity, entityId, molecule.drillIn, updateEntity],
    )

    const addValue = useCallback(
        (path: DataPath, key: string | number, value: unknown) => {
            if (!entity) return

            // Get root data from molecule config
            const rootData = molecule.drillIn.getRootData(entity)
            // Add value at path + key
            const targetPath = [...path, String(key)]
            const updatedRoot = setValueAtPath(rootData, targetPath, value)
            // Convert back to entity changes
            const changes = molecule.drillIn.getChangesFromRoot(entity, updatedRoot, targetPath)
            // Update via molecule reducer
            updateEntity(entityId, changes)
        },
        [entity, entityId, molecule.drillIn, updateEntity],
    )

    const discardChanges = useCallback(() => {
        discardEntity(entityId)
    }, [entityId, discardEntity])

    // ========== BEHAVIORS ==========
    const moleculeBehaviors = molecule.drillIn.fields ?? {}
    const behaviors: Required<DrillInFieldBehaviors> = useMemo(
        () => ({
            ...defaultFieldBehaviors,
            ...moleculeBehaviors,
            // Props override molecule config
            ...(editable !== undefined ? {editable} : {}),
            ...(collapsible !== undefined ? {collapsible} : {}),
        }),
        [moleculeBehaviors, editable, collapsible],
    )

    // ========== CLASSNAMES ==========
    const classNames = useMemo(() => mergeClassNames(userClassNames), [userClassNames])

    // ========== CONTEXT VALUE ==========
    const contextValue: DrillInContextValue<TEntity> = useMemo(
        () => ({
            // Entity
            entity,
            entityId,
            isDirty,
            // Navigation
            currentPath,
            navigateInto,
            navigateBack,
            navigateToIndex,
            setPath,
            // Mutations
            updateValue,
            deleteValue,
            addValue,
            discardChanges,
            // Behaviors
            behaviors,
            // Display
            rootTitle,
            showBreadcrumb,
            showBackArrow,
            // Customization
            classNames,
            styles,
            slots,
            // Collapse
            isCollapsed,
            toggleCollapse,
            setCollapsed,
        }),
        [
            entity,
            entityId,
            isDirty,
            currentPath,
            navigateInto,
            navigateBack,
            navigateToIndex,
            setPath,
            updateValue,
            deleteValue,
            addValue,
            discardChanges,
            behaviors,
            rootTitle,
            showBreadcrumb,
            showBackArrow,
            classNames,
            styles,
            slots,
            isCollapsed,
            toggleCollapse,
            setCollapsed,
        ],
    )

    return (
        <DrillInContext.Provider value={contextValue as DrillInContextValue}>
            {children}
        </DrillInContext.Provider>
    )
}
