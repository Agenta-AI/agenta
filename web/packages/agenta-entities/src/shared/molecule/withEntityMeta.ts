/**
 * withEntityMeta — Capability Mixin for Common Entity Fields
 *
 * Extends any molecule with standardized `meta` atoms that provide:
 * - Resolved user info (creator, updater) via the shared user resolution system
 * - Typed access to timestamps, name, version, slug, description
 * - Configurable field mapping for entities with non-standard naming
 *
 * ## Architecture
 *
 * This follows the same capability pattern as `RunnableCapability` and
 * `LoadableCapability`: a pure extension that adds derived read-only atoms
 * without introducing new writable state.
 *
 * ```text
 * molecule.atoms.data(id)          ← source of truth (entity data)
 *       │
 *       ▼
 * resolveField(data, fieldMap)     ← extracts raw field value
 *       │
 *       ├─► meta.atoms.createdById  ← raw string
 *       │         │
 *       │         ▼
 *       │   userByIdFamily(userId)  ← resolves to UserInfo
 *       │         │
 *       │         ▼
 *       ├─► meta.atoms.createdBy    ← resolved UserInfo
 *       │
 *       ├─► meta.atoms.createdAt    ← raw ISO string
 *       ├─► meta.atoms.displayName  ← raw string
 *       └─► meta.atoms.version      ← coerced number
 * ```
 *
 * ## Field Mapping
 *
 * Entities store common concepts under different field names. The field map
 * tells this mixin where to find each concept:
 *
 * | Concept      | Default Field    | Override Example        |
 * |-------------|------------------|------------------------|
 * | Creator ID  | `created_by_id`  | `author` (revisions)   |
 * | Created At  | `created_at`     | `start_time` (traces)  |
 * | Name        | `name`           | `span_name` (traces)   |
 * | Version     | `version`        | —                      |
 *
 * Set a field to `null` to indicate the entity doesn't have that concept.
 *
 * @module shared/molecule/withEntityMeta
 */

import {atom, type Atom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"
import {atomFamily} from "jotai-family"

import {userByIdFamily, type UserInfo} from "../user/atoms"

import type {
    EntityMetaAtoms,
    EntityMetaCapability,
    EntityMetaFieldMap,
    EntityMetaGetters,
    Molecule,
    StoreOptions,
} from "./types"

// ============================================================================
// DEFAULTS
// ============================================================================

/**
 * Default field mapping — matches the standard `ServerEntityFields` shape
 * and the backend's `Lifecycle` + `Header` + `Slug` + `Version` mixins.
 */
const DEFAULT_FIELD_MAP: Required<Record<keyof EntityMetaFieldMap, string | null>> = {
    createdById: "created_by_id",
    updatedById: "updated_by_id",
    createdAt: "created_at",
    updatedAt: "updated_at",
    name: "name",
    version: "version",
    slug: "slug",
    description: "description",
}

// ============================================================================
// FIELD RESOLUTION
// ============================================================================

/**
 * Resolve a field value from entity data using the configured field path.
 *
 * Supports:
 * - Simple paths: `"created_by_id"` → `data.created_by_id`
 * - Dot-notation paths: `"data.author"` → `data.data.author`
 * - Null field (concept not available): returns `null`
 * - Missing data: returns `null`
 *
 * @param data - The entity data object
 * @param fieldPath - The field path to resolve, or `null` if not applicable
 * @returns The resolved value, or `null`
 */
function resolveField(data: unknown, fieldPath: string | null): unknown {
    if (!data || fieldPath === null) return null

    // Simple path (most common case — no dots)
    if (!fieldPath.includes(".")) {
        return (data as Record<string, unknown>)[fieldPath] ?? null
    }

    // Dot-notation path traversal
    let current: unknown = data
    for (const segment of fieldPath.split(".")) {
        if (current === null || current === undefined || typeof current !== "object") {
            return null
        }
        current = (current as Record<string, unknown>)[segment]
    }
    return current ?? null
}

/**
 * Coerce a value to string or null.
 * Handles string, number (converts to string), null, and undefined.
 */
function toStringOrNull(value: unknown): string | null {
    if (typeof value === "string" && value.length > 0) return value
    if (typeof value === "number") return String(value)
    return null
}

/**
 * Coerce a value to number or null.
 * Handles number, numeric string, null, and undefined.
 */
function toNumberOrNull(value: unknown): number | null {
    if (typeof value === "number" && !Number.isNaN(value)) return value
    if (typeof value === "string") {
        const parsed = Number(value)
        if (!Number.isNaN(parsed)) return parsed
    }
    return null
}

// ============================================================================
// ATOM FACTORIES
// ============================================================================

/**
 * Create a string-valued meta atom family that reads from entity data.
 */
function createStringMetaAtom(
    dataAtomFamily: (id: string) => ReturnType<typeof atom>,
    fieldPath: string | null,
) {
    return atomFamily((id: string) =>
        atom<string | null>((get) => {
            if (fieldPath === null) return null
            const data = get(dataAtomFamily(id))
            return toStringOrNull(resolveField(data, fieldPath))
        }),
    )
}

/**
 * Create a number-valued meta atom family that reads from entity data.
 */
function createNumberMetaAtom(
    dataAtomFamily: (id: string) => ReturnType<typeof atom>,
    fieldPath: string | null,
) {
    return atomFamily((id: string) =>
        atom<number | null>((get) => {
            if (fieldPath === null) return null
            const data = get(dataAtomFamily(id))
            return toNumberOrNull(resolveField(data, fieldPath))
        }),
    )
}

/**
 * Create a user-resolving meta atom family.
 * Reads a user ID field from entity data, then resolves it via userByIdFamily.
 */
function createUserMetaAtom(
    dataAtomFamily: (id: string) => ReturnType<typeof atom>,
    fieldPath: string | null,
) {
    return atomFamily((id: string) =>
        atom<UserInfo | null>((get) => {
            if (fieldPath === null) return null
            const data = get(dataAtomFamily(id))
            const userId = toStringOrNull(resolveField(data, fieldPath))
            if (!userId) return null
            return get(userByIdFamily(userId))
        }),
    )
}

// ============================================================================
// IMPERATIVE GETTER FACTORY
// ============================================================================

/**
 * Create an imperative getter that reads from a meta atom.
 */
function createMetaGetter<T>(
    metaAtomFamily: (id: string) => Atom<T>,
): (id: string, options?: StoreOptions) => T {
    return (id: string, options?: StoreOptions) => {
        const store = options?.store ?? getDefaultStore()
        return store.get(metaAtomFamily(id))
    }
}

// ============================================================================
// MAIN FACTORY
// ============================================================================

/**
 * Extend a molecule with entity meta capability.
 *
 * Creates derived read-only atoms for common entity fields (creator, dates,
 * name, version) with automatic user resolution. The field mapping is
 * configurable to handle entities with non-standard field names.
 *
 * @param molecule - The base molecule to extend
 * @param fieldMap - Optional field name overrides (defaults to ServerEntityFields naming)
 * @returns The molecule extended with a `meta` property
 *
 * @example
 * ```typescript
 * // Standard fields (workflow, testset, testcase)
 * const extended = withEntityMeta(workflowMolecule)
 *
 * // Custom field mapping (revision uses "author" for creator)
 * const extended = withEntityMeta(revisionMolecule, {
 *     createdById: "author",
 * })
 *
 * // Entity without certain concepts
 * const extended = withEntityMeta(traceSpanMolecule, {
 *     createdAt: "start_time",
 *     name: "span_name",
 *     updatedById: null,  // traces don't have this
 *     version: null,       // traces don't have this
 *     slug: null,          // traces don't have this
 * })
 *
 * // Use in components
 * const creator = useAtomValue(extended.meta.atoms.createdBy(entityId))
 * // → { id: "user-123", username: "johndoe", name: "John Doe", email: "..." }
 *
 * const name = useAtomValue(extended.meta.atoms.displayName(entityId))
 * // → "My Workflow"
 *
 * // Use in callbacks (imperative)
 * const creatorName = extended.meta.get.createdBy(entityId)?.username
 * ```
 */
export function withEntityMeta<T extends object>(
    molecule: Molecule<T, unknown>,
    fieldMap?: EntityMetaFieldMap,
): typeof molecule & EntityMetaCapability {
    // Resolve field map with defaults
    const resolvedMap: Required<Record<keyof EntityMetaFieldMap, string | null>> = {
        ...DEFAULT_FIELD_MAP,
    }

    if (fieldMap) {
        for (const [key, value] of Object.entries(fieldMap)) {
            if (key in resolvedMap) {
                ;(resolvedMap as Record<string, string | null>)[key] = value
            }
        }
    }

    // Create atoms
    const dataFamily = molecule.atoms.data as unknown as (id: string) => ReturnType<typeof atom>

    const atoms: EntityMetaAtoms = {
        // User-resolving atoms
        createdBy: createUserMetaAtom(dataFamily, resolvedMap.createdById),
        updatedBy: createUserMetaAtom(dataFamily, resolvedMap.updatedById),

        // Raw ID atoms
        createdById: createStringMetaAtom(dataFamily, resolvedMap.createdById),
        updatedById: createStringMetaAtom(dataFamily, resolvedMap.updatedById),

        // Timestamp atoms
        createdAt: createStringMetaAtom(dataFamily, resolvedMap.createdAt),
        updatedAt: createStringMetaAtom(dataFamily, resolvedMap.updatedAt),

        // Display fields
        displayName: createStringMetaAtom(dataFamily, resolvedMap.name),
        version: createNumberMetaAtom(dataFamily, resolvedMap.version),
        slug: createStringMetaAtom(dataFamily, resolvedMap.slug),
        description: createStringMetaAtom(dataFamily, resolvedMap.description),
    }

    // Create imperative getters
    const getters: EntityMetaGetters = {
        createdBy: createMetaGetter<UserInfo | null>(atoms.createdBy),
        updatedBy: createMetaGetter<UserInfo | null>(atoms.updatedBy),
        createdById: createMetaGetter<string | null>(atoms.createdById),
        updatedById: createMetaGetter<string | null>(atoms.updatedById),
        createdAt: createMetaGetter<string | null>(atoms.createdAt),
        updatedAt: createMetaGetter<string | null>(atoms.updatedAt),
        displayName: createMetaGetter<string | null>(atoms.displayName),
        version: createMetaGetter<number | null>(atoms.version),
        slug: createMetaGetter<string | null>(atoms.slug),
        description: createMetaGetter<string | null>(atoms.description),
    }

    // Compose with the original molecule
    return {
        ...molecule,
        meta: {
            atoms,
            get: getters,
            fieldMap: resolvedMap,
        },
    }
}
