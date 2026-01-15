/**
 * useLazyChildren Hook
 *
 * Primitive hook for lazy-loading child entities.
 * Designed for Ant Design Cascader's loadData pattern.
 */

import {useCallback, useRef} from "react"

import {getDefaultStore, Atom} from "jotai"

import {resolveAdapter} from "../adapters/createAdapter"
import type {EntitySelectionAdapter, SelectionPathItem, ListQueryState} from "../types"

// ============================================================================
// TYPES
// ============================================================================

export interface CascaderOption {
    value: string
    /** Text label for the option */
    label: React.ReactNode
    /** Rich label node for enhanced display (e.g., RevisionLabel) */
    labelNode?: React.ReactNode
    isLeaf?: boolean
    loading?: boolean
    disabled?: boolean
    children?: CascaderOption[]
    /** Original entity data */
    entity?: unknown
    /** Path to this option */
    path?: SelectionPathItem[]
    /** Level index in the hierarchy */
    level?: number
}

export interface UseLazyChildrenOptions {
    /**
     * Adapter or adapter name
     */
    adapter: EntitySelectionAdapter | string

    /**
     * Callback when children are loaded
     */
    onLoad?: (parentPath: SelectionPathItem[], children: CascaderOption[]) => void

    /**
     * Callback on error
     */
    onError?: (error: Error, parentPath: SelectionPathItem[]) => void
}

export interface UseLazyChildrenResult {
    /**
     * Load children for a cascader option
     * Compatible with Ant Design Cascader's loadData prop
     */
    loadData: (selectedOptions: CascaderOption[]) => Promise<void>

    /**
     * Load root-level options
     */
    loadRootOptions: () => Promise<CascaderOption[]>

    /**
     * Convert entities to cascader options
     */
    toOptions: (
        entities: unknown[],
        level: number,
        parentPath: SelectionPathItem[],
    ) => CascaderOption[]

    /**
     * Check if loading is in progress for a path
     */
    isLoading: (path: SelectionPathItem[]) => boolean
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook for lazy-loading hierarchical children
 *
 * @example
 * ```typescript
 * const { loadData, loadRootOptions } = useLazyChildren({
 *   adapter: testsetAdapter,
 *   onLoad: (path, children) => console.log('Loaded:', path, children),
 * })
 *
 * // In Cascader
 * <Cascader
 *   options={rootOptions}
 *   loadData={loadData}
 * />
 * ```
 */
export function useLazyChildren(options: UseLazyChildrenOptions): UseLazyChildrenResult {
    const {adapter: adapterOrName, onLoad, onError} = options

    // Resolve adapter once
    const adapter = resolveAdapter(adapterOrName)

    // Track loading states
    const loadingPaths = useRef(new Set<string>())

    // Convert path to key for tracking
    const pathToKey = useCallback((path: SelectionPathItem[]): string => {
        return path.map((p) => `${p.type}:${p.id}`).join("/")
    }, [])

    // Check if loading
    const isLoading = useCallback(
        (path: SelectionPathItem[]): boolean => {
            return loadingPaths.current.has(pathToKey(path))
        },
        [pathToKey],
    )

    // Convert entities to cascader options
    const toOptions = useCallback(
        (entities: unknown[], level: number, parentPath: SelectionPathItem[]): CascaderOption[] => {
            const levelConfig = adapter.hierarchy.levels[level]
            if (!levelConfig) return []

            const isLastLevel = level >= adapter.hierarchy.levels.length - 1
            const isSelectableLevel = level >= adapter.hierarchy.selectableLevel

            return entities.map((entity) => {
                const id = levelConfig.getId(entity)
                const label = levelConfig.getLabel(entity)
                const labelNode = levelConfig.getLabelNode?.(entity)
                const hasChildren = levelConfig.hasChildren?.(entity) ?? !isLastLevel
                const isDisabled = levelConfig.isDisabled?.(entity) ?? false

                const pathItem: SelectionPathItem = {
                    type: levelConfig.type,
                    id,
                    label,
                }

                return {
                    value: id,
                    label,
                    labelNode,
                    isLeaf: !hasChildren || isSelectableLevel,
                    disabled: isDisabled,
                    entity,
                    path: [...parentPath, pathItem],
                    level,
                }
            })
        },
        [adapter.hierarchy],
    )

    // Load root options
    const loadRootOptions = useCallback(async (): Promise<CascaderOption[]> => {
        const rootLevel = adapter.hierarchy.levels[0]
        if (!rootLevel?.listAtom) return []

        const store = getDefaultStore()
        const listAtom = rootLevel.listAtom

        try {
            let queryState = store.get(listAtom) as ListQueryState<unknown>

            // Wait for pending state to resolve
            if (queryState.isPending) {
                await new Promise<void>((resolve) => {
                    const unsubscribe = store.sub(listAtom, () => {
                        const newState = store.get(listAtom) as ListQueryState<unknown>
                        if (!newState.isPending) {
                            unsubscribe()
                            resolve()
                        }
                    })
                    // Check again in case it resolved between get and sub
                    const currentState = store.get(listAtom) as ListQueryState<unknown>
                    if (!currentState.isPending) {
                        unsubscribe()
                        resolve()
                    }
                })
                // Re-fetch state after waiting
                queryState = store.get(listAtom) as ListQueryState<unknown>
            }

            const data = queryState.data ?? []
            return toOptions(data, 0, [])
        } catch (err) {
            onError?.(err as Error, [])
            return []
        }
    }, [adapter.hierarchy.levels, toOptions, onError])

    // Load children (loadData pattern)
    const loadData = useCallback(
        async (selectedOptions: CascaderOption[]): Promise<void> => {
            const targetOption = selectedOptions[selectedOptions.length - 1]
            if (!targetOption) return

            const currentPath = targetOption.path ?? []
            const nextLevel = selectedOptions.length
            const pathKey = pathToKey(currentPath)

            // Skip if already loading or loaded
            if (loadingPaths.current.has(pathKey) || targetOption.children) {
                return
            }

            const levelConfig = adapter.hierarchy.levels[nextLevel]
            if (!levelConfig) return

            // Mark as loading
            loadingPaths.current.add(pathKey)
            // Don't set targetOption.loading = true to prevent spinner on parent item
            // Instead, show a loading placeholder in the child panel
            targetOption.children = [
                {
                    value: "__loading__",
                    label: "Loading...",
                    disabled: true,
                    isLeaf: true,
                },
            ]

            try {
                // Call onBeforeLoad if defined (e.g., to enable lazy queries)
                if (levelConfig.onBeforeLoad && targetOption.value) {
                    levelConfig.onBeforeLoad(targetOption.value)
                }

                const store = getDefaultStore()
                let listAtom: Atom<ListQueryState<unknown>> | undefined

                // Get the appropriate list atom
                if (levelConfig.listAtomFamily && targetOption.value) {
                    listAtom = levelConfig.listAtomFamily(targetOption.value)
                } else if (levelConfig.listAtom) {
                    listAtom = levelConfig.listAtom
                }

                if (!listAtom) {
                    targetOption.children = []
                    targetOption.loading = false
                    loadingPaths.current.delete(pathKey)
                    return
                }

                // Fetch data
                const queryState = store.get(listAtom) as ListQueryState<unknown>

                // Wait for pending state
                if (queryState.isPending) {
                    // Subscribe and wait for data
                    await new Promise<void>((resolve) => {
                        const unsubscribe = store.sub(listAtom!, () => {
                            const newState = store.get(listAtom!) as ListQueryState<unknown>
                            if (!newState.isPending) {
                                unsubscribe()
                                resolve()
                            }
                        })
                    })
                }

                // Get final data
                const finalState = store.get(listAtom) as ListQueryState<unknown>
                const data = finalState.data ?? []

                // Convert to options
                const children = toOptions(data, nextLevel, currentPath)

                // Update target option
                targetOption.children = children

                onLoad?.(currentPath, children)
            } catch (err) {
                targetOption.children = []
                onError?.(err as Error, currentPath)
            } finally {
                loadingPaths.current.delete(pathKey)
            }
        },
        [adapter.hierarchy.levels, pathToKey, toOptions, onLoad, onError],
    )

    return {
        loadData,
        loadRootOptions,
        toOptions,
        isLoading,
    }
}
