/**
 * OssAppRevision Entity Store
 *
 * Provides atoms for OSS app revision entity state:
 * - Query atom (server data)
 * - Draft atom (local edits)
 * - Entity atom (merged data)
 * - Dirty state atom
 *
 * Uses the legacy backend API endpoints.
 *
 * @packageDocumentation
 */

import {projectIdAtom} from "@agenta/shared/state"
import {produce} from "immer"
import {atom} from "jotai"
import type {Atom, WritableAtom} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {extractVariablesFromAgConfig} from "../../runnable/utils"
import type {QueryState} from "../../shared"
import type {ListQueryState} from "../../shared"
import {isLocalDraftId} from "../../shared"
import {
    fetchOssRevisionById,
    fetchOssRevisionEnriched,
    fetchVariantDetail,
    fetchVariantsList,
    fetchRevisionsList,
    fetchAppsList,
    type AppListItem,
    type VariantListItem,
    type RevisionListItem,
    type VariantDetail,
} from "../api"
import type {OssAppRevisionData} from "../core"

// ============================================================================
// INPUT PORTS TYPE
// ============================================================================

/**
 * Input port type for ossAppRevision
 * Represents a variable expected by the prompt template
 */
export interface OssAppRevisionInputPort {
    /** Unique key for the input (variable name) */
    key: string
    /** Display name */
    name: string
    /** Data type */
    type: "string"
    /** Whether this input is required */
    required: boolean
}

// ============================================================================
// VARIANT CONTEXT (for enrichment)
// ============================================================================

/**
 * Variant context key for enriched queries
 * Format: "revisionId:variantId"
 */
export interface EnrichedQueryKey {
    revisionId: string
    variantId: string
}

/**
 * Parse enriched query key
 */
function parseEnrichedKey(key: string): EnrichedQueryKey | null {
    const [revisionId, variantId] = key.split(":")
    if (!revisionId || !variantId) return null
    return {revisionId, variantId}
}

/**
 * Create enriched query key
 */
export function createEnrichedKey(revisionId: string, variantId: string): string {
    return `${revisionId}:${variantId}`
}

/**
 * Variant detail cache atom family
 * Caches variant details (including URI) by variant ID
 */
export const variantDetailCacheAtomFamily = atomFamily((variantId: string) =>
    atomWithQuery<VariantDetail | null>((get) => {
        const projectId = get(projectIdAtom)
        const enabled = !!variantId && !!projectId

        return {
            queryKey: ["variantDetail", variantId, projectId],
            queryFn: () => fetchVariantDetail(variantId, projectId!),
            staleTime: 1000 * 60 * 5, // 5 minutes - variants don't change often
            refetchOnWindowFocus: false,
            enabled,
        }
    }),
)

/**
 * Variant context atom family
 * Stores the variantId associated with each revision for enriched queries.
 * This is set when a revision is selected/loaded in the UI.
 */
export const revisionVariantContextAtomFamily = atomFamily((_revisionId: string) =>
    atom<string | null>(null),
)

/**
 * Set variant context for a revision
 */
export const setRevisionVariantContextAtom = atom(
    null,
    (_get, set, revisionId: string, variantId: string | null) => {
        set(revisionVariantContextAtomFamily(revisionId), variantId)
    },
)

// ============================================================================
// QUERY ATOM FAMILY
// ============================================================================

/**
 * Direct query atom family that fetches revision data from legacy API.
 *
 * Uses POST /variants/revisions/query/ to fetch by revision ID.
 * Returns minimal data without URI enrichment.
 * Skips queries for local draft IDs.
 */
const directQueryAtomFamily = atomFamily((revisionId: string) =>
    atomWithQuery<OssAppRevisionData | null>((get) => {
        const projectId = get(projectIdAtom)
        // Skip queries for local draft IDs - they don't exist on the server
        const isLocal = isLocalDraftId(revisionId)
        const enabled = !!revisionId && !!projectId && !isLocal

        return {
            queryKey: ["ossAppRevision", revisionId, projectId],
            queryFn: () => fetchOssRevisionById(revisionId, projectId!),
            staleTime: 1000 * 60, // 1 minute
            refetchOnWindowFocus: false,
            enabled,
        }
    }),
)

/**
 * Enriched query atom family that fetches revision + variant data.
 *
 * Key format: "revisionId:variantId"
 * Returns complete data with URI, appId, variantId, variantName.
 * Skips queries for local draft IDs.
 */
export const enrichedQueryAtomFamily = atomFamily((key: string) =>
    atomWithQuery<OssAppRevisionData | null>((get) => {
        const projectId = get(projectIdAtom)
        const parsed = parseEnrichedKey(key)
        // Skip queries for local draft IDs
        const isLocal = parsed ? isLocalDraftId(parsed.revisionId) : false
        const enabled = !!parsed && !!projectId && !isLocal

        return {
            queryKey: ["ossAppRevisionEnriched", key, projectId],
            queryFn: async () => {
                if (!parsed || !projectId) return null
                return fetchOssRevisionEnriched(parsed.revisionId, parsed.variantId, projectId)
            },
            staleTime: 1000 * 60, // 1 minute
            refetchOnWindowFocus: false,
            enabled,
        }
    }),
)

/**
 * Query atom family - returns server data for a revision
 *
 * Uses legacy API via fetchOssRevisionById.
 * Returns QueryState format for consistency with entity patterns.
 */
export const ossAppRevisionQueryAtomFamily = atomFamily((revisionId: string) =>
    atom<QueryState<OssAppRevisionData>>((get) => {
        const query = get(directQueryAtomFamily(revisionId))

        if (query.isPending) {
            return {
                data: undefined,
                isPending: true,
                isError: false,
                error: null,
            }
        }

        if (query.isError || !query.data) {
            return {
                data: undefined,
                isPending: false,
                isError: query.isError,
                error: query.error ?? null,
            }
        }

        return {
            data: query.data,
            isPending: false,
            isError: false,
            error: null,
        }
    }),
)

// ============================================================================
// DRAFT ATOM (Local Edits)
// ============================================================================

/**
 * Draft state for local edits to OSS app revisions
 */
export const ossAppRevisionDraftAtomFamily = atomFamily((_revisionId: string) =>
    atom<OssAppRevisionData | null>(null),
)

/**
 * Helper to get a writable draft atom
 */
function getDraftAtom(
    revisionId: string,
): WritableAtom<OssAppRevisionData | null, [OssAppRevisionData | null], void> {
    return ossAppRevisionDraftAtomFamily(revisionId) as WritableAtom<
        OssAppRevisionData | null,
        [OssAppRevisionData | null],
        void
    >
}

const stripVolatileKeys = (value: unknown): unknown => {
    if (Array.isArray(value)) {
        return value.map(stripVolatileKeys)
    }
    if (value && typeof value === "object") {
        return Object.entries(value as Record<string, unknown>).reduce(
            (acc, [key, val]) => {
                if (key === "__id" || key === "__test") {
                    return acc
                }
                acc[key] = stripVolatileKeys(val)
                return acc
            },
            {} as Record<string, unknown>,
        )
    }
    return value
}

// ============================================================================
// ENTITY ATOM (Merged Data)
// ============================================================================

/**
 * Entity atom - returns draft if exists, otherwise server data
 */
export const ossAppRevisionEntityAtomFamily = atomFamily((revisionId: string) =>
    atom<OssAppRevisionData | null>((get) => {
        const draft = get(ossAppRevisionDraftAtomFamily(revisionId))
        if (draft) {
            return draft
        }

        const query = get(ossAppRevisionQueryAtomFamily(revisionId))
        return query.data ?? null
    }),
)

// ============================================================================
// DIRTY STATE
// ============================================================================

/**
 * Check if an OSS app revision has local changes
 */
export const ossAppRevisionIsDirtyAtomFamily = atomFamily((revisionId: string) =>
    atom<boolean>((get) => {
        const draft = get(ossAppRevisionDraftAtomFamily(revisionId))
        if (!draft) return false

        const query = get(ossAppRevisionQueryAtomFamily(revisionId))
        if (!query.data) return true // New entity

        // Compare draft with server data
        return JSON.stringify(draft) !== JSON.stringify(query.data)
    }),
)

// ============================================================================
// INPUT PORTS (derived from parameters)
// ============================================================================

/**
 * Derives input ports from the revision's parameters (ag_config).
 *
 * Extracts template variables ({{variableName}}) from prompt messages
 * and returns them as input port definitions.
 */
export const ossAppRevisionInputPortsAtomFamily = atomFamily((revisionId: string) =>
    atom<OssAppRevisionInputPort[]>((get) => {
        // Use merged entity (draft + server) for reactive updates
        const data = get(ossAppRevisionEntityAtomFamily(revisionId))
        if (!data) return []

        const parameters = data.parameters as Record<string, unknown> | undefined
        const dynamicKeys = extractVariablesFromAgConfig(parameters)

        return dynamicKeys.map((key) => ({
            key,
            name: key,
            type: "string" as const,
            required: true,
        }))
    }),
)

// ============================================================================
// LIST ATOMS
// ============================================================================

// Re-export types from API for convenience
export type {AppListItem, VariantListItem, RevisionListItem}

// ============================================================================
// VARIANTS QUERY ATOMS
// ============================================================================

/**
 * Query atom family for fetching variants
 */
export const variantsQueryAtomFamily = atomFamily((appId: string) =>
    atomWithQuery<VariantListItem[]>((get) => {
        const projectId = get(projectIdAtom)
        const enabled = !!projectId && !!appId

        return {
            queryKey: ["oss-variants-for-selection", appId, projectId],
            queryFn: () => fetchVariantsList(appId, projectId!),
            staleTime: 1000 * 60,
            refetchOnWindowFocus: false,
            enabled,
        }
    }),
)

/**
 * Variants list data atom - extracts data from query
 */
export const variantsListDataAtomFamily = atomFamily((appId: string) =>
    atom<VariantListItem[]>((get) => {
        const query = get(variantsQueryAtomFamily(appId))
        return (query.data ?? []) as VariantListItem[]
    }),
)

// ============================================================================
// REVISIONS QUERY ATOMS
// ============================================================================

/**
 * Query atom family for fetching revisions
 */
export const revisionsQueryAtomFamily = atomFamily((variantId: string) =>
    atomWithQuery<RevisionListItem[]>((get) => {
        const projectId = get(projectIdAtom)
        const enabled = !!projectId && !!variantId

        return {
            queryKey: ["oss-revisions-for-selection", variantId, projectId],
            queryFn: () => fetchRevisionsList(variantId, projectId!),
            staleTime: 1000 * 60,
            refetchOnWindowFocus: false,
            enabled,
        }
    }),
)

/**
 * Revisions list data atom - extracts data from query
 */
export const revisionsListDataAtomFamily = atomFamily((variantId: string) =>
    atom<RevisionListItem[]>((get) => {
        const query = get(revisionsQueryAtomFamily(variantId))
        return (query.data ?? []) as RevisionListItem[]
    }),
)

// ============================================================================
// APPS QUERY ATOMS
// ============================================================================

/**
 * Query atom for fetching apps list
 */
export const appsQueryAtom = atomWithQuery<AppListItem[]>((get) => {
    const projectId = get(projectIdAtom)
    const enabled = !!projectId

    return {
        queryKey: ["oss-apps-for-selection", projectId],
        queryFn: async () => fetchAppsList(projectId!),
        staleTime: 1000 * 60,
        refetchOnWindowFocus: false,
        enabled,
    }
})

/**
 * Apps list data atom - extracts data from query
 */
export const appsListDataAtom = atom<AppListItem[]>((get) => {
    const query = get(appsQueryAtom)
    return query.data ?? []
})

// ============================================================================
// APPS LIST (WITH OPTIONAL OVERRIDE)
// ============================================================================

type AppsListAtomType = ReturnType<typeof atom<AppListItem[]>>

let _appsListAtom: AppsListAtomType | null = null

/**
 * Set the apps list atom override.
 * Optional - defaults to package's appsListDataAtom.
 */
export function setAppsListAtom(appsAtom: AppsListAtomType): void {
    _appsListAtom = appsAtom
}

/**
 * Apps list atom - returns list of apps
 */
export const appsListAtom = atom<AppListItem[]>((get) => {
    if (_appsListAtom) {
        return get(_appsListAtom)
    }
    return get(appsListDataAtom)
})

// ============================================================================
// LIST ATOMS (BACKWARD COMPATIBLE WITH OVERRIDE)
// ============================================================================

type VariantsListAtomFamilyType = (appId: string) => ReturnType<typeof atom<VariantListItem[]>>
type RevisionsListAtomFamilyType = (
    variantId: string,
) => ReturnType<typeof atom<RevisionListItem[]>>

let _variantsListAtomFamily: VariantsListAtomFamilyType | null = null
let _revisionsListAtomFamily: RevisionsListAtomFamilyType | null = null

/**
 * Set the variants list atom family override.
 */
export function setVariantsListAtomFamily(family: VariantsListAtomFamilyType): void {
    _variantsListAtomFamily = family
}

/**
 * Set the revisions list atom family override.
 */
export function setRevisionsListAtomFamily(family: RevisionsListAtomFamilyType): void {
    _revisionsListAtomFamily = family
}

/**
 * Variants list atom family - returns variants for an app
 */
export const variantsListAtomFamily = atomFamily((appId: string) =>
    atom<VariantListItem[]>((get) => {
        if (_variantsListAtomFamily) {
            return get(_variantsListAtomFamily(appId))
        }
        return get(variantsListDataAtomFamily(appId))
    }),
)

/**
 * Variants list query-state atom family - returns ListQueryState for selection UIs.
 */
export const variantsListQueryStateAtomFamily = atomFamily((appId: string) =>
    atom<ListQueryState<VariantListItem>>((get) => {
        const query = get(variantsQueryAtomFamily(appId))
        return {
            data: query.data ?? [],
            isPending: query.isPending ?? false,
            isError: query.isError ?? false,
            error: query.error ?? null,
        }
    }),
)

/**
 * Revisions list atom family - returns revisions for a variant
 */
export const revisionsListAtomFamily = atomFamily((variantId: string) =>
    atom<RevisionListItem[]>((get) => {
        if (_revisionsListAtomFamily) {
            return get(_revisionsListAtomFamily(variantId))
        }
        return get(revisionsListDataAtomFamily(variantId))
    }),
)

/**
 * Revisions list query-state atom family - returns ListQueryState for selection UIs.
 */
export const revisionsListQueryStateAtomFamily = atomFamily((variantId: string) =>
    atom<ListQueryState<RevisionListItem>>((get) => {
        const query = get(revisionsQueryAtomFamily(variantId))
        return {
            data: query.data ?? [],
            isPending: query.isPending ?? false,
            isError: query.isError ?? false,
            error: query.error ?? null,
        }
    }),
)

// ============================================================================
// LIST COMPOSITION WITH LOCAL DRAFTS
// ============================================================================

/**
 * Special variant ID for the local drafts group.
 */
export const LOCAL_DRAFTS_VARIANT_ID = "__local_drafts__"

/**
 * Extended variant list item that can represent a local drafts group.
 */
export interface VariantListItemWithDrafts extends VariantListItem {
    /** Whether this is the local drafts pseudo-variant */
    isLocalDraftGroup?: boolean
    /** Number of local drafts (only for local drafts group) */
    _draftCount?: number
}

/**
 * Extended revision list item that can represent a local draft.
 */
export interface RevisionListItemWithDrafts extends RevisionListItem {
    /** Whether this is a local draft */
    isLocalDraft?: boolean
    /** Source revision ID this draft was cloned from */
    sourceRevisionId?: string | null
    /** Whether the draft has unsaved changes */
    isDirty?: boolean
}

// Forward declaration - will be imported from localDrafts.ts
// We use a lazy import pattern to avoid circular dependencies
// Using Atom<T> type to support both regular atoms and atomWithStorage

let _localDraftIdsAtom: Atom<string[]> | null = null
let _localDraftsListAtom: Atom<unknown[]> | null = null

/**
 * Set the local drafts atoms (called from localDrafts.ts to avoid circular deps)
 */
export function setLocalDraftsAtoms(idsAtom: Atom<string[]>, listAtom: Atom<unknown[]>): void {
    _localDraftIdsAtom = idsAtom
    _localDraftsListAtom = listAtom
}

/**
 * Variants list with local drafts - includes a "Local Drafts" pseudo-variant if drafts exist.
 *
 * This is the recommended atom for selection UIs that need to show local drafts.
 */
export const variantsListWithDraftsAtomFamily = atomFamily((appId: string) =>
    atom<ListQueryState<VariantListItemWithDrafts>>((get) => {
        const baseQuery = get(variantsQueryAtomFamily(appId))
        const variants: VariantListItemWithDrafts[] = []

        // Check for local drafts - use localDraftsListAtom which filters out stale IDs
        // (IDs in localStorage without corresponding data)
        if (_localDraftsListAtom) {
            const localDrafts = get(_localDraftsListAtom) as unknown[]
            if (localDrafts.length > 0) {
                // Add local drafts pseudo-variant at the top
                variants.push({
                    id: LOCAL_DRAFTS_VARIANT_ID,
                    name: "Local Drafts",
                    isLocalDraftGroup: true,
                    _draftCount: localDrafts.length,
                } as VariantListItemWithDrafts)
            }
        }

        // Add server variants
        if (baseQuery.data) {
            variants.push(...baseQuery.data)
        }

        return {
            data: variants,
            isPending: variants.length === 0 && (baseQuery.isPending ?? false),
            isError: baseQuery.isError ?? false,
            error: baseQuery.error ?? null,
        }
    }),
)

/**
 * Revisions list with local drafts - returns local drafts for __local_drafts__ variant.
 *
 * This is the recommended atom for selection UIs that need to show local drafts.
 */
export const revisionsListWithDraftsAtomFamily = atomFamily((variantId: string) =>
    atom<ListQueryState<RevisionListItemWithDrafts>>((get) => {
        // Handle local drafts pseudo-variant
        if (variantId === LOCAL_DRAFTS_VARIANT_ID && _localDraftsListAtom) {
            const localDrafts = get(_localDraftsListAtom) as {
                id: string
                data: OssAppRevisionData
                sourceRevisionId: string | null
                isDirty: boolean
            }[]

            const revisions: RevisionListItemWithDrafts[] = localDrafts.map((draft) => ({
                id: draft.id,
                revision: draft.data.revision ?? 0,
                variantId: draft.data.variantId ?? "",
                variantName: draft.data.variantName ?? "Draft",
                commitMessage: `Draft from v${draft.data.revision ?? 0}`,
                isLocalDraft: true,
                isDirty: draft.isDirty,
                sourceRevisionId: draft.sourceRevisionId,
                createdAt: new Date().toISOString(),
            }))

            return {
                data: revisions,
                isPending: false,
                isError: false,
                error: null,
            }
        }

        // Regular revisions from server
        const baseQuery = get(revisionsQueryAtomFamily(variantId))
        const revisions: RevisionListItemWithDrafts[] = (baseQuery.data ?? []).map((r) => ({
            ...r,
            isLocalDraft: false,
        }))

        return {
            data: revisions,
            isPending: baseQuery.isPending ?? false,
            isError: baseQuery.isError ?? false,
            error: baseQuery.error ?? null,
        }
    }),
)

// ============================================================================
// ENRICHED SERVER DATA (replaces bridge pattern)
// ============================================================================

/**
 * Get enriched server data for a revision.
 * Uses variant context to fetch complete data with URI.
 */
export const ossAppRevisionEnrichedDataFamily = atomFamily((revisionId: string) =>
    atom<OssAppRevisionData | null>((get) => {
        const variantId = get(revisionVariantContextAtomFamily(revisionId))

        // If we have variant context, use enriched query
        if (variantId) {
            const enrichedKey = createEnrichedKey(revisionId, variantId)
            const enrichedQuery = get(enrichedQueryAtomFamily(enrichedKey))
            if (enrichedQuery.data) {
                return enrichedQuery.data
            }
        }

        // Fall back to basic query (without URI enrichment)
        const query = get(ossAppRevisionQueryAtomFamily(revisionId))
        return query.data ?? null
    }),
)

/**
 * @deprecated Use setRevisionVariantContextAtom instead.
 * Legacy server data storage - kept for backward compatibility during migration.
 */
export const ossAppRevisionServerDataAtomFamily = atomFamily((_revisionId: string) =>
    atom<OssAppRevisionData | null>(null),
)

/**
 * @deprecated Use setRevisionVariantContextAtom to set variant context instead.
 * Set server data for a revision.
 */
export const setServerDataAtom = atom(
    null,
    (_get, set, revisionId: string, data: OssAppRevisionData) => {
        // Store the data in legacy atom for backward compatibility
        set(ossAppRevisionServerDataAtomFamily(revisionId), data)
        // Also set variant context if available
        if (data.variantId) {
            set(revisionVariantContextAtomFamily(revisionId), data.variantId)
        }
    },
)

/**
 * Clear server data and variant context for a revision.
 */
export const clearServerDataAtom = atom(null, (_get, set, revisionId: string) => {
    set(ossAppRevisionServerDataAtomFamily(revisionId), null)
    set(revisionVariantContextAtomFamily(revisionId), null)
    set(getDraftAtom(revisionId), null)
})

/**
 * Entity atom with enrichment support.
 * Prefers: draft → merged server data (enriched + enhanced properties)
 */
export const ossAppRevisionEntityWithBridgeAtomFamily = atomFamily((revisionId: string) =>
    atom<OssAppRevisionData | null>((get) => {
        // Check draft first
        const draft = get(ossAppRevisionDraftAtomFamily(revisionId))
        if (draft) {
            return draft
        }

        // Use server data selector which merges enriched data with enhanced properties
        const serverData = get(ossAppRevisionServerDataSelectorFamily(revisionId))
        return serverData
    }),
)

/**
 * Server data selector (returns merged server data with enhanced properties)
 *
 * Priority for base data: enriched → legacy → query
 * Then merges in enhancedPrompts/enhancedCustomProperties from legacy atom if present
 */
export const ossAppRevisionServerDataSelectorFamily = atomFamily((revisionId: string) =>
    atom<OssAppRevisionData | null>((get) => {
        const bridgeData = get(ossAppRevisionServerDataAtomFamily(revisionId))
        if (bridgeData) {
            return bridgeData
        }

        const enrichedData = get(ossAppRevisionEnrichedDataFamily(revisionId))
        return enrichedData
    }),
)

/**
 * Check if revision has unsaved changes.
 * Compares draft with enriched server data.
 */
export const ossAppRevisionIsDirtyWithBridgeAtomFamily = atomFamily((revisionId: string) =>
    atom<boolean>((get) => {
        const draft = get(ossAppRevisionDraftAtomFamily(revisionId))
        if (!draft) {
            return false
        }

        // Get server data (enriched or legacy)
        const serverData = get(ossAppRevisionServerDataSelectorFamily(revisionId))
        if (!serverData) {
            return true // New entity
        }

        const draftStr = JSON.stringify(stripVolatileKeys(draft))
        const serverStr = JSON.stringify(stripVolatileKeys(serverData))
        return draftStr !== serverStr
    }),
)

// ============================================================================
// UPDATE ACTIONS
// ============================================================================

/**
 * Update OSS app revision draft
 */
export const updateOssAppRevisionAtom = atom(
    null,
    (get, set, revisionId: string, changes: Partial<OssAppRevisionData>) => {
        const currentDraft = get(ossAppRevisionDraftAtomFamily(revisionId))
        const serverData = get(ossAppRevisionServerDataSelectorFamily(revisionId))
        const base = currentDraft || serverData

        if (!base) {
            return
        }

        const updated = produce(base, (draft) => {
            Object.assign(draft, changes)
        })

        set(getDraftAtom(revisionId), updated)
    },
)

/**
 * Discard OSS app revision draft
 *
 * Clears both:
 * 1. The draft atom (local edits)
 * 2. The enhanced prompts/custom properties from server data atom
 *    (these may have been seeded during initial derivation from schema)
 *
 * This ensures the UI falls back to the original query data.
 */
export const discardOssAppRevisionDraftAtom = atom(null, (get, set, revisionId: string) => {
    // 1. Clear the draft atom
    set(getDraftAtom(revisionId), null)

    // 2. Clear enhanced prompts/custom properties from server data atom
    // These may have been seeded during initial derivation from schema
    // and need to be cleared so the UI re-derives from original query data
    const serverData = get(ossAppRevisionServerDataAtomFamily(revisionId))
    if (serverData && (serverData.enhancedPrompts || serverData.enhancedCustomProperties)) {
        const cleanedServerData = produce(serverData, (draft) => {
            delete draft.enhancedPrompts
            delete draft.enhancedCustomProperties
        })
        set(ossAppRevisionServerDataAtomFamily(revisionId), cleanedServerData)
    }
})

// ============================================================================
// ENHANCED PROMPTS/CUSTOM PROPERTIES ACTIONS (for OSS playground)
// ============================================================================

/**
 * Set enhanced prompts for a revision.
 *
 * If this is the initial prompt seeding (no existing draft and server has no prompts),
 * we update the server data atom instead of creating a draft. This prevents the
 * "dirty" state from being triggered on page load when prompts are derived from schema.
 */
export const setEnhancedPromptsAtom = atom(
    null,
    (get, set, revisionId: string, prompts: unknown[]) => {
        const currentDraft = get(ossAppRevisionDraftAtomFamily(revisionId))
        const serverData = get(ossAppRevisionServerDataSelectorFamily(revisionId))
        const base = currentDraft || serverData

        if (!base) {
            // Don't create a draft if there's no base - wait for server data
            return
        }

        // Skip if prompts didn't actually change
        // Use stripVolatileKeys to ignore __id and __test fields that change on every derivation
        const currentPrompts = base.enhancedPrompts || []
        const currentStr = JSON.stringify(stripVolatileKeys(currentPrompts))
        const newStr = JSON.stringify(stripVolatileKeys(prompts))
        if (currentStr === newStr) {
            return
        }

        // If there's no draft and server data has no prompts, this is initial seeding
        // Update the server data atom instead of creating a draft
        if (
            !currentDraft &&
            (!serverData?.enhancedPrompts || serverData.enhancedPrompts.length === 0)
        ) {
            const updatedServerData = produce(serverData!, (draft) => {
                draft.enhancedPrompts = prompts
            })
            // Update the legacy server data atom (which feeds into serverDataSelector)
            set(ossAppRevisionServerDataAtomFamily(revisionId), updatedServerData)
            return
        }

        // Otherwise, create/update the draft
        const updated = produce(base, (draft) => {
            draft.enhancedPrompts = prompts
        })

        set(getDraftAtom(revisionId), updated)
    },
)

/**
 * Mutate enhanced prompts using an Immer recipe
 */
export const mutateEnhancedPromptsAtom = atom(
    null,
    (get, set, revisionId: string, recipe: (draft: unknown[]) => void) => {
        const currentDraft = get(ossAppRevisionDraftAtomFamily(revisionId))
        const serverData = get(ossAppRevisionServerDataSelectorFamily(revisionId))
        const base = currentDraft || serverData

        if (!base) {
            return
        }

        const currentPrompts = base.enhancedPrompts || []
        const updatedPrompts = produce(currentPrompts, recipe)

        // Skip creating draft if prompts didn't actually change
        // Use stripVolatileKeys to ignore __id and __test fields that change on every derivation
        const currentStr = JSON.stringify(stripVolatileKeys(currentPrompts))
        const updatedStr = JSON.stringify(stripVolatileKeys(updatedPrompts))
        if (currentStr === updatedStr) {
            return
        }

        const updated = produce(base, (draft) => {
            draft.enhancedPrompts = updatedPrompts
        })

        set(getDraftAtom(revisionId), updated)
    },
)

/**
 * Set enhanced custom properties for a revision.
 *
 * If this is the initial seeding (no existing draft and server has no custom properties),
 * we update the server data atom instead of creating a draft. This prevents the
 * "dirty" state from being triggered on page load when properties are derived from schema.
 */
export const setEnhancedCustomPropertiesAtom = atom(
    null,
    (get, set, revisionId: string, customProperties: Record<string, unknown>) => {
        const currentDraft = get(ossAppRevisionDraftAtomFamily(revisionId))
        const serverData = get(ossAppRevisionServerDataSelectorFamily(revisionId))
        const base = currentDraft || serverData

        if (!base) {
            // No base data yet - wait for server data
            return
        }

        // Skip if custom properties didn't actually change
        // Use stripVolatileKeys to ignore __id and __test fields that change on every derivation
        const currentProps = base.enhancedCustomProperties || {}
        const currentStr = JSON.stringify(stripVolatileKeys(currentProps))
        const newStr = JSON.stringify(stripVolatileKeys(customProperties))
        if (currentStr === newStr) {
            return
        }

        // If there's no draft and server data has no custom properties, this is initial seeding
        // Update the server data atom instead of creating a draft
        if (
            !currentDraft &&
            (!serverData?.enhancedCustomProperties ||
                Object.keys(serverData.enhancedCustomProperties).length === 0)
        ) {
            const updatedServerData = produce(serverData!, (draft) => {
                draft.enhancedCustomProperties = customProperties
            })
            // Update the legacy server data atom (which feeds into serverDataSelector)
            set(ossAppRevisionServerDataAtomFamily(revisionId), updatedServerData)
            return
        }

        // Otherwise, create/update the draft
        const updated = produce(base, (draft) => {
            draft.enhancedCustomProperties = customProperties
        })

        set(getDraftAtom(revisionId), updated)
    },
)

/**
 * Mutate enhanced custom properties using an Immer recipe
 */
export const mutateEnhancedCustomPropertiesAtom = atom(
    null,
    (get, set, revisionId: string, recipe: (draft: Record<string, unknown>) => void) => {
        const currentDraft = get(ossAppRevisionDraftAtomFamily(revisionId))
        const serverData = get(ossAppRevisionServerDataSelectorFamily(revisionId))
        const base = currentDraft || serverData

        if (!base) return

        const currentProps = (base.enhancedCustomProperties as Record<string, unknown>) || {}
        const updatedProps = produce(currentProps, recipe)

        // Skip creating draft if custom properties didn't actually change
        // Use stripVolatileKeys to ignore __id and __test fields that change on every derivation
        const currentStr = JSON.stringify(stripVolatileKeys(currentProps))
        const updatedStr = JSON.stringify(stripVolatileKeys(updatedProps))
        if (currentStr === updatedStr) {
            return
        }

        const updated = produce(base, (draft) => {
            draft.enhancedCustomProperties = updatedProps
        })

        set(getDraftAtom(revisionId), updated)
    },
)

/**
 * Update a property by __id in enhanced prompts
 */
export const updatePropertyAtom = atom(
    null,
    (
        get,
        set,
        params: {
            revisionId: string
            propertyId: string
            value: unknown
        },
    ) => {
        const {revisionId, propertyId, value} = params

        const currentDraft = get(ossAppRevisionDraftAtomFamily(revisionId))
        const serverData = get(ossAppRevisionServerDataSelectorFamily(revisionId))
        const base = currentDraft || serverData

        if (!base) {
            return
        }

        let propertyFound = false
        const updated = produce(base, (draft) => {
            // Try to find and update in enhanced prompts
            if (draft.enhancedPrompts && Array.isArray(draft.enhancedPrompts)) {
                const found = updatePropertyInArray(draft.enhancedPrompts, propertyId, value)
                if (found) {
                    propertyFound = true
                    return
                }
            }

            // Try to find and update in enhanced custom properties
            if (draft.enhancedCustomProperties) {
                const customProps = draft.enhancedCustomProperties as Record<string, unknown>
                if (propertyId in customProps) {
                    customProps[propertyId] = value
                    propertyFound = true
                    return
                }

                // Check if it's a nested property with __id
                for (const [key, val] of Object.entries(customProps)) {
                    if (
                        val &&
                        typeof val === "object" &&
                        (val as {__id?: string}).__id === propertyId
                    ) {
                        customProps[key] = value
                        propertyFound = true
                        return
                    }
                }
            }

            // Handle custom property updates (format: "custom:propertyKey")
            // Custom properties are derived from schema + parameters, so we update parameters directly
            if (propertyId.startsWith("custom:")) {
                const paramKey = propertyId.replace("custom:", "")
                if (draft.parameters) {
                    const params = draft.parameters as Record<string, unknown>
                    // Update the parameter value directly
                    // The value from the UI is the new value for this parameter
                    params[paramKey] = value
                    propertyFound = true
                    return
                }
            }
        })

        // Only set draft if property was found and updated
        if (!propertyFound) {
            return
        }

        // Check if JSON actually changed (Immer may return same reference if no structural change)
        const baseStr = JSON.stringify(base)
        const updatedStr = JSON.stringify(updated)
        if (baseStr === updatedStr) {
            return
        }

        set(getDraftAtom(revisionId), updated)
    },
)

/**
 * Helper to recursively find and update a property by __id in an object
 *
 * Searches:
 * - Direct properties with __id
 * - Nested objects (e.g., llmConfig.model, llmConfig.temperature)
 * - Arrays (recurses into them)
 *
 * When a property is found:
 * - If it has `value` directly, update that
 * - Otherwise replace the entire property
 */
function updatePropertyInObject(
    obj: Record<string, unknown>,
    propertyId: string,
    value: unknown,
): boolean {
    for (const key of Object.keys(obj)) {
        const prop = obj[key]
        if (!prop || typeof prop !== "object") continue

        const typedProp = prop as {__id?: string; value?: unknown; [key: string]: unknown}

        // Check if this property matches
        if (typedProp.__id === propertyId) {
            const hasValue = "value" in typedProp
            if (hasValue) {
                typedProp.value = value
            } else {
                obj[key] = value
            }
            return true
        }

        // Recurse into arrays
        if (Array.isArray(prop)) {
            if (updatePropertyInArray(prop, propertyId, value, 0)) {
                return true
            }
        }
        // Recurse into nested objects (e.g., llmConfig contains model, temperature, etc.)
        else if (typeof prop === "object" && prop !== null) {
            if (updatePropertyInObject(typedProp as Record<string, unknown>, propertyId, value)) {
                return true
            }
        }
    }
    return false
}

/**
 * Helper to recursively find and update a property by __id in an array
 *
 * Searches both:
 * - Array elements (items in arrays)
 * - Nested object properties (object values within items)
 *
 * When a property is found:
 * - If it has `value` directly, update that
 * - Otherwise replace the entire item
 */
function updatePropertyInArray(
    arr: unknown[],
    propertyId: string,
    value: unknown,
    depth = 0,
): boolean {
    for (let i = 0; i < arr.length; i++) {
        const item = arr[i]
        if (!item || typeof item !== "object") continue

        const typedItem = item as {
            __id?: string
            value?: unknown
            [key: string]: unknown
        }

        // Check if this array item matches
        if (typedItem.__id === propertyId) {
            const hasValue = "value" in typedItem
            if (hasValue) {
                typedItem.value = value
            } else {
                arr[i] = value
            }
            return true
        }

        // Recurse into the object's properties (handles llmConfig.model, etc.)
        if (updatePropertyInObject(typedItem as Record<string, unknown>, propertyId, value)) {
            return true
        }
    }
    return false
}
