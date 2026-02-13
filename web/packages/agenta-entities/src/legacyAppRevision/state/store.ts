/**
 * LegacyAppRevision Entity Store
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
import {atomWithQuery, queryClientAtom} from "jotai-tanstack-query"

import {extractVariablesFromAgConfig} from "../../runnable/utils"
import type {QueryState} from "../../shared"
import type {ListQueryState} from "../../shared"
import {extractRoutePath, extractRuntimePrefix, isLocalDraftId, isPlaceholderId} from "../../shared"
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
import type {LegacyAppRevisionData} from "../core"
import {
    stripVolatileKeys,
    enhancedPromptsToParameters,
    enhancedCustomPropertiesToParameters,
} from "../utils"

// ============================================================================
// INPUT PORTS TYPE
// ============================================================================

/**
 * Input port type for legacyAppRevision
 * Represents a variable expected by the prompt template
 */
export interface LegacyAppRevisionInputPort {
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
    atomWithQuery<LegacyAppRevisionData | null>((get) => {
        const projectId = get(projectIdAtom)
        // Skip queries for local draft IDs and placeholder IDs - they don't exist on the server
        // Placeholder IDs are temporary IDs used during pending hydrations (e.g., "__pending_hydration__dk-xxx")
        const isLocal = isLocalDraftId(revisionId)
        const isPlaceholder = isPlaceholderId(revisionId)
        const enabled = !!revisionId && !!projectId && !isLocal && !isPlaceholder

        return {
            queryKey: ["legacyAppRevision", revisionId, projectId],
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
    atomWithQuery<LegacyAppRevisionData | null>((get) => {
        const projectId = get(projectIdAtom)
        const parsed = parseEnrichedKey(key)
        // Skip queries for local draft IDs and placeholder IDs
        const isLocal = parsed ? isLocalDraftId(parsed.revisionId) : false
        const isPlaceholder = parsed ? isPlaceholderId(parsed.revisionId) : false
        const enabled = !!parsed && !!projectId && !isLocal && !isPlaceholder

        return {
            queryKey: ["legacyAppRevisionEnriched", key, projectId],
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
export const legacyAppRevisionQueryAtomFamily = atomFamily((revisionId: string) =>
    atom<QueryState<LegacyAppRevisionData>>((get) => {
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
export const legacyAppRevisionDraftAtomFamily = atomFamily((_revisionId: string) =>
    atom<LegacyAppRevisionData | null>(null),
)

/**
 * Helper to get a writable draft atom
 */
function getDraftAtom(
    revisionId: string,
): WritableAtom<LegacyAppRevisionData | null, [LegacyAppRevisionData | null], void> {
    return legacyAppRevisionDraftAtomFamily(revisionId) as WritableAtom<
        LegacyAppRevisionData | null,
        [LegacyAppRevisionData | null],
        void
    >
}

// ============================================================================
// ENTITY ATOM (Merged Data)
// ============================================================================

/**
 * Entity atom - returns draft if exists, otherwise server data
 */
export const legacyAppRevisionEntityAtomFamily = atomFamily((revisionId: string) =>
    atom<LegacyAppRevisionData | null>((get) => {
        const draft = get(legacyAppRevisionDraftAtomFamily(revisionId))
        if (draft) {
            return draft
        }

        const query = get(legacyAppRevisionQueryAtomFamily(revisionId))
        return query.data ?? null
    }),
)

// ============================================================================
// DIRTY STATE
// ============================================================================

/**
 * Check if an OSS app revision has local changes
 */
export const legacyAppRevisionIsDirtyAtomFamily = atomFamily((revisionId: string) =>
    atom<boolean>((get) => {
        const draft = get(legacyAppRevisionDraftAtomFamily(revisionId))
        if (!draft) return false

        const query = get(legacyAppRevisionQueryAtomFamily(revisionId))
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
export const legacyAppRevisionInputPortsAtomFamily = atomFamily((revisionId: string) =>
    atom<LegacyAppRevisionInputPort[]>((get) => {
        // Use merged entity (draft + server) for reactive updates
        const data = get(legacyAppRevisionEntityAtomFamily(revisionId))
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
        queryKey: ["apps-for-selection", projectId],
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
// REVISION LIST CACHE LOOKUP
// ============================================================================

/**
 * Writable atom that is incremented whenever we know revision queries have
 * settled (e.g., after a query invalidation). Reading this in a derived atom
 * adds a reactive dependency so the atom re-evaluates when signaled.
 */
export const revisionCacheVersionAtom = atom(0)

const findRevisionListItemInCache = (
    queryClient: import("@tanstack/react-query").QueryClient,
    revisionId: string,
): RevisionListItem | null => {
    const queries = queryClient.getQueriesData({queryKey: ["oss-revisions-for-selection"]})

    for (const [_queryKey, data] of queries) {
        if (!Array.isArray(data)) continue
        const found = data.find((item) => (item as RevisionListItem)?.id === revisionId)
        if (found) {
            return found as RevisionListItem
        }
    }

    return null
}

/**
 * Revision list item lookup from React Query cache — **now reactive**.
 *
 * Previous implementation depended only on `queryClientAtom` (a constant),
 * so it computed once and was never invalidated when new revision data arrived.
 * This caused the enriched query path to never fire, forcing all entity reads
 * through the slow `directQueryAtomFamily` (2 sequential API calls per revision).
 *
 * Fix: additionally read `revisionCacheVersionAtom` so that callers who bump
 * the version (e.g., after query invalidation or initial data load) trigger
 * a re-evaluation. We also reactively read `revisionsQueryAtomFamily` for
 * the variant ID discovered via an initial cache scan, ensuring data flows
 * through the faster enriched path once revision list queries resolve.
 */
const revisionListItemFromCacheAtomFamily = atomFamily((revisionId: string) =>
    atom<RevisionListItem | null>((get) => {
        // Subscribe to the version counter so we re-evaluate when signaled
        get(revisionCacheVersionAtom)

        const queryClient = get(queryClientAtom)
        const cached = findRevisionListItemInCache(queryClient, revisionId)

        if (cached?.variantId) {
            // Also subscribe to the reactive revision query for this variant
            // so that future data updates (e.g., after invalidation) trigger
            // re-evaluation through Jotai's dependency tracking.
            get(revisionsQueryAtomFamily(cached.variantId))
        }

        return cached
    }),
)

const mergeRevisionListContext = (
    data: LegacyAppRevisionData | null,
    listItem: RevisionListItem | null,
): LegacyAppRevisionData | null => {
    if (!data || !listItem) return data

    const uri = data.uri ?? listItem.uri
    const runtimePrefix = data.runtimePrefix ?? extractRuntimePrefix(uri)
    const routePath = data.routePath ?? extractRoutePath(uri)

    return {
        ...data,
        variantId: data.variantId ?? listItem.variantId,
        appId: data.appId ?? listItem.appId,
        uri,
        runtimePrefix,
        routePath,
    }
}

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
                data: LegacyAppRevisionData
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
 * Uses revision list cache to fetch complete data with URI.
 */
export const legacyAppRevisionEnrichedDataFamily = atomFamily((revisionId: string) =>
    atom<LegacyAppRevisionData | null>((get) => {
        const listItem = get(revisionListItemFromCacheAtomFamily(revisionId))
        const variantId = listItem?.variantId

        // If we have a variantId from the list cache, use enriched query
        if (variantId) {
            const enrichedKey = createEnrichedKey(revisionId, variantId)
            const enrichedQuery = get(enrichedQueryAtomFamily(enrichedKey))
            if (enrichedQuery.data) {
                return mergeRevisionListContext(enrichedQuery.data, listItem)
            }
        }

        // Fall back to basic query (without URI enrichment)
        const query = get(legacyAppRevisionQueryAtomFamily(revisionId))
        return mergeRevisionListContext(query.data ?? null, listItem)
    }),
)

/**
 * Legacy server data storage - kept for backward compatibility during migration.
 */
export const legacyAppRevisionServerDataAtomFamily = atomFamily((_revisionId: string) =>
    atom<LegacyAppRevisionData | null>(null),
)

/**
 * Set server data for a revision (legacy bridge only).
 */
export const setServerDataAtom = atom(
    null,
    (_get, set, revisionId: string, data: LegacyAppRevisionData) => {
        // Store the data in legacy atom for backward compatibility
        set(legacyAppRevisionServerDataAtomFamily(revisionId), data)
    },
)

/**
 * Clear server data and draft for a revision.
 */
export const clearServerDataAtom = atom(null, (_get, set, revisionId: string) => {
    set(legacyAppRevisionServerDataAtomFamily(revisionId), null)
    set(getDraftAtom(revisionId), null)
})

/**
 * Entity atom with enrichment support.
 * Prefers: draft → merged server data (enriched + enhanced properties)
 */
export const legacyAppRevisionEntityWithBridgeAtomFamily = atomFamily((revisionId: string) =>
    atom<LegacyAppRevisionData | null>((get) => {
        // Check draft first
        const draft = get(legacyAppRevisionDraftAtomFamily(revisionId))
        if (draft) {
            return draft
        }

        // Use server data selector which merges enriched data with enhanced properties
        const serverData = get(legacyAppRevisionServerDataSelectorFamily(revisionId))
        return serverData
    }),
)

/**
 * Server data selector (returns merged server data with enhanced properties)
 *
 * Priority for base data: enriched → legacy → query
 * Then merges in enhancedPrompts/enhancedCustomProperties from legacy atom if present
 */
export const legacyAppRevisionServerDataSelectorFamily = atomFamily((revisionId: string) =>
    atom<LegacyAppRevisionData | null>((get) => {
        const bridgeData = get(legacyAppRevisionServerDataAtomFamily(revisionId))
        const listItem = get(revisionListItemFromCacheAtomFamily(revisionId))
        if (bridgeData) {
            return mergeRevisionListContext(bridgeData, listItem)
        }

        const enrichedData = get(legacyAppRevisionEnrichedDataFamily(revisionId))
        return mergeRevisionListContext(enrichedData, listItem)
    }),
)

/**
 * Check if revision has unsaved changes.
 * Compares draft parameters with server parameters.
 *
 * IMPORTANT: We compare parameters (the source of truth) rather than the entire
 * object, because enhanced prompts/properties are derived and may have different
 * structure even when the underlying data is the same.
 */
export const legacyAppRevisionIsDirtyWithBridgeAtomFamily = atomFamily((revisionId: string) =>
    atom<boolean>((get) => {
        const draft = get(legacyAppRevisionDraftAtomFamily(revisionId))
        if (!draft) {
            return false
        }

        // Get server data (enriched or legacy)
        const serverData = get(legacyAppRevisionServerDataSelectorFamily(revisionId))
        if (!serverData) {
            return true // New entity
        }

        // IMPORTANT: Compare PARAMETERS only, not enhanced prompts/properties.
        // Enhanced prompts/properties are DERIVED from parameters and stored in draft
        // when user edits, but server data doesn't have them (they're empty []).
        // We need to convert enhanced data back to parameters for comparison.

        const serverParams = serverData.parameters ?? {}
        const hasEnhancedPrompts = draft.enhancedPrompts && Array.isArray(draft.enhancedPrompts)
        const hasEnhancedCustomProps =
            draft.enhancedCustomProperties && typeof draft.enhancedCustomProperties === "object"

        // When enhanced data exists, use SERVER params as the base for conversion.
        // This ensures that when the user manually reverts changes back to the original,
        // the resulting parameters have the same key ordering as server data.
        // Using draft.parameters as the base would fail because URL-hydrated draft
        // parameters go through transformToRequestBody → toSnakeCaseDeep which may
        // produce different key ordering than the original server parameters.
        //
        // When no enhanced data exists (e.g., right after URL hydration before seed),
        // compare draft.parameters directly.
        let draftParams: Record<string, unknown>
        if (hasEnhancedPrompts || hasEnhancedCustomProps) {
            draftParams = {...serverParams}
        } else {
            draftParams = {...(draft.parameters ?? {})}
        }

        // If draft has enhanced prompts, convert them back to parameters
        // This captures any edits the user made through the enhanced prompt UI
        if (hasEnhancedPrompts) {
            draftParams = enhancedPromptsToParameters(draft.enhancedPrompts!, draftParams)
        }

        // If draft has enhanced custom properties, convert them back to parameters
        if (hasEnhancedCustomProps) {
            draftParams = enhancedCustomPropertiesToParameters(
                draft.enhancedCustomProperties as Record<string, unknown>,
                draftParams,
            )
        }

        // Compare parameters (the source of truth)
        // preserveNulls=true because null values are meaningful changes
        const strippedDraft = stripVolatileKeys(draftParams, true)
        const strippedServer = stripVolatileKeys(serverParams, true)
        const draftParamsStr = JSON.stringify(strippedDraft)
        const serverParamsStr = JSON.stringify(strippedServer)

        return draftParamsStr !== serverParamsStr
    }),
)

// ============================================================================
// UPDATE ACTIONS
// ============================================================================

/**
 * Update OSS app revision draft
 */
export const updateLegacyAppRevisionAtom = atom(
    null,
    (get, set, revisionId: string, changes: Partial<LegacyAppRevisionData>) => {
        const currentDraft = get(legacyAppRevisionDraftAtomFamily(revisionId))
        const serverData = get(legacyAppRevisionServerDataSelectorFamily(revisionId))
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
export const discardLegacyAppRevisionDraftAtom = atom(null, (get, set, revisionId: string) => {
    set(getDraftAtom(revisionId), null)

    // 2. Clear enhanced prompts/custom properties from server data atom
    // These may have been seeded during initial derivation from schema
    // and need to be cleared so the UI re-derives from original query data
    const serverData = get(legacyAppRevisionServerDataAtomFamily(revisionId))
    if (serverData && (serverData.enhancedPrompts || serverData.enhancedCustomProperties)) {
        const cleanedServerData = produce(serverData, (draft) => {
            delete draft.enhancedPrompts
            delete draft.enhancedCustomProperties
        })
        set(legacyAppRevisionServerDataAtomFamily(revisionId), cleanedServerData)
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
        const currentDraft = get(legacyAppRevisionDraftAtomFamily(revisionId))
        const serverData = get(legacyAppRevisionServerDataSelectorFamily(revisionId))
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
            set(legacyAppRevisionServerDataAtomFamily(revisionId), updatedServerData)
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
        const currentDraft = get(legacyAppRevisionDraftAtomFamily(revisionId))
        const serverData = get(legacyAppRevisionServerDataSelectorFamily(revisionId))
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
        const currentDraft = get(legacyAppRevisionDraftAtomFamily(revisionId))
        const serverData = get(legacyAppRevisionServerDataSelectorFamily(revisionId))
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
            set(legacyAppRevisionServerDataAtomFamily(revisionId), updatedServerData)
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
        const currentDraft = get(legacyAppRevisionDraftAtomFamily(revisionId))
        const serverData = get(legacyAppRevisionServerDataSelectorFamily(revisionId))
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

        const currentDraft = get(legacyAppRevisionDraftAtomFamily(revisionId))
        const serverData = get(legacyAppRevisionServerDataSelectorFamily(revisionId))
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
                        // Preserve enhanced wrapper (__id, __metadata, schema) — only update .value
                        const typedVal = val as {value?: unknown; [k: string]: unknown}
                        if ("value" in typedVal) {
                            typedVal.value = value
                        } else {
                            customProps[key] = value
                        }
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
