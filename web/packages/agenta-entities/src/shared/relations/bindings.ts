/**
 * Entity Binding Relations
 *
 * Provides type-safe binding ID generation for connecting entities
 * across different domains (e.g., loadable-runnable connections).
 *
 * This replaces ad-hoc string conventions with typed relations:
 * - Before: `testset:${entityType}:${entityId}` scattered across codebase
 * - After: `loadableBindingRelation.binding.getId(entityType, entityId)` with type safety
 *
 * @example
 * ```typescript
 * import { parseLoadableId } from '@agenta/entities/shared'
 *
 * // Parse a loadable ID ("testset:revision:rev-123") back to its components
 * const parsed = parseLoadableId("testset:revision:rev-123")
 * // Result: { type: 'revision', id: 'rev-123' }
 * ```
 */

import type {EntityRelation} from "../molecule/types"

// ============================================================================
// BINDING FORMATS
// ============================================================================

/**
 * Supported binding formats for different use cases.
 *
 * - `testset`: Format for testset-related entities (revision, testcase)
 *              Pattern: `testset:{entityType}:{entityId}`
 */
export type BindingFormat = "testset"

/**
 * Result of parsing a binding ID.
 */
export interface ParsedBindingId {
    /** The entity type (e.g., 'revision', 'testcase') */
    type: string
    /** The entity ID */
    id: string
    /** The binding format used */
    format: BindingFormat
}

// ============================================================================
// LOADABLE BINDING RELATION
// ============================================================================

/**
 * Binding relation for loadable entities.
 *
 * This relation defines how loadable IDs are generated and parsed.
 * It's not a traditional parent-child relation, but uses the binding
 * interface to provide type-safe ID manipulation.
 *
 * The format follows: `testset:{entityType}:{entityId}`
 *
 * @example
 * ```typescript
 * // In playground controller:
 * const loadableId = loadableBindingRelation.binding!.getId('revision', revisionId)
 * ```
 */
export const loadableBindingRelation: EntityRelation<unknown, unknown> = {
    name: "loadable",
    parentType: "runnable",
    childType: "loadable",

    binding: {
        /**
         * Generate a loadable binding ID from entity type and ID.
         *
         * @param entityType - The type of entity (e.g., 'revision', 'testcase')
         * @param entityId - The entity's unique identifier
         * @returns A binding ID in the format `testset:{entityType}:{entityId}`
         */
        getId: (entityType: string, entityId: string): string => {
            return `testset:${entityType}:${entityId}`
        },

        /**
         * Parse a loadable binding ID back to its components.
         *
         * @param bindingId - The binding ID to parse
         * @returns The parsed components, or null if invalid format
         */
        parseId: (bindingId: string): {type: string; id: string} | null => {
            const match = bindingId.match(/^testset:(\w+):(.+)$/)
            if (!match) return null
            return {type: match[1], id: match[2]}
        },
    },

    // Not a traditional parent-child relation, so these are no-ops
    childIdsPath: () => [],
    childMolecule: undefined as unknown as EntityRelation<unknown, unknown>["childMolecule"],
    mode: "reference",
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parse a loadable binding ID back to its components.
 *
 * This is a convenience wrapper around `loadableBindingRelation.binding.parseId`.
 * Use this when you need to extract the entity type and ID from a binding ID.
 *
 * @param bindingId - The binding ID to parse
 * @returns The parsed components with format, or null if invalid
 *
 * @example
 * ```typescript
 * import { parseLoadableId } from '@agenta/entities/shared'
 *
 * const parsed = parseLoadableId('testset:revision:abc-123')
 * if (parsed) {
 *   console.log(parsed.type)   // 'revision'
 *   console.log(parsed.id)     // 'abc-123'
 *   console.log(parsed.format) // 'testset'
 * }
 * ```
 */
export function parseLoadableId(bindingId: string): ParsedBindingId | null {
    const result = loadableBindingRelation.binding!.parseId(bindingId)
    if (!result) return null
    return {
        ...result,
        format: "testset",
    }
}
