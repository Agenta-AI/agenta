/**
 * Create Adapter From Relations
 *
 * Factory to create entity selection adapters from EntityRelation definitions.
 * Dramatically reduces boilerplate by deriving adapter config from the relation registry.
 *
 * @example
 * ```typescript
 * // Before: ~200+ lines per adapter
 * // After: ~20 lines
 *
 * import { createAdapterFromRelations } from '@agenta/entity-ui/selection'
 *
 * export const appRevisionAdapter = createAdapterFromRelations({
 *   name: 'appRevision',
 *   path: ['app', 'variant', 'appRevision'],
 *   selectableLevels: [2],
 *   levelOverrides: {
 *     variant: { autoSelectSingle: true },
 *   },
 * })
 * ```
 */

import type {ReactNode} from "react"

import {entityRelationRegistry, type EntityRelation} from "@agenta/entities/shared"
import type {Atom} from "jotai"

import type {
    EntitySelectionAdapter,
    EntitySelectionResult,
    ListQueryState,
    SelectableEntityType,
    SelectionPathItem,
} from "../types"

import {createAdapter} from "./createAdapter"
import {
    createLeafLevelFromRelation,
    createMiddleLevelFromRelation,
    createRootLevelFromRelation,
    type CreateLevelFromRelationOptions,
} from "./createLevelFromRelation"
import type {CreateHierarchyLevelOptions} from "./types"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Level override options for customizing relation-derived levels
 */
export interface LevelOverride<T = unknown> {
    /** Override label */
    label?: string
    /** Override autoSelectSingle */
    autoSelectSingle?: boolean
    /** Custom ID extractor */
    getId?: (entity: T) => string
    /** Custom label extractor */
    getLabel?: (entity: T) => string
    /** Custom label node renderer */
    getLabelNode?: (entity: T) => ReactNode
    /** Custom placeholder node renderer */
    getPlaceholderNode?: (placeholder: string) => ReactNode
    /** Custom icon extractor */
    getIcon?: (entity: T) => ReactNode
    /** Custom description extractor */
    getDescription?: (entity: T) => string | undefined
    /** Override hasChildren */
    hasChildren?: boolean | ((entity: T) => boolean)
    /** Override isSelectable */
    isSelectable?: boolean | ((entity: T) => boolean)
    /** Callback before loading */
    onBeforeLoad?: (parentId: string) => void
}

/**
 * Root level configuration (first level in hierarchy)
 */
export interface RootLevelConfig<T = unknown> extends LevelOverride<T> {
    /** Entity type for this level */
    type: SelectableEntityType
    /** Static list atom for root level data */
    listAtom: Atom<ListQueryState<T>>
}

/**
 * Child level configuration (derived from relation)
 */
export interface ChildLevelConfig {
    /** Entity type for this level */
    type: SelectableEntityType
    /** Relation key in registry (e.g., "app->variant") */
    relationKey?: string
    /** Direct relation reference (alternative to relationKey) */
    relation?: EntityRelation<unknown, unknown>
    /** Level overrides */
    overrides?: LevelOverride
}

/**
 * Options for createAdapterFromRelations
 */
export interface CreateAdapterFromRelationsOptions<
    TSelection extends EntitySelectionResult = EntitySelectionResult,
> {
    /** Unique adapter name */
    name: string

    /**
     * Root level configuration
     * The first level in the hierarchy (e.g., apps, testsets, evaluators)
     */
    rootLevel: RootLevelConfig

    /**
     * Child level configurations
     * Each level derives from a relation in the registry
     */
    childLevels: ChildLevelConfig[]

    /**
     * Which level indices are selectable (default: [last level])
     */
    selectableLevels?: number[]

    /**
     * Custom selection transformer
     * Converts path + leaf entity to selection result
     */
    toSelection?: (path: SelectionPathItem[], leafEntity: unknown) => TSelection

    /**
     * Custom selection result type name (e.g., "appRevision")
     */
    selectionType?: SelectableEntityType

    /**
     * Metadata extractor for selection result
     */
    extractMetadata?: (path: SelectionPathItem[], leafEntity: unknown) => Record<string, unknown>

    /** Empty state message */
    emptyMessage?: string

    /** Loading message */
    loadingMessage?: string

    /** Icon for this adapter */
    icon?: ReactNode
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Build relation key from parent/child types
 */
function buildRelationKey(parentType: string, childType: string): string {
    return `${parentType}->${childType}`
}

/**
 * Create default toSelection function
 */
function createDefaultToSelection(
    selectionType: SelectableEntityType,
    extractMetadata?: (path: SelectionPathItem[], leafEntity: unknown) => Record<string, unknown>,
): (path: SelectionPathItem[], leafEntity: unknown) => EntitySelectionResult {
    return (path: SelectionPathItem[], leafEntity: unknown): EntitySelectionResult => {
        const leaf = leafEntity as {id?: string; _id?: string}
        const id = leaf.id ?? leaf._id ?? ""
        const label = path.map((p) => p.label).join(" / ")
        const lastPathItem = path[path.length - 1]

        return {
            type: selectionType,
            id: lastPathItem?.id ?? id,
            label,
            path,
            metadata: extractMetadata?.(path, leafEntity),
        }
    }
}

/**
 * Apply level overrides to a base level config
 */
function applyOverrides<T>(
    baseLevel: CreateHierarchyLevelOptions<T>,
    overrides?: LevelOverride<T>,
): CreateHierarchyLevelOptions<T> {
    if (!overrides) return baseLevel

    return {
        ...baseLevel,
        label: overrides.label ?? baseLevel.label,
        autoSelectSingle: overrides.autoSelectSingle ?? baseLevel.autoSelectSingle,
        getId: overrides.getId ?? baseLevel.getId,
        getLabel: overrides.getLabel ?? baseLevel.getLabel,
        getLabelNode: overrides.getLabelNode ?? baseLevel.getLabelNode,
        getPlaceholderNode: overrides.getPlaceholderNode ?? baseLevel.getPlaceholderNode,
        getIcon: overrides.getIcon ?? baseLevel.getIcon,
        getDescription: overrides.getDescription ?? baseLevel.getDescription,
        hasChildren:
            overrides.hasChildren !== undefined
                ? typeof overrides.hasChildren === "function"
                    ? overrides.hasChildren
                    : () => overrides.hasChildren as boolean
                : baseLevel.hasChildren,
        isSelectable:
            overrides.isSelectable !== undefined
                ? typeof overrides.isSelectable === "function"
                    ? overrides.isSelectable
                    : () => overrides.isSelectable as boolean
                : baseLevel.isSelectable,
        onBeforeLoad: overrides.onBeforeLoad ?? baseLevel.onBeforeLoad,
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create an entity selection adapter from relation definitions
 *
 * This factory dramatically reduces adapter boilerplate by:
 * 1. Deriving level configs from EntityRelation definitions
 * 2. Using relation.selection for UI configuration
 * 3. Providing sensible defaults for common patterns
 *
 * @example
 * ```typescript
 * // Simple 2-level hierarchy (testset -> revision)
 * export const testsetAdapter = createAdapterFromRelations({
 *   name: 'testset',
 *   rootLevel: {
 *     type: 'testset',
 *     listAtom: testsetsListAtom,
 *     label: 'Testset',
 *   },
 *   childLevels: [
 *     {
 *       type: 'revision',
 *       relationKey: 'testset->revision',
 *     },
 *   ],
 *   selectionType: 'revision',
 * })
 *
 * // 3-level hierarchy with overrides (app -> variant -> revision)
 * export const appRevisionAdapter = createAdapterFromRelations({
 *   name: 'appRevision',
 *   rootLevel: {
 *     type: 'app',
 *     listAtom: appsListAtom,
 *     label: 'Application',
 *   },
 *   childLevels: [
 *     {
 *       type: 'variant',
 *       relationKey: 'app->variant',
 *       overrides: { autoSelectSingle: true },
 *     },
 *     {
 *       type: 'appRevision',
 *       relationKey: 'variant->appRevision',
 *       overrides: { autoSelectSingle: true },
 *     },
 *   ],
 *   selectionType: 'appRevision',
 *   extractMetadata: (path, leaf) => ({
 *     appId: path[0]?.id,
 *     appName: path[0]?.label,
 *     variantId: path[1]?.id,
 *     variantName: path[1]?.label,
 *     revision: (leaf as any).revision ?? 0,
 *   }),
 * })
 * ```
 */
export function createAdapterFromRelations<
    TSelection extends EntitySelectionResult = EntitySelectionResult,
>(options: CreateAdapterFromRelationsOptions<TSelection>): EntitySelectionAdapter<TSelection> {
    const {
        name,
        rootLevel,
        childLevels,
        selectableLevels,
        toSelection,
        selectionType,
        extractMetadata,
        emptyMessage,
        loadingMessage,
        icon,
    } = options

    // Build levels array
    const levels: CreateHierarchyLevelOptions<unknown>[] = []
    const totalLevels = 1 + childLevels.length
    const resolvedSelectableLevels = selectableLevels ?? [totalLevels - 1]
    const lastSelectableLevel = Math.max(...resolvedSelectableLevels)

    // 1. Create root level
    // Use createLevelFromRelation directly with proper typing for root level
    const rootLevelConfig = createRootLevelFromRelation({
        relation: {
            name: rootLevel.type,
            parentType: "",
            childType: rootLevel.type,
            childIdsPath: () => [],
            childMolecule: null as never,
            mode: "reference",
            selection: {
                label: rootLevel.label ?? rootLevel.type,
                autoSelectSingle: rootLevel.autoSelectSingle,
            },
        },
        type: rootLevel.type,
        label: rootLevel.label,
        autoSelectSingle: rootLevel.autoSelectSingle,
        listAtom: rootLevel.listAtom as Atom<ListQueryState<unknown>>,
        getId: rootLevel.getId as ((entity: unknown) => string) | undefined,
        getLabel: rootLevel.getLabel as ((entity: unknown) => string) | undefined,
        getLabelNode: rootLevel.getLabelNode as ((entity: unknown) => ReactNode) | undefined,
        getPlaceholderNode: rootLevel.getPlaceholderNode,
        getIcon: rootLevel.getIcon as ((entity: unknown) => ReactNode) | undefined,
        getDescription: rootLevel.getDescription as
            | ((entity: unknown) => string | undefined)
            | undefined,
        hasChildren: rootLevel.hasChildren as boolean | ((entity: unknown) => boolean) | undefined,
        isSelectable: rootLevel.isSelectable as
            | boolean
            | ((entity: unknown) => boolean)
            | undefined,
        onBeforeLoad: rootLevel.onBeforeLoad,
    })
    levels.push(rootLevelConfig)

    // 2. Create child levels from relations
    let previousType = rootLevel.type
    childLevels.forEach((childConfig, index) => {
        const isLastLevel = index === childLevels.length - 1
        const levelIndex = index + 1
        const isSelectable = resolvedSelectableLevels.includes(levelIndex)

        // Get relation from registry or direct reference
        let relation: EntityRelation<unknown, unknown> | undefined
        if (childConfig.relation) {
            relation = childConfig.relation
        } else if (childConfig.relationKey) {
            relation = entityRelationRegistry.get(childConfig.relationKey)
        } else {
            // Try to find by type pattern
            const key = buildRelationKey(previousType, childConfig.type)
            relation = entityRelationRegistry.get(key)
        }

        // Create level config
        const levelOptions: CreateLevelFromRelationOptions = {
            relation: relation ?? {
                name: childConfig.type,
                parentType: previousType,
                childType: childConfig.type,
                childIdsPath: () => [],
                childMolecule: null as never,
                mode: "reference",
            },
            type: childConfig.type,
            label: childConfig.overrides?.label ?? relation?.selection?.label,
            autoSelectSingle:
                childConfig.overrides?.autoSelectSingle ?? relation?.selection?.autoSelectSingle,
            listAtomFamily: relation?.listAtomFamily as
                | ((parentId: string) => Atom<ListQueryState<unknown>>)
                | undefined,
            getId: childConfig.overrides?.getId,
            getLabel: childConfig.overrides?.getLabel,
            getLabelNode: childConfig.overrides?.getLabelNode,
            getPlaceholderNode: childConfig.overrides?.getPlaceholderNode,
            getIcon: childConfig.overrides?.getIcon,
            getDescription: childConfig.overrides?.getDescription,
            hasChildren: childConfig.overrides?.hasChildren ?? !isLastLevel,
            isSelectable: childConfig.overrides?.isSelectable ?? isSelectable,
            onBeforeLoad: childConfig.overrides?.onBeforeLoad,
        }

        // Use appropriate factory based on position
        let levelConfig: CreateHierarchyLevelOptions<unknown>
        if (isLastLevel) {
            levelConfig = createLeafLevelFromRelation(levelOptions)
        } else {
            levelConfig = createMiddleLevelFromRelation(levelOptions)
        }

        // Apply any additional overrides
        levelConfig = applyOverrides(levelConfig, childConfig.overrides)
        levels.push(levelConfig)

        previousType = childConfig.type
    })

    // 3. Determine selection type and create toSelection
    const resolvedSelectionType =
        selectionType ?? (childLevels[childLevels.length - 1]?.type as SelectableEntityType)
    const resolvedToSelection =
        toSelection ??
        (createDefaultToSelection(resolvedSelectionType, extractMetadata) as (
            path: SelectionPathItem[],
            leafEntity: unknown,
        ) => TSelection)

    // 4. Create the adapter
    return createAdapter<TSelection>({
        name,
        entityType: resolvedSelectionType,
        levels,
        selectableLevel: lastSelectableLevel,
        toSelection: resolvedToSelection,
        emptyMessage,
        loadingMessage,
        icon,
    })
}

// ============================================================================
// CONVENIENCE FACTORIES
// ============================================================================

/**
 * Create a simple 2-level adapter (parent -> child)
 *
 * @example
 * ```typescript
 * export const testsetAdapter = createTwoLevelAdapter({
 *   name: 'testset',
 *   parentType: 'testset',
 *   parentListAtom: testsetsListAtom,
 *   childType: 'revision',
 *   childRelationKey: 'testset->revision',
 * })
 * ```
 */
export function createTwoLevelAdapter<
    TSelection extends EntitySelectionResult = EntitySelectionResult,
>(options: {
    name: string
    parentType: SelectableEntityType
    parentLabel?: string
    parentListAtom: Atom<ListQueryState<unknown>>
    parentOverrides?: LevelOverride
    childType: SelectableEntityType
    childLabel?: string
    childRelationKey?: string
    childRelation?: EntityRelation<unknown, unknown>
    childOverrides?: LevelOverride
    selectionType?: SelectableEntityType
    toSelection?: (path: SelectionPathItem[], leafEntity: unknown) => TSelection
    extractMetadata?: (path: SelectionPathItem[], leafEntity: unknown) => Record<string, unknown>
    emptyMessage?: string
    loadingMessage?: string
}): EntitySelectionAdapter<TSelection> {
    return createAdapterFromRelations({
        name: options.name,
        rootLevel: {
            type: options.parentType,
            label: options.parentLabel,
            listAtom: options.parentListAtom,
            ...options.parentOverrides,
        },
        childLevels: [
            {
                type: options.childType,
                relationKey: options.childRelationKey,
                relation: options.childRelation,
                overrides: {
                    label: options.childLabel,
                    ...options.childOverrides,
                },
            },
        ],
        selectionType: options.selectionType ?? options.childType,
        toSelection: options.toSelection,
        extractMetadata: options.extractMetadata,
        emptyMessage: options.emptyMessage,
        loadingMessage: options.loadingMessage,
    })
}

/**
 * Create a 3-level adapter (grandparent -> parent -> child)
 *
 * @example
 * ```typescript
 * export const appRevisionAdapter = createThreeLevelAdapter({
 *   name: 'appRevision',
 *   grandparentType: 'app',
 *   grandparentListAtom: appsListAtom,
 *   parentType: 'variant',
 *   parentRelationKey: 'app->variant',
 *   childType: 'appRevision',
 *   childRelationKey: 'variant->appRevision',
 * })
 * ```
 */
export function createThreeLevelAdapter<
    TSelection extends EntitySelectionResult = EntitySelectionResult,
>(options: {
    name: string
    grandparentType: SelectableEntityType
    grandparentLabel?: string
    grandparentListAtom: Atom<ListQueryState<unknown>>
    grandparentOverrides?: LevelOverride
    parentType: SelectableEntityType
    parentLabel?: string
    parentRelationKey?: string
    parentRelation?: EntityRelation<unknown, unknown>
    parentOverrides?: LevelOverride
    childType: SelectableEntityType
    childLabel?: string
    childRelationKey?: string
    childRelation?: EntityRelation<unknown, unknown>
    childOverrides?: LevelOverride
    selectionType?: SelectableEntityType
    toSelection?: (path: SelectionPathItem[], leafEntity: unknown) => TSelection
    extractMetadata?: (path: SelectionPathItem[], leafEntity: unknown) => Record<string, unknown>
    emptyMessage?: string
    loadingMessage?: string
}): EntitySelectionAdapter<TSelection> {
    return createAdapterFromRelations({
        name: options.name,
        rootLevel: {
            type: options.grandparentType,
            label: options.grandparentLabel,
            listAtom: options.grandparentListAtom,
            ...options.grandparentOverrides,
        },
        childLevels: [
            {
                type: options.parentType,
                relationKey: options.parentRelationKey,
                relation: options.parentRelation,
                overrides: {
                    label: options.parentLabel,
                    ...options.parentOverrides,
                },
            },
            {
                type: options.childType,
                relationKey: options.childRelationKey,
                relation: options.childRelation,
                overrides: {
                    label: options.childLabel,
                    ...options.childOverrides,
                },
            },
        ],
        selectionType: options.selectionType ?? options.childType,
        toSelection: options.toSelection,
        extractMetadata: options.extractMetadata,
        emptyMessage: options.emptyMessage,
        loadingMessage: options.loadingMessage,
    })
}
