/**
 * Entity Relation Registry
 *
 * Central registry for all entity parent-child relationships.
 * Enables:
 * - Discovery of entity hierarchies
 * - Path computation between entities
 * - Selection adapter generation
 */

import type {EntityRelation} from "../molecule/types"

// ============================================================================
// REGISTRY INTERFACE
// ============================================================================

/**
 * Central registry for entity relationships.
 *
 * The registry stores relations keyed by "parentType->childType" format
 * and provides utilities for querying entity hierarchies.
 *
 * @example
 * ```typescript
 * // Register relations
 * entityRelationRegistry.register(appToVariantRelation)
 * entityRelationRegistry.register(variantToRevisionRelation)
 *
 * // Query hierarchy
 * const children = entityRelationRegistry.getChildren("app") // ["variant"]
 * const path = entityRelationRegistry.getPath("app", "appRevision")
 * // Returns: ["app", "variant", "appRevision"]
 * ```
 */
export interface RelationRegistry {
    /** All registered relations keyed by "parentType->childType" */
    readonly relations: ReadonlyMap<string, EntityRelation<unknown, unknown>>

    /**
     * Register a relation.
     * Key is auto-generated as "parentType->childType".
     */
    register<TParent, TChild>(relation: EntityRelation<TParent, TChild>): void

    /**
     * Unregister a relation by key.
     * Useful for testing or dynamic relation management.
     */
    unregister(key: string): boolean

    /**
     * Get a relation by key (e.g., "testset->revision").
     */
    get(key: string): EntityRelation<unknown, unknown> | undefined

    /**
     * Get a relation by parent and child types.
     */
    getByTypes(parentType: string, childType: string): EntityRelation<unknown, unknown> | undefined

    /**
     * Get all child types for a parent type.
     */
    getChildren(parentType: string): string[]

    /**
     * Get all parent types for a child type.
     */
    getParents(childType: string): string[]

    /**
     * Get the full hierarchy path from root to leaf.
     * Returns null if no path exists.
     *
     * @example
     * ```typescript
     * getPath("app", "appRevision")
     * // Returns: ["app", "variant", "appRevision"]
     * ```
     */
    getPath(root: string, leaf: string): string[] | null

    /**
     * Check if a path is valid (all relations exist).
     */
    isValidPath(path: string[]): boolean

    /**
     * Get all registered entity types.
     */
    getEntityTypes(): string[]

    /**
     * Clear all registered relations (for testing).
     */
    clear(): void
}

// ============================================================================
// REGISTRY IMPLEMENTATION
// ============================================================================

/**
 * Create a relation key from parent and child types.
 */
function createRelationKey(parentType: string, childType: string): string {
    return `${parentType}->${childType}`
}

/**
 * Create a new relation registry instance.
 */
export function createRelationRegistry(): RelationRegistry {
    const relations = new Map<string, EntityRelation<unknown, unknown>>()

    // Build reverse index for parent lookups
    const childToParents = new Map<string, Set<string>>()

    function updateChildToParentsIndex(
        parentType: string,
        childType: string,
        action: "add" | "remove",
    ): void {
        if (action === "add") {
            if (!childToParents.has(childType)) {
                childToParents.set(childType, new Set())
            }
            childToParents.get(childType)!.add(parentType)
        } else {
            const parents = childToParents.get(childType)
            if (parents) {
                parents.delete(parentType)
                if (parents.size === 0) {
                    childToParents.delete(childType)
                }
            }
        }
    }

    const registry: RelationRegistry = {
        get relations() {
            return relations as ReadonlyMap<string, EntityRelation<unknown, unknown>>
        },

        register<TParent, TChild>(relation: EntityRelation<TParent, TChild>): void {
            const key = createRelationKey(relation.parentType, relation.childType)

            // Warn if overwriting existing relation
            if (relations.has(key) && process.env.NODE_ENV === "development") {
                console.warn(
                    `[RelationRegistry] Overwriting existing relation: ${key}. ` +
                        `This may cause unexpected behavior.`,
                )
            }

            relations.set(key, relation as EntityRelation<unknown, unknown>)
            updateChildToParentsIndex(relation.parentType, relation.childType, "add")
        },

        unregister(key: string): boolean {
            const relation = relations.get(key)
            if (!relation) return false

            relations.delete(key)
            updateChildToParentsIndex(relation.parentType, relation.childType, "remove")
            return true
        },

        get(key: string): EntityRelation<unknown, unknown> | undefined {
            return relations.get(key)
        },

        getByTypes(
            parentType: string,
            childType: string,
        ): EntityRelation<unknown, unknown> | undefined {
            return relations.get(createRelationKey(parentType, childType))
        },

        getChildren(parentType: string): string[] {
            const children: string[] = []
            for (const relation of relations.values()) {
                if (relation.parentType === parentType) {
                    children.push(relation.childType)
                }
            }
            return children
        },

        getParents(childType: string): string[] {
            const parents = childToParents.get(childType)
            return parents ? Array.from(parents) : []
        },

        getPath(root: string, leaf: string): string[] | null {
            // BFS to find shortest path
            if (root === leaf) return [root]

            const visited = new Set<string>()
            const queue: {type: string; path: string[]}[] = [{type: root, path: [root]}]

            while (queue.length > 0) {
                const current = queue.shift()!
                if (visited.has(current.type)) continue
                visited.add(current.type)

                const children = registry.getChildren(current.type)
                for (const child of children) {
                    const newPath = [...current.path, child]

                    if (child === leaf) {
                        return newPath
                    }

                    if (!visited.has(child)) {
                        queue.push({type: child, path: newPath})
                    }
                }
            }

            return null
        },

        isValidPath(path: string[]): boolean {
            if (path.length < 2) return path.length === 1

            for (let i = 0; i < path.length - 1; i++) {
                const parentType = path[i]
                const childType = path[i + 1]
                const key = createRelationKey(parentType, childType)

                if (!relations.has(key)) {
                    return false
                }
            }

            return true
        },

        getEntityTypes(): string[] {
            const types = new Set<string>()
            for (const relation of relations.values()) {
                types.add(relation.parentType)
                types.add(relation.childType)
            }
            return Array.from(types)
        },

        clear(): void {
            relations.clear()
            childToParents.clear()
        },
    }

    return registry
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

/**
 * Global entity relation registry.
 *
 * Use this singleton for registering and querying entity relationships
 * across the application.
 *
 * @example
 * ```typescript
 * import { entityRelationRegistry } from '@agenta/entities/shared'
 *
 * // Register a relation
 * entityRelationRegistry.register({
 *   name: "testcases",
 *   parentType: "revision",
 *   childType: "testcase",
 *   childIdsPath: (rev) => rev.data?.testcase_ids ?? [],
 *   childMolecule: testcaseMolecule,
 *   mode: "populate",
 * })
 *
 * // Query relations
 * const children = entityRelationRegistry.getChildren("revision")
 * ```
 */
export const entityRelationRegistry: RelationRegistry = createRelationRegistry()
