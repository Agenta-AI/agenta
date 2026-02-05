/**
 * Create Adapter Factory
 *
 * Factory function for creating entity selection adapters.
 */

import type {EntitySelectionAdapter, HierarchyLevel, SelectionPathItem} from "../types"

import type {CreateSelectionAdapterOptions} from "./types"

/**
 * Create an entity selection adapter
 *
 * @example
 * ```typescript
 * const appRevisionAdapter = createAdapter({
 *   name: "appRevision",
 *   entityType: "appRevision",
 *   levels: [
 *     {
 *       type: "app",
 *       listAtom: appRevision.selectors.apps,
 *       getId: (app) => app.app_id,
 *       getLabel: (app) => app.app_name,
 *       hasChildren: () => true,
 *     },
 *     {
 *       type: "variant",
 *       listAtomFamily: (appId) => appRevision.selectors.variantsByApp(appId),
 *       getId: (v) => v.variantId,
 *       getLabel: (v) => v.variantName,
 *       hasChildren: () => true,
 *     },
 *     {
 *       type: "appRevision",
 *       listAtomFamily: (variantId) => appRevision.selectors.revisions(variantId),
 *       getId: (r) => r.id,
 *       getLabel: (r) => `v${r.revision}`,
 *       isSelectable: () => true,
 *     },
 *   ],
 *   toSelection: (path, leaf) => ({
 *     type: "appRevision",
 *     id: leaf.id,
 *     label: `${path[0]?.label} / ${path[1]?.label}`,
 *     path,
 *     metadata: { appId: path[0]?.id, variantId: path[1]?.id },
 *   }),
 * })
 * ```
 */
export function createAdapter<TSelection>(
    options: CreateSelectionAdapterOptions<TSelection>,
): EntitySelectionAdapter<TSelection> {
    const {
        name,
        entityType,
        levels,
        selectableLevel,
        toSelection,
        emptyMessage,
        loadingMessage,
        icon,
    } = options

    // Default selectable level is the last level
    const resolvedSelectableLevel = selectableLevel ?? levels.length - 1

    // Convert level options to HierarchyLevel
    const hierarchyLevels: HierarchyLevel<unknown>[] = levels.map((level, index) => {
        const isLastLevel = index === levels.length - 1

        return {
            type: level.type,
            // Display configuration
            label: level.label,
            autoSelectSingle: level.autoSelectSingle,
            // Non-paginated atoms
            listAtom: level.listAtom,
            listAtomFamily: level.listAtomFamily,
            // Paginated atoms
            paginatedListAtom: level.paginatedListAtom,
            paginatedListAtomFamily: level.paginatedListAtomFamily,
            supportsServerSearch: level.supportsServerSearch,
            searchField: level.searchField,
            // Entity accessors
            getId: level.getId,
            getLabel: level.getLabel,
            getLabelNode: level.getLabelNode,
            getPlaceholderNode: level.getPlaceholderNode,
            getIcon: level.getIcon,
            hasChildren: level.hasChildren ?? (() => !isLastLevel),
            isSelectable: level.isSelectable ?? (() => index >= resolvedSelectableLevel),
            isDisabled: level.isDisabled,
            getDescription: level.getDescription,
            // Lifecycle callbacks
            onBeforeLoad: level.onBeforeLoad,
            // Filtering
            filterItems: level.filterItems,
        }
    })

    return {
        name,
        entityType,
        hierarchy: {
            levels: hierarchyLevels,
            selectableLevel: resolvedSelectableLevel,
        },
        toSelection,
        isComplete: (path: SelectionPathItem[]) => path.length > resolvedSelectableLevel,
        emptyMessage,
        loadingMessage,
        icon,
    }
}

// ============================================================================
// ADAPTER REGISTRY
// ============================================================================

/**
 * Global adapter registry
 */
const adapterRegistry = new Map<string, EntitySelectionAdapter>()

/**
 * Register an adapter
 */
export function registerSelectionAdapter<TSelection>(
    adapter: EntitySelectionAdapter<TSelection>,
): void {
    adapterRegistry.set(adapter.name, adapter as EntitySelectionAdapter)
}

/**
 * Get an adapter by name
 */
export function getSelectionAdapter<TSelection = unknown>(
    name: string,
): EntitySelectionAdapter<TSelection> | undefined {
    return adapterRegistry.get(name) as EntitySelectionAdapter<TSelection> | undefined
}

/**
 * Check if an adapter is registered
 */
export function hasSelectionAdapter(name: string): boolean {
    return adapterRegistry.has(name)
}

/**
 * Get all registered adapter names
 */
export function getRegisteredAdapterNames(): string[] {
    return Array.from(adapterRegistry.keys())
}

/**
 * Clear the adapter registry (for testing)
 */
export function clearSelectionAdapterRegistry(): void {
    adapterRegistry.clear()
}

/**
 * Create and register an adapter in one call
 */
export function createAndRegisterAdapter<TSelection>(
    options: CreateSelectionAdapterOptions<TSelection>,
): EntitySelectionAdapter<TSelection> {
    const adapter = createAdapter(options)
    registerSelectionAdapter(adapter)
    return adapter
}

/**
 * Resolve adapter from name or instance
 */
export function resolveAdapter<TSelection>(
    adapterOrName: EntitySelectionAdapter<TSelection> | string,
): EntitySelectionAdapter<TSelection> {
    if (typeof adapterOrName === "string") {
        const adapter = getSelectionAdapter<TSelection>(adapterOrName)
        if (!adapter) {
            throw new Error(`[EntitySelection] Adapter not found: ${adapterOrName}`)
        }
        return adapter
    }
    return adapterOrName
}
