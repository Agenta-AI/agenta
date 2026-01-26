/**
 * Create Level From Relation
 *
 * Factory to create hierarchy level configurations from EntityRelation definitions.
 * Reduces boilerplate in adapter definitions by deriving level config from relations.
 */

import type {EntityRelation, ListQueryState as SharedListQueryState} from "@agenta/entities/shared"
import type {Atom} from "jotai"

import type {ListQueryState, SelectableEntityType} from "../types"

import type {CreateHierarchyLevelOptions} from "./types"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Common entity field patterns for ID extraction
 */
interface EntityWithId {
    id?: string
    _id?: string
    [key: string]: unknown
}

/**
 * Common entity field patterns for name/label extraction
 */
interface EntityWithName {
    name?: string
    label?: string
    title?: string
    [key: string]: unknown
}

/**
 * Options for customizing level generation from relation
 */
export interface CreateLevelFromRelationOptions<TChild = unknown> {
    /**
     * The relation to create a level from
     */
    relation: EntityRelation<unknown, TChild>

    /**
     * Entity type for this level (required)
     */
    type: SelectableEntityType

    /**
     * Override the label from relation.selection.label
     */
    label?: string

    /**
     * Override autoSelectSingle from relation.selection
     */
    autoSelectSingle?: boolean

    /**
     * Custom ID extractor (defaults to common field patterns)
     */
    getId?: (entity: TChild) => string

    /**
     * Custom label extractor (defaults to common field patterns)
     */
    getLabel?: (entity: TChild) => string

    /**
     * Custom label node renderer
     */
    getLabelNode?: (entity: TChild) => React.ReactNode

    /**
     * Custom placeholder node renderer
     */
    getPlaceholderNode?: (placeholder: string) => React.ReactNode

    /**
     * Custom icon extractor
     */
    getIcon?: (entity: TChild) => React.ReactNode

    /**
     * Custom description extractor
     */
    getDescription?: (entity: TChild) => string | undefined

    /**
     * Whether this level has children (defaults based on position)
     */
    hasChildren?: boolean | ((entity: TChild) => boolean)

    /**
     * Whether this level is selectable (defaults based on position)
     */
    isSelectable?: boolean | ((entity: TChild) => boolean)

    /**
     * Whether this level is disabled
     */
    isDisabled?: (entity: TChild) => boolean

    /**
     * Callback before loading this level
     */
    onBeforeLoad?: (parentId: string) => void

    /**
     * Static list atom (for root level)
     */
    listAtom?: Atom<ListQueryState<TChild>>

    /**
     * List atom family (for child levels) - overrides relation.listAtomFamily
     */
    listAtomFamily?: (parentId: string) => Atom<ListQueryState<TChild>>
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Default ID extractor - handles common field name patterns
 */
function defaultGetId(entity: unknown): string {
    const e = entity as EntityWithId
    // Try common ID field patterns
    if (e.id) return e.id
    if (e._id) return e._id

    // Try entity-specific patterns
    const keys = ["variantId", "variant_id", "appId", "app_id", "evaluatorId", "evaluator_id"]
    for (const key of keys) {
        if (e[key] && typeof e[key] === "string") {
            return e[key] as string
        }
    }

    return ""
}

/**
 * Default label extractor - handles common field name patterns
 */
function defaultGetLabel(entity: unknown): string {
    const e = entity as EntityWithName
    // Try common name field patterns
    if (e.name) return e.name
    if (e.label) return e.label
    if (e.title) return e.title

    // Try entity-specific patterns
    const nameKeys = [
        "variantName",
        "variant_name",
        "appName",
        "app_name",
        "evaluatorName",
        "evaluator_name",
    ]
    for (const key of nameKeys) {
        if (e[key] && typeof e[key] === "string") {
            return e[key] as string
        }
    }

    return "Unnamed"
}

/**
 * Convert shared ListQueryState to selection ListQueryState
 * Handles the difference in optional error field
 */
function wrapListAtom<T>(atom: Atom<SharedListQueryState<T>>): Atom<ListQueryState<T>> {
    // The types are compatible enough for our use case
    return atom as unknown as Atom<ListQueryState<T>>
}

/**
 * Wrap a list atom family to convert query state types
 */
function wrapListAtomFamily<T>(
    family: (parentId: string) => Atom<SharedListQueryState<T>>,
): (parentId: string) => Atom<ListQueryState<T>> {
    return (parentId: string) => wrapListAtom(family(parentId))
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a hierarchy level configuration from an EntityRelation
 *
 * This factory reduces boilerplate by:
 * 1. Using relation.selection for label/autoSelectSingle
 * 2. Using relation.listAtomFamily for data fetching
 * 3. Providing sensible defaults for getId/getLabel
 *
 * @example
 * ```typescript
 * import { createLevelFromRelation } from '@agenta/entity-ui/selection'
 * import { testsetToRevisionRelation } from '@agenta/entities/testset'
 *
 * const revisionLevel = createLevelFromRelation({
 *   relation: testsetToRevisionRelation,
 *   type: 'revision',
 *   // Optional overrides
 *   autoSelectSingle: true,
 * })
 * ```
 */
export function createLevelFromRelation<TChild = unknown>(
    options: CreateLevelFromRelationOptions<TChild>,
): CreateHierarchyLevelOptions<TChild> {
    const {
        relation,
        type,
        label,
        autoSelectSingle,
        getId,
        getLabel,
        getLabelNode,
        getPlaceholderNode,
        getIcon,
        getDescription,
        hasChildren,
        isSelectable,
        isDisabled,
        onBeforeLoad,
        listAtom,
        listAtomFamily,
    } = options

    // Derive from relation.selection if available
    const selectionConfig = relation.selection

    // Resolve hasChildren/isSelectable to functions
    const hasChildrenFn =
        typeof hasChildren === "function"
            ? hasChildren
            : typeof hasChildren === "boolean"
              ? () => hasChildren
              : undefined

    const isSelectableFn =
        typeof isSelectable === "function"
            ? isSelectable
            : typeof isSelectable === "boolean"
              ? () => isSelectable
              : undefined

    // Determine listAtomFamily - prefer explicit option, fall back to relation
    const resolvedListAtomFamily =
        listAtomFamily ??
        (relation.listAtomFamily
            ? wrapListAtomFamily(
                  relation.listAtomFamily as (
                      parentId: string,
                  ) => Atom<SharedListQueryState<TChild>>,
              )
            : undefined)

    // Use relation.selection.displayName as fallback for getLabel when no custom getLabel provided
    const resolvedGetLabel =
        getLabel ??
        (selectionConfig?.displayName as ((entity: TChild) => string) | undefined) ??
        (defaultGetLabel as (entity: TChild) => string)

    return {
        type,
        label: label ?? selectionConfig?.label ?? type,
        autoSelectSingle: autoSelectSingle ?? selectionConfig?.autoSelectSingle ?? false,
        listAtom,
        listAtomFamily: resolvedListAtomFamily,
        getId: getId ?? (defaultGetId as (entity: TChild) => string),
        getLabel: resolvedGetLabel,
        getLabelNode,
        getPlaceholderNode,
        getIcon,
        getDescription,
        hasChildren: hasChildrenFn,
        isSelectable: isSelectableFn,
        isDisabled,
        onBeforeLoad,
    }
}

// ============================================================================
// PRESETS
// ============================================================================

/**
 * Create a root-level config (first level in hierarchy)
 * Root levels use listAtom instead of listAtomFamily
 */
export function createRootLevelFromRelation<TChild = unknown>(
    options: Omit<CreateLevelFromRelationOptions<TChild>, "listAtomFamily"> & {
        listAtom: Atom<ListQueryState<TChild>>
    },
): CreateHierarchyLevelOptions<TChild> {
    return createLevelFromRelation({
        ...options,
        hasChildren: options.hasChildren ?? true,
        isSelectable: options.isSelectable ?? false,
    })
}

/**
 * Create a middle-level config (intermediate level in hierarchy)
 * Middle levels have children and are not selectable
 */
export function createMiddleLevelFromRelation<TChild = unknown>(
    options: CreateLevelFromRelationOptions<TChild>,
): CreateHierarchyLevelOptions<TChild> {
    return createLevelFromRelation({
        ...options,
        hasChildren: options.hasChildren ?? true,
        isSelectable: options.isSelectable ?? false,
    })
}

/**
 * Create a leaf-level config (last level in hierarchy)
 * Leaf levels are selectable and have no children
 */
export function createLeafLevelFromRelation<TChild = unknown>(
    options: CreateLevelFromRelationOptions<TChild>,
): CreateHierarchyLevelOptions<TChild> {
    return createLevelFromRelation({
        ...options,
        hasChildren: options.hasChildren ?? false,
        isSelectable: options.isSelectable ?? true,
    })
}
