/**
 * useCascadingMode Hook
 *
 * Cascading selection mode where all hierarchy levels are visible simultaneously.
 * Each level is a dropdown/select that depends on the previous level's selection.
 *
 * Pattern: App Select → Variant Select → Revision Select
 *
 * Used by EntitySelectGroup and similar multi-select layouts.
 */

import {useCallback, useEffect, useMemo, useRef} from "react"

import {atom, useAtom} from "jotai"
import {atomFamily} from "jotai-family"

import type {
    EntitySelectionAdapter,
    EntitySelectionResult,
    HierarchyLevel,
    SelectionPathItem,
} from "../../types"
import {
    useEntitySelectionCore,
    useSelectionCallbackTrigger,
    getLevelLabel,
    getLevelPlaceholder,
    type EntitySelectionCoreOptions,
} from "../useEntitySelectionCore"
import {useLevelData, calculateAutoSelectState, type LevelQueryState} from "../utilities"

// ============================================================================
// TYPES
// ============================================================================

/**
 * State for a single level in cascading mode
 */
export interface CascadingLevelState<T = unknown> {
    /** Level index (0-based) */
    index: number

    /** Level configuration */
    config: HierarchyLevel<T>

    /** Display label for this level (e.g., "Application") */
    label: string

    /** User's explicit selection (null if none or auto-selected) */
    selectedId: string | null

    /** Effective ID (user selection OR auto-selected) */
    effectiveId: string | null

    /** Items available at this level */
    items: T[]

    /** Query state for loading/error indicators */
    query: LevelQueryState

    /** Whether this level's effective selection was auto-selected */
    isAutoSelected: boolean

    /** Whether this level is enabled (previous level has selection) */
    isEnabled: boolean

    /** Selected entity data (if effectiveId is set) */
    selectedEntity: T | null

    /** Set user selection for this level */
    setSelectedId: (id: string | null) => void

    /** Placeholder text for empty state */
    placeholder: string
}

/**
 * Options for useCascadingMode
 */
export interface UseCascadingModeOptions<
    TSelection = EntitySelectionResult,
> extends EntitySelectionCoreOptions<TSelection> {
    /**
     * Maximum number of levels to render.
     * Use this to limit cascades (e.g., 2 levels for App → Variant only).
     * @default adapter.hierarchy.levels.length
     */
    maxLevels?: number
}

/**
 * Result from useCascadingMode
 */
export interface UseCascadingModeResult<TSelection = EntitySelectionResult> {
    /** State for each level */
    levels: CascadingLevelState[]

    /** Complete selection when all levels are determined, null otherwise */
    selection: TSelection | null

    /** Whether selection is complete */
    isComplete: boolean

    /** Reset all selections to initial state */
    reset: () => void

    /** The resolved adapter */
    adapter: EntitySelectionAdapter<TSelection>

    /** Instance ID */
    instanceId: string
}

// ============================================================================
// STATE ATOMS
// ============================================================================

/**
 * Atom family for user selections per instance.
 * Key: instanceId
 * Value: Array of user selections per level (null = no selection)
 */
const userSelectionsAtomFamily = atomFamily((instanceId: string) => atom<(string | null)[]>([]))

// ============================================================================
// INTERNAL: Level Data Hook
// ============================================================================

/**
 * Placeholder config for disabled levels (keeps hook call count stable)
 */
const PLACEHOLDER_LEVEL_CONFIG: HierarchyLevel<unknown> = {
    type: "app",
    getId: () => "",
    getLabel: () => "",
    hasChildren: () => false,
    isSelectable: () => false,
}

/**
 * Hook for fetching and managing a single level's data
 */
function useCascadingLevelWithData(
    levelConfig: HierarchyLevel<unknown> | null,
    levelIndex: number,
    parentId: string | null,
    isEnabled: boolean,
    userSelectedId: string | null,
    shouldAutoSelect: boolean,
    setSelectedId: (id: string | null) => void,
    prevLevelLabel: string | undefined,
): CascadingLevelState | null {
    // Use placeholder config when level doesn't exist (keeps hook count stable)
    const effectiveConfig = levelConfig ?? PLACEHOLDER_LEVEL_CONFIG
    const actuallyEnabled = levelConfig !== null && isEnabled

    // Fetch data for this level
    const {items, query} = useLevelData({
        levelConfig: effectiveConfig,
        parentId,
        isEnabled: actuallyEnabled,
    })

    // Return null for non-existent levels (after hooks are called)
    if (!levelConfig) {
        return null
    }

    // Calculate effective selection with auto-select
    const {effectiveId, isAutoSelected} = calculateAutoSelectState({
        userSelectedId,
        items,
        shouldAutoSelect,
        levelConfig,
    })

    // Find selected entity
    const selectedEntity = effectiveId
        ? (items.find((item) => levelConfig.getId(item) === effectiveId) ?? null)
        : null

    // Get labels and placeholder
    const label = getLevelLabel(levelConfig)
    const placeholder = query.isPending
        ? "Loading..."
        : getLevelPlaceholder(levelConfig, actuallyEnabled, prevLevelLabel)

    return {
        index: levelIndex,
        config: levelConfig,
        label,
        selectedId: userSelectedId,
        effectiveId,
        items,
        query,
        isAutoSelected,
        isEnabled: actuallyEnabled,
        selectedEntity,
        setSelectedId,
        placeholder,
    }
}

// ============================================================================
// HOOK: useCascadingMode
// ============================================================================

/**
 * Hook for cascading entity selection mode.
 *
 * Renders all hierarchy levels simultaneously as cascading dropdowns.
 * Each level depends on the previous level's selection.
 *
 * Features:
 * - Auto-selection when only one item at a level
 * - Per-level loading states
 * - Dependency chain (level N requires level N-1 selection)
 * - Reset functionality
 *
 * @example
 * ```typescript
 * const { levels, selection, reset } = useCascadingMode({
 *     adapter: "appRevision",
 *     onSelect: (selection) => console.log("Selected:", selection),
 *     autoSelectByLevel: [false, false, true],
 * })
 *
 * // Render cascading selects
 * {levels.map((level) => (
 *     <Select
 *         key={level.config.type}
 *         value={level.effectiveId}
 *         onChange={level.setSelectedId}
 *         options={level.items.map(item => ({
 *             value: level.config.getId(item),
 *             label: level.config.getLabel(item),
 *         }))}
 *         disabled={!level.isEnabled}
 *         loading={level.query.isPending}
 *         placeholder={level.placeholder}
 *     />
 * ))}
 * ```
 */
export function useCascadingMode<TSelection = EntitySelectionResult>(
    options: UseCascadingModeOptions<TSelection>,
): UseCascadingModeResult<TSelection> {
    const {onSelect, maxLevels} = options

    // Get core utilities
    const {
        adapter,
        hierarchyLevels,
        instanceId,
        selectableLevel,
        shouldAutoSelectAtLevel,
        createSelection,
    } = useEntitySelectionCore(options)

    // Limit levels if specified
    const effectiveLevels = maxLevels ? hierarchyLevels.slice(0, maxLevels) : hierarchyLevels

    // User selections atom for this instance
    const userSelectionsAtom = useMemo(() => userSelectionsAtomFamily(instanceId), [instanceId])
    const [userSelections, setUserSelections] = useAtom(userSelectionsAtom)

    // Track previous adapter name for reset on change
    const prevAdapterNameRef = useRef(adapter.name)

    // Reset when adapter changes
    useEffect(() => {
        if (prevAdapterNameRef.current !== adapter.name) {
            setUserSelections([])
            prevAdapterNameRef.current = adapter.name
        }
    }, [adapter.name, setUserSelections])

    // Initialize user selections array if needed
    useEffect(() => {
        if (userSelections.length !== effectiveLevels.length) {
            setUserSelections(new Array(effectiveLevels.length).fill(null))
        }
    }, [effectiveLevels.length, userSelections.length, setUserSelections])

    // Reset function
    const reset = useCallback(() => {
        setUserSelections(new Array(effectiveLevels.length).fill(null))
    }, [effectiveLevels.length, setUserSelections])

    // Create setter for a specific level (clears subsequent levels)
    const createLevelSetter = useCallback(
        (levelIndex: number) => (id: string | null) => {
            setUserSelections((prev) => {
                const next = [...prev]
                next[levelIndex] = id
                // Clear all subsequent levels
                for (let i = levelIndex + 1; i < next.length; i++) {
                    next[i] = null
                }
                return next
            })
        },
        [setUserSelections],
    )

    // Memoize level setters
    const levelSetters = useMemo(() => {
        return effectiveLevels.map((_, i) => createLevelSetter(i))
    }, [effectiveLevels, createLevelSetter])

    // Placeholder setter for non-existent levels
    const noopSetter = useCallback(() => {}, [])

    // Build level 0 (always called unconditionally)
    const level0Config = effectiveLevels[0] ?? null
    const level0AutoSelect = shouldAutoSelectAtLevel(0)
    const level0 = useCascadingLevelWithData(
        level0Config,
        0,
        null,
        true,
        userSelections[0] ?? null,
        level0AutoSelect,
        levelSetters[0] ?? noopSetter,
        undefined,
    )

    // Build level 1 (always called to satisfy React hooks rules)
    const level1Config = effectiveLevels[1] ?? null
    const level1AutoSelect = shouldAutoSelectAtLevel(1)
    const level1Enabled = level0?.effectiveId !== null
    const level1 = useCascadingLevelWithData(
        level1Config,
        1,
        level0?.effectiveId ?? null,
        level1Enabled,
        userSelections[1] ?? null,
        level1AutoSelect,
        levelSetters[1] ?? noopSetter,
        level0?.label,
    )

    // Build level 2 (always called to satisfy React hooks rules)
    const level2Config = effectiveLevels[2] ?? null
    const level2AutoSelect = shouldAutoSelectAtLevel(2)
    const level2Enabled = level1?.effectiveId !== null
    const level2 = useCascadingLevelWithData(
        level2Config,
        2,
        level1?.effectiveId ?? null,
        level2Enabled,
        userSelections[2] ?? null,
        level2AutoSelect,
        levelSetters[2] ?? noopSetter,
        level1?.label,
    )

    // Collect only existing levels (filter out nulls)
    const levels: CascadingLevelState[] = useMemo(() => {
        return [level0, level1, level2].filter(
            (level): level is CascadingLevelState => level !== null,
        )
    }, [level0, level1, level2])

    // Build selection if all levels have effective selections
    const selection = useMemo(() => {
        const targetLevel = Math.min(selectableLevel, levels.length - 1)

        // Check all levels up to target have effective selections
        for (let i = 0; i <= targetLevel; i++) {
            if (!levels[i]?.effectiveId) return null
        }

        // Build path
        const path: SelectionPathItem[] = []
        for (let i = 0; i <= targetLevel; i++) {
            const level = levels[i]
            if (level.effectiveId && level.selectedEntity) {
                path.push({
                    type: level.config.type,
                    id: level.effectiveId,
                    label: level.config.getLabel(level.selectedEntity),
                })
            }
        }

        // Get leaf entity
        const leafLevel = levels[targetLevel]
        if (!leafLevel?.selectedEntity) return null

        return createSelection(path, leafLevel.selectedEntity)
    }, [levels, selectableLevel, createSelection])

    const isComplete = selection !== null

    // Trigger onSelect when selection completes
    const getSelectionId = useCallback((s: TSelection) => (s as EntitySelectionResult).id, [])
    const triggerSelect = useSelectionCallbackTrigger(onSelect, getSelectionId)
    useEffect(() => {
        if (selection) {
            triggerSelect(selection)
        }
    }, [selection, triggerSelect])

    return {
        levels,
        selection,
        isComplete,
        reset,
        adapter,
        instanceId,
    }
}
