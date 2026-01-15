import {
    atom,
    type Atom,
    type Getter,
    type PrimitiveAtom,
    type Setter,
    type WritableAtom,
} from "jotai"
import {atomFamily} from "jotai-family"

// Interface for atom family created by jotai-family (includes memory management methods)
interface JotaiFamilyAtomFamily<T, P = string> {
    (param: P): T
    remove: (param: P) => void
    setShouldRemove: (fn: ((createdAt: number, param: P) => boolean) | null) => void
    getParams: () => Iterable<P>
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for creating entity draft state
 */
export interface EntityDraftStateConfig<TEntity, TDraftableData> {
    /**
     * The base entity atom family to read from (server state)
     */
    entityAtomFamily: (id: string) => Atom<TEntity | null>

    /**
     * Extract the draftable portion of the entity
     * For testcase: (entity) => entity (entire entity is draftable)
     * For trace: (entity) => entity.attributes (only attributes are draftable)
     */
    getDraftableData: (entity: TEntity) => TDraftableData

    /**
     * Merge draft changes back into the full entity
     * For testcase: (entity, draft) => ({...entity, ...draft})
     * For trace: (entity, draft) => ({...entity, attributes: {...entity.attributes, ...draft}})
     */
    mergeDraft: (entity: TEntity, draft: Partial<TDraftableData>) => TEntity

    /**
     * Custom dirty comparison logic (optional)
     * If not provided, uses default field-by-field comparison
     * Return true if draft differs from original
     */
    isDirty?: (
        draftData: TDraftableData,
        originalData: TDraftableData,
        context: {
            get: Getter
            id: string
        },
    ) => boolean

    /**
     * Fields to exclude from default dirty comparison
     * Only used if isDirty is not provided
     */
    excludeFields?: Set<string>
}

/**
 * Return type from createEntityDraftState factory
 * Uses JotaiFamilyAtomFamily to expose jotai-family's memory management methods (remove, setShouldRemove, getParams)
 */
export interface EntityDraftState<TEntity, TDraftableData> {
    /**
     * Draft atom family - stores local edits as complete merged data
     * null = no local edits, otherwise contains the full draftable data with edits merged
     * Returns a writable PrimitiveAtom that can be set directly
     * Includes jotai-family methods: remove, setShouldRemove, getParams
     */
    draftAtomFamily: JotaiFamilyAtomFamily<PrimitiveAtom<TDraftableData | null>>

    /**
     * Combined entity + draft atom family
     * Returns draft merged over entity if draft exists, otherwise entity
     * Includes jotai-family methods: remove, setShouldRemove, getParams
     */
    withDraftAtomFamily: JotaiFamilyAtomFamily<Atom<TEntity | null>>

    /**
     * Check if entity has local edits (draft exists)
     * Includes jotai-family methods: remove, setShouldRemove, getParams
     */
    hasDraftAtomFamily: JotaiFamilyAtomFamily<Atom<boolean>>

    /**
     * Check if entity is dirty (draft exists AND differs from original)
     * Includes jotai-family methods: remove, setShouldRemove, getParams
     */
    isDirtyAtomFamily: JotaiFamilyAtomFamily<Atom<boolean>>

    /**
     * Update entity (creates/updates draft)
     */
    updateAtom: WritableAtom<unknown, [id: string, updates: Partial<TDraftableData>], void>

    /**
     * Discard local edits for an entity
     */
    discardDraftAtom: WritableAtom<unknown, [id: string], void>
}

// ============================================================================
// SHARED UTILITIES
// ============================================================================

/**
 * Sort object keys recursively for consistent comparison
 */
function sortObjectKeys(obj: unknown): unknown {
    if (obj === null || obj === undefined) {
        return obj
    }

    if (Array.isArray(obj)) {
        return obj.map(sortObjectKeys)
    }

    if (typeof obj === "object") {
        const sorted: Record<string, unknown> = {}
        const keys = Object.keys(obj).sort()
        for (const key of keys) {
            sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key])
        }
        return sorted
    }

    return obj
}

/**
 * Normalize a value for comparison - handles object vs string JSON comparison
 * Returns a canonical string representation for comparison
 */
export function normalizeValueForComparison(value: unknown): string {
    if (value === undefined || value === null || value === "") return ""

    // If it's already a string, try to parse it as JSON for normalization
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value)
            // Sort keys and re-stringify to get canonical form
            const sorted = sortObjectKeys(parsed)
            return JSON.stringify(sorted)
        } catch {
            // Not valid JSON, return as-is
            return value
        }
    }

    // If it's an object/array, sort keys and stringify
    if (typeof value === "object") {
        const sorted = sortObjectKeys(value)
        return JSON.stringify(sorted)
    }

    // For primitives (number, boolean), convert to string
    return String(value)
}

/**
 * Default dirty comparison - field-by-field comparison with normalization
 */
function defaultIsDirty<T>(draftData: T, originalData: T, excludeFields?: Set<string>): boolean {
    const draftRecord = draftData as Record<string, unknown>
    const originalRecord = originalData as Record<string, unknown>

    // Check draft keys against original
    for (const key of Object.keys(draftRecord)) {
        if (excludeFields?.has(key)) continue

        const draftValue = draftRecord[key]
        const originalValue = originalRecord[key]

        const normalizedDraft = normalizeValueForComparison(draftValue)
        const normalizedOriginal = normalizeValueForComparison(originalValue)

        if (normalizedDraft !== normalizedOriginal) {
            return true
        }
    }

    // Check original keys not in draft
    for (const key of Object.keys(originalRecord)) {
        if (excludeFields?.has(key)) continue

        if (!(key in draftRecord)) {
            const originalValue = originalRecord[key]
            if (originalValue !== undefined && originalValue !== null && originalValue !== "") {
                return true
            }
        }
    }

    return false
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create entity draft state management atoms
 *
 * This factory generates a complete set of atoms for managing local edits
 * (draft state) on top of an entity's server state.
 *
 * @example
 * ```typescript
 * // For testcase entity (entire entity is draftable)
 * const testcaseDraftState = createEntityDraftState<FlattenedTestcase, FlattenedTestcase>({
 *   entityAtomFamily: testcaseQueryAtomFamily,
 *   getDraftableData: (entity) => entity,
 *   mergeDraft: (entity, draft) => ({...entity, ...draft}),
 *   excludeFields: DIRTY_EXCLUDE_FIELDS,
 *   // Custom isDirty for complex testcase logic
 *   isDirty: (draft, original, {get, id}) => { ... }
 * })
 *
 * // For trace entity (only attributes are draftable)
 * const traceDraftState = createEntityDraftState<TraceSpan, TraceSpanAttributes>({
 *   entityAtomFamily: traceSpanAtomFamily,
 *   getDraftableData: (span) => span.attributes || {},
 *   mergeDraft: (span, draft) => ({...span, attributes: {...span.attributes, ...draft}}),
 *   isDirty: (draftAttrs, originalAttrs) => {
 *     return normalizeValueForComparison(draftAttrs) !==
 *            normalizeValueForComparison(originalAttrs)
 *   }
 * })
 * ```
 */
export function createEntityDraftState<TEntity, TDraftableData = TEntity>(
    config: EntityDraftStateConfig<TEntity, TDraftableData>,
): EntityDraftState<TEntity, TDraftableData> {
    const {entityAtomFamily, getDraftableData, mergeDraft, isDirty, excludeFields} = config

    // Draft atom family - stores complete merged data (not partial)
    // When we update, we merge updates into the current entity and store the full result
    // atomFamily from jotai-family includes remove, setShouldRemove, getParams methods
    // Cast through unknown because atomFamily's type inference loses PrimitiveAtom's write signature
    const draftAtomFamily = atomFamily((_id: string) =>
        atom<TDraftableData | null>(null),
    ) as unknown as JotaiFamilyAtomFamily<PrimitiveAtom<TDraftableData | null>>

    // Combined entity + draft atom family
    // Since draft contains complete merged data, we can use it directly
    const withDraftAtomFamily = atomFamily((id: string) =>
        atom((get): TEntity | null => {
            const draft = get(draftAtomFamily(id))
            const entity = get(entityAtomFamily(id))

            if (!entity) return null
            if (!draft) return entity

            // Draft contains complete draftable data, merge it with entity structure
            return mergeDraft(entity, draft as Partial<TDraftableData>)
        }),
    )

    // Has draft atom family
    const hasDraftAtomFamily = atomFamily((id: string) =>
        atom((get): boolean => {
            const draft = get(draftAtomFamily(id))
            return draft !== null
        }),
    )

    // Is dirty atom family
    const isDirtyAtomFamily = atomFamily((id: string) =>
        atom((get): boolean => {
            const draft = get(draftAtomFamily(id))
            const original = get(entityAtomFamily(id))

            // No draft = not dirty
            if (!draft) return false

            // No original = can't compare, consider dirty if draft has data
            if (!original) {
                // For new entities, check if draft has any meaningful data
                const draftRecord = draft as Record<string, unknown>
                for (const [key, value] of Object.entries(draftRecord)) {
                    if (excludeFields?.has(key)) continue
                    if (value !== undefined && value !== null && value !== "") {
                        return true
                    }
                }
                return false
            }

            // Get draftable data portions
            const originalData = getDraftableData(original)
            // Draft already contains complete merged data
            const currentData = draft

            // Use custom isDirty if provided
            if (isDirty) {
                return isDirty(currentData, originalData, {get, id})
            }

            // Fall back to default field-by-field comparison
            return defaultIsDirty(currentData, originalData, excludeFields)
        }),
    )

    // Update atom - creates/updates draft
    // Signature: (id: string, updates: Partial<TDraftableData>) => void
    // This matches the standard entity controller pattern.
    const updateAtom = atom(
        null,
        (get: Getter, set: Setter, id: string, updates: Partial<TDraftableData>) => {
            const current = get(withDraftAtomFamily(id))
            if (!current) return

            const currentData = getDraftableData(current)
            const updated = {...currentData, ...updates}

            // Get original entity to check if we need to keep the draft
            const original = get(entityAtomFamily(id))
            if (original) {
                const originalData = getDraftableData(original)

                // Check if updated data matches original - if so, clear draft instead of storing it
                const isMatchingOriginal = isDirty
                    ? !isDirty(updated, originalData, {get, id})
                    : !defaultIsDirty(updated, originalData, excludeFields)

                if (isMatchingOriginal) {
                    // Clear draft since changes match original
                    set(draftAtomFamily(id), null)
                    return
                }
            }

            set(draftAtomFamily(id), updated)
        },
    )

    // Discard draft atom
    const discardDraftAtom = atom(null, (get: Getter, set: Setter, id: string) => {
        set(draftAtomFamily(id), null)
    })

    return {
        draftAtomFamily,
        withDraftAtomFamily,
        hasDraftAtomFamily,
        isDirtyAtomFamily,
        updateAtom,
        discardDraftAtom,
    }
}
