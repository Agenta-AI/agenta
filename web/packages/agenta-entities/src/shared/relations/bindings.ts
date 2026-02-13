/**
 * Entity Binding Relations
 *
 * Provides type-safe binding ID generation for connecting entities
 * across different domains (e.g., loadable-runnable connections).
 *
 * This replaces ad-hoc string conventions with typed relations:
 * - Before: `testset:${entityType}:${entityId}` scattered across codebase
 * - After: `getLoadableId(entityType, entityId)` with type safety
 *
 * @example
 * ```typescript
 * import { getLoadableId, parseLoadableId } from '@agenta/entities/shared'
 *
 * // Generate a loadable ID
 * const loadableId = getLoadableId('revision', 'rev-123')
 * // Result: "testset:revision:rev-123"
 *
 * // Parse a loadable ID back to its components
 * const parsed = parseLoadableId(loadableId)
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    childMolecule: undefined as any,
    mode: "reference",
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a loadable binding ID.
 *
 * This is a convenience wrapper around `loadableBindingRelation.binding.getId`.
 * Use this in components and controllers for type-safe ID generation.
 *
 * @param entityType - The type of entity (e.g., 'revision', 'testcase', 'trace')
 * @param entityId - The entity's unique identifier
 * @returns A binding ID in the format `testset:{entityType}:{entityId}`
 *
 * @example
 * ```typescript
 * import { getLoadableId } from '@agenta/entities/shared'
 *
 * // In playground controller
 * const loadableId = getLoadableId('revision', selectedRevisionId)
 *
 * // For testcase source
 * const testcaseLoadableId = getLoadableId('testcase', testcaseId)
 * ```
 */
export function getLoadableId(entityType: string, entityId: string): string {
    return loadableBindingRelation.binding!.getId(entityType, entityId)
}

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

/**
 * Check if a string is a valid loadable binding ID.
 *
 * @param value - The string to check
 * @returns True if the string is a valid loadable binding ID
 *
 * @example
 * ```typescript
 * import { isLoadableBindingId } from '@agenta/entities/shared'
 *
 * isLoadableBindingId('testset:revision:abc-123') // true
 * isLoadableBindingId('invalid-id')               // false
 * ```
 */
export function isLoadableBindingId(value: string): boolean {
    return parseLoadableId(value) !== null
}

/**
 * Extract the entity type from a loadable binding ID.
 *
 * @param bindingId - The binding ID to extract from
 * @returns The entity type, or null if invalid
 *
 * @example
 * ```typescript
 * import { getLoadableEntityType } from '@agenta/entities/shared'
 *
 * getLoadableEntityType('testset:revision:abc-123') // 'revision'
 * getLoadableEntityType('testset:testcase:xyz-456') // 'testcase'
 * ```
 */
export function getLoadableEntityType(bindingId: string): string | null {
    const parsed = parseLoadableId(bindingId)
    return parsed?.type ?? null
}

/**
 * Extract the entity ID from a loadable binding ID.
 *
 * @param bindingId - The binding ID to extract from
 * @returns The entity ID, or null if invalid
 *
 * @example
 * ```typescript
 * import { getLoadableEntityId } from '@agenta/entities/shared'
 *
 * getLoadableEntityId('testset:revision:abc-123') // 'abc-123'
 * ```
 */
export function getLoadableEntityId(bindingId: string): string | null {
    const parsed = parseLoadableId(bindingId)
    return parsed?.id ?? null
}
