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
import {atomWithStorage} from "jotai/utils"
import {atomFamily} from "jotai-family"
import {atomWithQuery, queryClientAtom} from "jotai-tanstack-query"

import {extractVariablesFromConfig, extractVariablesFromEnhancedPrompt} from "../../runnable/utils"
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
    fetchLatestRevisionId,
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

import {
    legacyAppRevisionSchemaQueryAtomFamily,
    revisionEnhancedPromptsAtomFamily,
    revisionEnhancedCustomPropertiesAtomFamily,
} from "./schemaAtoms"

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

// ============================================================================
// LOCAL DRAFT SOURCE REFS (persisted)
// ============================================================================

export interface LocalDraftSourceRef {
    sourceRevisionId: string | null
    sourceVariantId: string | null
    baseId: string | null
    appId: string | null
    createdAt: number
}

/**
 * Persisted mapping of local draft IDs to their source/base references.
 * This allows entity-level rehydration of local drafts after page reload
 * even when in-memory local serverData is lost.
 */
export const localDraftSourceRefsByIdAtom = atomWithStorage<Record<string, LocalDraftSourceRef>>(
    "agenta:local-draft-source-refs-v1",
    {},
)

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
        // Local drafts and hydration placeholders are client-only entities.
        // Their server query is intentionally disabled, so treat them as
        // non-pending and surface any locally-seeded serverData if available.
        const isLocal = isLocalDraftId(revisionId)
        const isPlaceholder = isPlaceholderId(revisionId)
        if (isLocal || isPlaceholder) {
            let localData = get(legacyAppRevisionServerDataAtomFamily(revisionId))
            const persistedRef = get(localDraftSourceRefsByIdAtom)[revisionId] ?? null
            let waitingForPersistedSource = false

            // Entity-level rehydration fallback:
            // if local data is missing after reload, synthesize it from source revision.
            if (
                !localData &&
                persistedRef?.sourceRevisionId &&
                persistedRef.sourceRevisionId !== revisionId &&
                !isLocalDraftId(persistedRef.sourceRevisionId)
            ) {
                const sourceData = get(
                    legacyAppRevisionServerDataSelectorFamily(persistedRef.sourceRevisionId),
                )
                if (sourceData) {
                    localData = {
                        ...sourceData,
                        id: revisionId,
                        appId: sourceData.appId ?? persistedRef.appId ?? undefined,
                        variantId:
                            sourceData.variantId ?? persistedRef.sourceVariantId ?? undefined,
                        _sourceRevisionId: persistedRef.sourceRevisionId,
                        _sourceVariantId: persistedRef.sourceVariantId ?? undefined,
                        _baseId: persistedRef.baseId ?? undefined,
                    } as LegacyAppRevisionData
                } else {
                    waitingForPersistedSource = true
                }
            }

            return {
                data: localData ?? undefined,
                isPending: waitingForPersistedSource,
                isError: false,
                error: null,
            }
        }

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
 * Extracts template variables ({{variableName}}) from prompt messages,
 * response format, and tool definitions. For custom apps without prompts,
 * falls back to request properties from the OpenAPI schema.
 */
export const legacyAppRevisionInputPortsAtomFamily = atomFamily((revisionId: string) =>
    atom<LegacyAppRevisionInputPort[]>((get) => {
        // Use merged entity (draft + server) for reactive updates
        const data = get(legacyAppRevisionEntityAtomFamily(revisionId))
        if (!data) return []

        const parameters = data.parameters as Record<string, unknown> | undefined
        const dynamicKeys = extractVariablesFromConfig(parameters)

        if (dynamicKeys.length > 0) {
            return dynamicKeys.map((key) => ({
                key,
                name: key,
                type: "string" as const,
                required: true,
            }))
        }

        // Fallback for custom apps: derive input keys from OpenAPI request schema.
        // The schema query already populates requestProperties per endpoint.
        const schemaQuery = get(legacyAppRevisionSchemaQueryAtomFamily(revisionId))
        if (schemaQuery.isPending || !schemaQuery.data?.endpoints) return []

        const endpoints = schemaQuery.data.endpoints
        const primaryProps =
            endpoints.test?.requestProperties ??
            endpoints.run?.requestProperties ??
            endpoints.root?.requestProperties ??
            []

        const reserved = ["ag_config", "messages"]
        return primaryProps
            .filter((k: string) => !reserved.includes(k))
            .map((key: string) => ({
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
        if (enabled)
            console.trace(
                `[DEBUG-ATOM] variantsQueryAtomFamily EVALUATED appId=${appId} enabled=${enabled}`,
            )

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
        if (enabled)
            console.trace(
                `[DEBUG-ATOM] revisionsQueryAtomFamily EVALUATED variantId=${variantId} enabled=${enabled}`,
            )

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
 * Special variant ID prefix for the local drafts group.
 * The full ID is formatted as "__local_drafts__:appId".
 */
export const LOCAL_DRAFTS_VARIANT_ID = "__local_drafts__"

/**
 * Check if a variant ID represents a local drafts group.
 */
export function isLocalDraftsGroupId(variantId: string): boolean {
    return variantId.startsWith(LOCAL_DRAFTS_VARIANT_ID)
}

/**
 * Extract the appId from a local drafts group variant ID.
 * Returns null if the variantId is not a local drafts group.
 */
function extractLocalDraftsAppId(variantId: string): string | null {
    if (!variantId.startsWith(`${LOCAL_DRAFTS_VARIANT_ID}:`)) return null
    return variantId.slice(LOCAL_DRAFTS_VARIANT_ID.length + 1) || null
}

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

type AtomFamilyFn<T> = (param: string) => Atom<T>

let _localDraftIdsAtomFamily: AtomFamilyFn<string[]> | null = null
let _localDraftsListAtomFamily: AtomFamilyFn<unknown[]> | null = null
let _appIdAtom: Atom<string | null> | null = null

/**
 * Set the local drafts atom families (called from localDrafts.ts to avoid circular deps)
 */
export function setLocalDraftsAtoms(
    idsAtomFamily: AtomFamilyFn<string[]>,
    listAtomFamily: AtomFamilyFn<unknown[]>,
): void {
    _localDraftIdsAtomFamily = idsAtomFamily
    _localDraftsListAtomFamily = listAtomFamily
}

/**
 * Register the app ID atom for app-scoped operations.
 * Called from the OSS bridge (legacyEntityBridge.ts) to wire up app scoping
 * without creating a circular dependency.
 */
export function registerAppIdAtom(appIdAtom: Atom<string | null>): void {
    _appIdAtom = appIdAtom
}

/**
 * Get the registered app ID, falling back to "__global__".
 * Used by backward-compat global atoms and imperative functions.
 */
export function getRegisteredAppId(get: <T>(a: Atom<T>) => T): string {
    if (_appIdAtom) {
        const appId = get(_appIdAtom)
        if (appId && typeof appId === "string") return appId
    }
    return "__global__"
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

        // Check for local drafts - use localDraftsListAtomFamily which filters out stale IDs
        // (IDs in localStorage without corresponding data)
        if (_localDraftsListAtomFamily) {
            const localDrafts = get(_localDraftsListAtomFamily(appId)) as unknown[]
            if (localDrafts.length > 0) {
                // Add local drafts pseudo-variant at the top
                // Encode appId in the variant ID so revisionsListWithDraftsAtomFamily
                // can extract it without needing global app scoping
                variants.push({
                    id: `${LOCAL_DRAFTS_VARIANT_ID}:${appId}`,
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
 * Revisions list with local drafts - returns local drafts for __local_drafts__:appId variant.
 *
 * This is the recommended atom for selection UIs that need to show local drafts.
 * The variantId for local drafts is formatted as "__local_drafts__:appId".
 */
export const revisionsListWithDraftsAtomFamily = atomFamily((variantId: string) =>
    atom<ListQueryState<RevisionListItemWithDrafts>>((get) => {
        // Handle local drafts pseudo-variant (format: "__local_drafts__:appId")
        const localDraftsAppId = extractLocalDraftsAppId(variantId)
        if (localDraftsAppId && _localDraftsListAtomFamily) {
            const localDrafts = get(_localDraftsListAtomFamily(localDraftsAppId)) as {
                id: string
                data: LegacyAppRevisionData
                sourceRevisionId: string | null
                isDirty: boolean
            }[]

            const now = Date.now()
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
                createdAtTimestamp: now,
                updatedAtTimestamp: now,
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
// APP-LEVEL FLAT REVISION LIST (with local drafts)
// ============================================================================

/**
 * Flat, sorted list of all revisions for an app, including local drafts.
 *
 * Walks the variant → revision hierarchy via variantsListWithDraftsAtomFamily
 * and revisionsListWithDraftsAtomFamily, then flattens into a single list.
 *
 * Sorting: local drafts first, then server revisions by updatedAtTimestamp desc.
 * Filtering: excludes server revisions with revision <= 0.
 *
 * This is the canonical source for "all revisions of an app" and replaces
 * playground-level duplication that previously re-walked the same tree.
 */
export const appRevisionsWithDraftsAtomFamily = atomFamily((appId: string) =>
    atom<RevisionListItemWithDrafts[]>((get) => {
        if (!appId) return []

        const variantsQuery = get(variantsListWithDraftsAtomFamily(appId))
        const variants = variantsQuery.data ?? []

        const revisions = variants.flatMap((variant) => {
            if (!variant?.id) return []
            const revisionsQuery = get(revisionsListWithDraftsAtomFamily(variant.id))
            const list = revisionsQuery.data ?? []

            // For server variants, ensure variantName is set on each revision
            // (the API transform already sets it, but fall back to variant.name)
            if (!variant.isLocalDraftGroup) {
                const fallbackName = variant.name || variant.baseName || variant.id || "-"
                return list.map((revision) => ({
                    ...revision,
                    variantName: revision.variantName || fallbackName,
                }))
            }

            return list
        })

        const filtered = revisions.filter(
            (revision) => revision.isLocalDraft || Number(revision.revision ?? 0) > 0,
        )
        const localDrafts = filtered.filter((revision) => revision.isLocalDraft)
        const serverRevisions = filtered.filter((revision) => !revision.isLocalDraft)
        serverRevisions.sort((a, b) => (b.updatedAtTimestamp ?? 0) - (a.updatedAtTimestamp ?? 0))

        return [...localDrafts, ...serverRevisions]
    }),
)

/**
 * Lightweight query for the latest server revision ID of an app.
 *
 * Uses `/preview/applications/revisions/query` with `limit: 1, order: "descending"`
 * to fetch only the single most recent revision — **one API call** instead of
 * fetching all variants (1 call) + all revisions per variant (N calls).
 */
const latestServerRevisionIdQueryAtomFamily = atomFamily((appId: string) =>
    atomWithQuery<string | null>((get) => {
        const projectId = get(projectIdAtom)
        const enabled = !!projectId && !!appId

        return {
            queryKey: ["latest-server-revision-id", appId, projectId],
            queryFn: () => fetchLatestRevisionId(appId, projectId!),
            staleTime: 1000 * 60,
            refetchOnWindowFocus: false,
            enabled,
        }
    }),
)

/**
 * Latest server revision ID for an app.
 *
 * Returns `null` while the query is still pending so that callers
 * (e.g. `ensurePlaygroundDefaults`) know to retry later.
 */
export const latestServerRevisionIdAtomFamily = atomFamily((appId: string) =>
    atom<string | null>((get) => {
        if (!appId) return null
        const query = get(latestServerRevisionIdQueryAtomFamily(appId))
        if (query.isPending) return null
        return query.data ?? null
    }),
)

/**
 * Latest server revision ID for the currently registered app.
 *
 * Combines the app ID atom registered by the OSS layer (via
 * `registerAppIdAtom`) with `latestServerRevisionIdAtomFamily`.
 *
 * This is an entity-level convenience atom so non-playground consumers
 * (e.g. VariantNameCell, VariantsTable) can determine "is latest?" without
 * depending on playground state.
 */
export const latestAppRevisionIdAtom = atom<string | null>((get) => {
    const appId = getRegisteredAppId(get)
    if (appId === "__global__") return null
    return get(latestServerRevisionIdAtomFamily(appId))
})

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
 * Legacy server data storage for backward compatibility.
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
        if (serverData) {
            return serverData
        }

        // For local drafts, fall back to queryAtomFamily which handles rehydration
        // from the source revision after page reload (similar to schema re-routing).
        if (isLocalDraftId(revisionId)) {
            const query = get(legacyAppRevisionQueryAtomFamily(revisionId))
            return query.data ?? null
        }

        return null
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
            const merged = mergeRevisionListContext(bridgeData, listItem)
            // Bridge data may lack identity and display fields (variantId, appId,
            // variantName, configName, appName). Fill them from the enriched/query
            // path which fetches variant detail.
            if (merged && (!merged.variantId || !merged.variantName)) {
                const enrichedData = get(legacyAppRevisionEnrichedDataFamily(revisionId))
                if (enrichedData) {
                    return {
                        ...merged,
                        variantId: merged.variantId ?? enrichedData.variantId,
                        appId: merged.appId ?? enrichedData.appId,
                        variantName: merged.variantName ?? enrichedData.variantName,
                        configName: merged.configName ?? enrichedData.configName,
                        appName: merged.appName ?? enrichedData.appName,
                    }
                }
            }
            return merged
        }

        const enrichedData = get(legacyAppRevisionEnrichedDataFamily(revisionId))
        return mergeRevisionListContext(enrichedData, listItem)
    }),
)

/**
 * Reactive atom that converts enhanced draft data back to raw parameters.
 *
 * Returns the current draft parameters with enhanced prompts/properties
 * converted back to raw format. Returns null when no draft exists.
 *
 * This is the single conversion point used by isDirty, commit, diff view,
 * and JSON editor — avoiding duplicated enhanced→raw conversion logic.
 */
export const legacyAppRevisionDraftParametersAtomFamily = atomFamily((revisionId: string) =>
    atom<Record<string, unknown> | null>((get) => {
        const draft = get(legacyAppRevisionDraftAtomFamily(revisionId))
        if (!draft) return null

        const serverData = get(legacyAppRevisionServerDataSelectorFamily(revisionId))
        const serverParams: Record<string, unknown> = serverData?.parameters ?? {}
        const hasEnhancedPrompts = draft.enhancedPrompts && Array.isArray(draft.enhancedPrompts)
        const hasEnhancedCustomProps =
            draft.enhancedCustomProperties && typeof draft.enhancedCustomProperties === "object"

        // When enhanced data exists, use SERVER params as the base for conversion.
        // This preserves key ordering from the server, preventing false positives
        // from toSnakeCaseDeep key reordering in enhanced → raw conversion.
        let params: Record<string, unknown>
        if (hasEnhancedPrompts || hasEnhancedCustomProps) {
            params = {...serverParams}
        } else {
            params = {...(draft.parameters ?? {})}
        }

        if (hasEnhancedPrompts) {
            params = enhancedPromptsToParameters(draft.enhancedPrompts!, params)
        }
        if (hasEnhancedCustomProps) {
            params = enhancedCustomPropertiesToParameters(
                draft.enhancedCustomProperties as Record<string, unknown>,
                params,
            )
        }

        return params
    }),
)

/**
 * Check if revision has unsaved changes.
 * Compares draft parameters with server parameters.
 *
 * Uses draftParametersAtomFamily for enhanced→raw conversion,
 * then compares against server parameters with volatile keys stripped.
 */
export const legacyAppRevisionIsDirtyWithBridgeAtomFamily = atomFamily((revisionId: string) =>
    atom<boolean>((get) => {
        // Local drafts are inherently uncommitted — always dirty.
        // This ensures URL hash persistence and hydration work correctly.
        // For actual change detection (commit button), use hasChangesAtomFamily.
        if (isLocalDraftId(revisionId)) return true

        const draftParams = get(legacyAppRevisionDraftParametersAtomFamily(revisionId))
        if (draftParams === null) return false

        const serverData = get(legacyAppRevisionServerDataSelectorFamily(revisionId))
        if (!serverData) return true // New entity

        const serverParams = serverData.parameters ?? {}
        const strippedDraft = stripVolatileKeys(draftParams, true)
        const strippedServer = stripVolatileKeys(serverParams, true)

        return JSON.stringify(strippedDraft) !== JSON.stringify(strippedServer)
    }),
)

/**
 * Check if a local draft has actual changes compared to its base (source) revision.
 * Used by the commit button to determine if there are real diffs to commit.
 *
 * For API-backed entities, delegates to isDirty.
 * For local drafts, compares draft parameters against the source revision's server data.
 */
export const legacyAppRevisionHasChangesAtomFamily = atomFamily((revisionId: string) =>
    atom<boolean>((get) => {
        if (!isLocalDraftId(revisionId)) {
            return get(legacyAppRevisionIsDirtyWithBridgeAtomFamily(revisionId))
        }

        const draftParams = get(legacyAppRevisionDraftParametersAtomFamily(revisionId))
        if (!draftParams) return false

        const sourceRefs = get(localDraftSourceRefsByIdAtom)[revisionId]
        const sourceRevisionId = sourceRefs?.sourceRevisionId
        if (!sourceRevisionId) return false

        const baseServerData = get(legacyAppRevisionServerDataSelectorFamily(sourceRevisionId))
        if (!baseServerData) return false

        const baseParams = baseServerData.parameters ?? {}
        const strippedDraft = stripVolatileKeys(draftParams, true)
        const strippedBase = stripVolatileKeys(baseParams, true)

        return JSON.stringify(strippedDraft) !== JSON.stringify(strippedBase)
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

            // When parameters change, clear enhanced data so it gets re-derived.
            // Without this, stale enhancedCustomProperties (e.g. deleted tools)
            // would persist in the draft and be sent in the invocation payload.
            if (changes.parameters) {
                draft.enhancedPrompts = undefined
                draft.enhancedCustomProperties = undefined
            }
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

// ============================================================================
// READ UTILITIES - Find property by __id (read counterpart to updatePropertyIn*)
// ============================================================================

/**
 * Recursively find a property by __id in an object tree.
 * Read-only counterpart to `updatePropertyInObject`.
 */
export function findPropertyInObject(obj: unknown, propertyId: string): unknown | undefined {
    if (!obj || typeof obj !== "object") return undefined

    const record = obj as Record<string, unknown>

    // Check if current object has matching __id
    if ("__id" in record && record.__id === propertyId) {
        return record
    }

    // Recurse through properties
    for (const key of Object.keys(record)) {
        const value = record[key]
        if (!value || typeof value !== "object") continue

        if (Array.isArray(value)) {
            const found = findPropertyInArray(value, propertyId)
            if (found !== undefined) return found
        } else {
            const found = findPropertyInObject(value, propertyId)
            if (found !== undefined) return found
        }
    }

    return undefined
}

/**
 * Recursively find a property by __id in an array.
 * Read-only counterpart to `updatePropertyInArray`.
 */
export function findPropertyInArray(arr: unknown[], propertyId: string): unknown | undefined {
    for (const item of arr) {
        if (!item || typeof item !== "object") continue

        const found = findPropertyInObject(item, propertyId)
        if (found !== undefined) return found
    }
    return undefined
}

/**
 * Find a property by __id across a revision's enhanced prompts and custom properties.
 * Returns the property value (.content?.value or .value) or null.
 */
export const findPropertyByIdAtomFamily = atomFamily(
    (params: {revisionId: string; propertyId: string}) =>
        atom((get) => {
            const {revisionId, propertyId} = params
            if (!revisionId || !propertyId) return null

            const data = get(legacyAppRevisionEntityWithBridgeAtomFamily(revisionId))
            if (!data) return null

            // Search in enhanced prompts
            if (data.enhancedPrompts && Array.isArray(data.enhancedPrompts)) {
                const found = findPropertyInArray(data.enhancedPrompts, propertyId)
                if (found !== undefined) {
                    const typed = found as {content?: {value?: unknown}; value?: unknown}
                    return typed?.content?.value ?? typed?.value ?? null
                }
            }

            // Search in enhanced custom properties
            if (data.enhancedCustomProperties) {
                const found = findPropertyInObject(data.enhancedCustomProperties, propertyId)
                if (found !== undefined) {
                    const typed = found as {content?: {value?: unknown}; value?: unknown}
                    return typed?.content?.value ?? typed?.value ?? null
                }
            }

            return null
        }),
)

// ============================================================================
// TEMPLATE FORMAT - Extract template format from enhanced prompts
// ============================================================================

export type PromptTemplateFormat = "curly" | "fstring" | "jinja2"

const SUPPORTED_FORMATS: PromptTemplateFormat[] = ["curly", "fstring", "jinja2"]

export const DEFAULT_TEMPLATE_FORMAT: PromptTemplateFormat = "curly"

export function sanitizeTemplateFormat(value: unknown): PromptTemplateFormat | undefined {
    if (typeof value !== "string") return undefined
    const lowered = value.toLowerCase()
    if (lowered === "jinja") return "jinja2"
    return SUPPORTED_FORMATS.find((format) => format === lowered) ?? undefined
}

export function getTemplateFormatNode(prompt: unknown): unknown {
    if (!prompt || typeof prompt !== "object") return undefined
    const p = prompt as Record<string, unknown>
    return (
        p.templateFormat ??
        p.template_format ??
        (p.prompt as Record<string, unknown> | undefined)?.templateFormat ??
        (p.prompt as Record<string, unknown> | undefined)?.template_format
    )
}

export function getTemplateFormatValue(node: unknown): PromptTemplateFormat | undefined {
    if (!node) return undefined
    if (typeof node === "string") return sanitizeTemplateFormat(node)
    if (typeof node === "object") {
        const n = node as Record<string, unknown>
        if (typeof n.value === "string") return sanitizeTemplateFormat(n.value)
        if (typeof n.default === "string") return sanitizeTemplateFormat(n.default)
    }
    return undefined
}

export function getTemplateFormatPropertyId(node: unknown): string | undefined {
    if (!node || typeof node !== "object") return undefined
    const n = node as Record<string, unknown>
    const candidate = n.__id ?? n.id
    return typeof candidate === "string" ? candidate : undefined
}

/**
 * Read-only: extract template format from a revision's enhanced prompts.
 * If prompts disagree, prefers the first non-default format.
 */
export const revisionTemplateFormatAtomFamily = atomFamily((revisionId: string) =>
    atom<PromptTemplateFormat>((get) => {
        const data = get(legacyAppRevisionEntityWithBridgeAtomFamily(revisionId))
        const prompts = data?.enhancedPrompts
        if (!Array.isArray(prompts) || prompts.length === 0) {
            return DEFAULT_TEMPLATE_FORMAT
        }

        const formats = prompts
            .map((prompt) => getTemplateFormatValue(getTemplateFormatNode(prompt)))
            .filter(Boolean) as PromptTemplateFormat[]

        if (formats.length === 0) return DEFAULT_TEMPLATE_FORMAT

        const unique = new Set(formats)
        if (unique.size === 1) return formats[0]

        const firstNonDefault = formats.find((f) => f !== DEFAULT_TEMPLATE_FORMAT)
        return firstNonDefault ?? DEFAULT_TEMPLATE_FORMAT
    }),
)

// ============================================================================
// PER-PROMPT VARIABLE EXTRACTION
// ============================================================================

/**
 * Extract template variables from a single prompt within a revision.
 * Finds the prompt by __id or __name, then extracts {{variables}} from its messages.
 */
export const revisionPromptVariablesAtomFamily = atomFamily(
    (params: {revisionId: string; promptId: string}) =>
        atom<string[]>((get) => {
            const {revisionId, promptId} = params
            if (!revisionId || !promptId) return []

            const data = get(legacyAppRevisionEntityWithBridgeAtomFamily(revisionId))
            const prompts = data?.enhancedPrompts
            if (!Array.isArray(prompts) || prompts.length === 0) return []

            const target =
                prompts.find((pr: unknown) => (pr as Record<string, unknown>)?.__id === promptId) ||
                prompts.find((pr: unknown) => (pr as Record<string, unknown>)?.__name === promptId)
            if (!target) return []

            return extractVariablesFromEnhancedPrompt(target)
        }),
)

// ============================================================================
// ENHANCED PROMPTS / CUSTOM PROPERTIES WITH FALLBACK
// Reads from entity data (draft merged) first, falls back to schema-derived.
// This is the recommended read API for consumers that need prompts/properties.
// ============================================================================

/**
 * Enhanced prompts with schema-derived fallback.
 *
 * Reads `data.enhancedPrompts` (includes draft changes) first.
 * Falls back to `revisionEnhancedPromptsAtomFamily` (schema + parameters derivation)
 * when the entity hasn't been seeded yet (common after page load).
 *
 * This is the recommended read-only atom for prompts in UI components.
 */
export const enhancedPromptsWithFallbackAtomFamily = atomFamily((revisionId: string) =>
    atom<unknown[]>((get) => {
        const data = get(legacyAppRevisionEntityWithBridgeAtomFamily(revisionId))

        if (
            data?.enhancedPrompts &&
            Array.isArray(data.enhancedPrompts) &&
            data.enhancedPrompts.length > 0
        ) {
            return data.enhancedPrompts
        }

        // Fallback: derive from schema + parameters
        const derived = get(revisionEnhancedPromptsAtomFamily(revisionId))
        if (derived && Array.isArray(derived) && derived.length > 0) {
            return derived
        }

        return []
    }),
)

/**
 * Enhanced custom properties with schema-derived fallback.
 *
 * Reads `data.enhancedCustomProperties` (includes draft changes) first.
 * Falls back to `revisionEnhancedCustomPropertiesAtomFamily` (schema + parameters derivation)
 * when the entity hasn't been seeded yet.
 *
 * This is the recommended read-only atom for custom properties in UI components.
 */
export const enhancedCustomPropertiesWithFallbackAtomFamily = atomFamily((revisionId: string) =>
    atom<Record<string, unknown>>((get) => {
        const data = get(legacyAppRevisionEntityWithBridgeAtomFamily(revisionId))

        if (
            data?.enhancedCustomProperties &&
            Object.keys(data.enhancedCustomProperties).length > 0
        ) {
            return data.enhancedCustomProperties as Record<string, unknown>
        }

        // Fallback: derive from schema + parameters
        const derived = get(revisionEnhancedCustomPropertiesAtomFamily(revisionId))
        if (derived && Object.keys(derived).length > 0) {
            return derived as Record<string, unknown>
        }

        return {}
    }),
)
