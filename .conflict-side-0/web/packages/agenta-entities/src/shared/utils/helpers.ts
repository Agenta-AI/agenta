/**
 * Molecule Utilities
 *
 * Helper functions for cache management, molecule composition, and strict typing.
 */

import {atom} from "jotai"
import type {Atom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"

import type {
    CacheConfig,
    LocalMolecule,
    Molecule,
    MoleculeRelation,
    StoreOptions,
} from "../molecule/types"

// ============================================================================
// CACHE UTILITIES
// ============================================================================

/**
 * Creates a cache configuration for a molecule.
 *
 * @example
 * ```typescript
 * const testcaseCache = createCacheConfig<Testcase>({
 *   queryClient,
 *   queryKeyPrefix: ['testcase'],
 * })
 *
 * // Populate cache from parent query
 * testcaseCache.populateFrom(testcase)
 *
 * // Get from cache without fetch
 * const cached = testcaseCache.getFromCache('tc-123')
 * ```
 */
export function createCacheConfig<T>(options: {
    /** TanStack Query client */
    queryClient: {
        getQueryData: (key: unknown[]) => T | undefined
        setQueryData: (key: unknown[], data: T) => void
        invalidateQueries: (options: {queryKey: unknown[]}) => Promise<void>
    }
    /** Prefix for query keys */
    queryKeyPrefix: string[]
    /** Extract ID from entity */
    getId?: (entity: T) => string
}): CacheConfig<T> {
    // Default getId assumes entity has an 'id' field (common pattern)
    const {queryClient, queryKeyPrefix, getId = (e: T) => (e as {id: string}).id} = options

    return {
        keys: {
            primary: (id: string) => [...queryKeyPrefix, id],
        },

        populateFrom: (data: T) => {
            const id = getId(data)
            queryClient.setQueryData([...queryKeyPrefix, id], data)
        },

        getFromCache: (id: string) => {
            return queryClient.getQueryData([...queryKeyPrefix, id]) ?? null
        },

        setInCache: (id: string, data: T) => {
            queryClient.setQueryData([...queryKeyPrefix, id], data)
        },

        invalidate: async (id: string) => {
            await queryClient.invalidateQueries({queryKey: [...queryKeyPrefix, id]})
        },

        invalidateAll: async () => {
            await queryClient.invalidateQueries({queryKey: queryKeyPrefix})
        },
    }
}

/**
 * Populate child molecule cache from parent data.
 * Use when parent query includes embedded child data.
 *
 * @example
 * ```typescript
 * // When revision is fetched with embedded testcases
 * populateChildCache({
 *   parentData: revision,
 *   childDataPath: (r) => r.data?.testcases,
 *   childMolecule: testcaseMolecule,
 *   childIdField: 'id',
 * })
 * ```
 */
export function populateChildCache<TParent, TChild>(options: {
    /** Parent entity data */
    parentData: TParent
    /** Path to child data array in parent */
    childDataPath: (parent: TParent) => TChild[] | undefined
    /** Child molecule (server or local) */
    childMolecule: Molecule<TChild, unknown> | LocalMolecule<TChild>
    /** Field name for child ID */
    childIdField?: keyof TChild
    /** Store options */
    storeOptions?: StoreOptions
}): string[] {
    const {parentData, childDataPath, childMolecule, childIdField = "id" as keyof TChild} = options

    const children = childDataPath(parentData)
    if (!children || !Array.isArray(children)) return []

    const ids: string[] = []

    for (const child of children) {
        const id = String(child[childIdField])
        ids.push(id)

        // For local molecules, use createWithId
        if ("source" in childMolecule && childMolecule.source === "local") {
            ;(childMolecule as LocalMolecule<TChild>).set.createWithId(id, child)
        }
        // For server molecules, we can't directly populate without cache config
        // The caller should use the molecule's cache.setInCache if available
    }

    return ids
}

// ============================================================================
// MOLECULE COMPOSITION
// ============================================================================

/**
 * Creates a relation between two molecules.
 * Use this to define parent-child relationships.
 *
 * @example
 * ```typescript
 * const testcaseRelation = createRelation({
 *   name: 'testcases',
 *   childIdsPath: (revision) => revision.data?.testcase_ids ?? [],
 *   childDataPath: (revision) => revision.data?.testcases,
 *   childMolecule: testcaseMolecule,
 *   mode: 'populate', // Auto-populate child cache from embedded data
 * })
 * ```
 */
export function createRelation<TParent, TChild>(
    config: MoleculeRelation<TParent, TChild>,
): MoleculeRelation<TParent, TChild> {
    return config
}

/**
 * Get child IDs from parent data using a relation config.
 */
export function getChildIds<TParent, TChild>(
    parent: TParent | null,
    relation: MoleculeRelation<TParent, TChild>,
): string[] {
    if (!parent) return []

    if (typeof relation.childIdsPath === "function") {
        return relation.childIdsPath(parent)
    }

    // Dot-path navigation - traverse unknown object structure
    const path = relation.childIdsPath.split(".")
    let value: unknown = parent
    for (const key of path) {
        if (typeof value !== "object" || value === null) return []
        value = (value as Record<string, unknown>)[key]
        if (value === undefined) return []
    }

    return Array.isArray(value) ? value : []
}

/**
 * Get embedded child data from parent using a relation config.
 */
export function getChildData<TParent, TChild>(
    parent: TParent | null,
    relation: MoleculeRelation<TParent, TChild>,
): TChild[] {
    if (!parent || !relation.childDataPath) return []

    if (typeof relation.childDataPath === "function") {
        return relation.childDataPath(parent) ?? []
    }

    // Dot-path navigation - traverse unknown object structure
    const path = relation.childDataPath.split(".")
    let value: unknown = parent
    for (const key of path) {
        if (typeof value !== "object" || value === null) return []
        value = (value as Record<string, unknown>)[key]
        if (value === undefined) return []
    }

    return Array.isArray(value) ? value : []
}

/**
 * Creates an atom that derives child IDs from parent molecule.
 *
 * @example
 * ```typescript
 * const testcaseIdsAtom = createChildIdsAtom(
 *   revisionMolecule,
 *   revisionId,
 *   testcaseRelation
 * )
 *
 * // In component
 * const testcaseIds = useAtomValue(testcaseIdsAtom)
 * ```
 */
export function createChildIdsAtom<TParent, TChild>(
    parentMolecule: Molecule<TParent, unknown>,
    parentId: string,
    relation: MoleculeRelation<TParent, TChild>,
): Atom<string[]> {
    return atom((get) => {
        const parent = get(parentMolecule.atoms.data(parentId))
        return getChildIds(parent, relation)
    })
}

/**
 * Creates an atom that derives child entities from parent molecule.
 * If mode is 'populate', will use embedded data from parent.
 * If mode is 'reference', will read from child molecule.
 *
 * @example
 * ```typescript
 * const testcasesAtom = createChildrenAtom(
 *   revisionMolecule,
 *   revisionId,
 *   testcaseMolecule,
 *   testcaseRelation
 * )
 *
 * // In component
 * const testcases = useAtomValue(testcasesAtom)
 * ```
 */
export function createChildrenAtom<TParent, TChild>(
    parentMolecule: Molecule<TParent, unknown>,
    parentId: string,
    childMolecule: Molecule<TChild, unknown> | LocalMolecule<TChild>,
    relation: MoleculeRelation<TParent, TChild>,
): Atom<(TChild | null)[]> {
    return atom((get) => {
        const parent = get(parentMolecule.atoms.data(parentId))
        if (!parent) return []

        // If mode is 'populate' and we have embedded data, use it
        if (relation.mode === "populate" && relation.childDataPath) {
            const embedded = getChildData(parent, relation)
            if (embedded.length > 0) {
                return embedded
            }
        }

        // Otherwise, read from child molecule by IDs
        const ids = getChildIds(parent, relation)
        return ids.map((id) => get(childMolecule.atoms.data(id)))
    })
}

// ============================================================================
// STRICT TYPING UTILITIES
// ============================================================================

/**
 * Type guard to ensure an object has all required fields of a type.
 * Useful for runtime validation of API responses.
 *
 * @example
 * ```typescript
 * const data = await fetchTestcase(id)
 * if (hasRequiredFields(data, ['id', 'data'])) {
 *   // TypeScript knows data has id and data fields
 * }
 * ```
 */
export function hasRequiredFields<T, K extends keyof T>(
    obj: unknown,
    fields: K[],
): obj is Pick<T, K> {
    if (!obj || typeof obj !== "object") return false
    return fields.every((field) => field in obj)
}

/**
 * Assert that a value matches a Zod schema.
 * Throws if validation fails.
 *
 * @example
 * ```typescript
 * const validatedTestcase = assertSchema(rawData, testcaseSchema)
 * // TypeScript knows validatedTestcase is Testcase type
 * ```
 */
export function assertSchema<T>(data: unknown, schema: {parse: (data: unknown) => T}): T {
    return schema.parse(data)
}

/**
 * Safely parse data with a Zod schema, returning null on failure.
 *
 * @example
 * ```typescript
 * const testcase = safeParseSchema(rawData, testcaseSchema)
 * if (testcase) {
 *   // TypeScript knows testcase is Testcase type
 * }
 * ```
 */
export function safeParseSchema<T>(
    data: unknown,
    schema: {
        safeParse: (data: unknown) => {success: true; data: T} | {success: false; error: unknown}
    },
): T | null {
    const result = schema.safeParse(data)
    return result.success ? result.data : null
}

// ============================================================================
// ID UTILITIES
// ============================================================================

/**
 * Check if an ID is a local (client-only) ID.
 */
export function isLocalId(id: string): boolean {
    return id.startsWith("local-") || id.startsWith("new-")
}

/**
 * Check if an ID is a server ID (UUID format).
 */
export function isServerId(id: string): boolean {
    // UUID v4 pattern
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    return uuidPattern.test(id)
}

/**
 * Generate a local ID with optional prefix.
 */
export function generateLocalId(prefix = "local"): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// ============================================================================
// BATCH UTILITIES
// ============================================================================

/**
 * Batch update multiple entities in a molecule.
 *
 * @example
 * ```typescript
 * batchUpdate(testcaseMolecule, [
 *   { id: 'tc-1', changes: { data: { country: 'USA' } } },
 *   { id: 'tc-2', changes: { data: { country: 'UK' } } },
 * ])
 * ```
 */
export function batchUpdate<T, TDraft>(
    molecule: Molecule<T, TDraft>,
    updates: {id: string; changes: TDraft}[],
    options?: StoreOptions,
): void {
    const store = options?.store ?? getDefaultStore()
    for (const {id, changes} of updates) {
        store.set(molecule.reducers.update, id, changes)
    }
}

/**
 * Batch create local entities.
 *
 * @example
 * ```typescript
 * const ids = batchCreate(localTestcaseMolecule, [
 *   { data: { country: 'USA' } },
 *   { data: { country: 'UK' } },
 * ])
 * ```
 */
export function batchCreate<T>(
    molecule: LocalMolecule<T>,
    items: Partial<T>[],
    options?: StoreOptions,
): string[] {
    return items.map((data) => molecule.set.create(data, options))
}

/**
 * Batch delete entities from a local molecule.
 */
export function batchDelete<T>(
    molecule: LocalMolecule<T>,
    ids: string[],
    options?: StoreOptions,
): void {
    for (const id of ids) {
        molecule.set.delete(id, options)
    }
}
