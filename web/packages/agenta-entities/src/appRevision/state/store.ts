/**
 * AppRevision Entity Store
 *
 * Provides atoms for app revision entity state:
 * - Query atom (server data)
 * - Draft atom (local edits)
 * - Entity atom (merged data)
 * - Dirty state atom
 *
 * NOTE: Execution mode atoms are now in ./runnableSetup.ts
 */

import {projectIdAtom} from "@agenta/shared"
import {produce} from "immer"
import type {WritableAtom} from "jotai"
import {atom} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {extractVariablesFromAgConfig} from "../../runnable/utils"
import type {QueryState} from "../../shared"
import {
    fetchVariantsList,
    fetchRevisionsList,
    fetchRevisionConfig,
    type AppListItem,
    type VariantListItem,
    type RevisionListItem,
    fetchAppsList,
} from "../api"
import type {AppRevisionData, PromptConfig, MessageConfig} from "../core"

// ============================================================================
// INPUT PORTS TYPE
// ============================================================================

/**
 * Input port type for appRevision
 * Represents a variable expected by the prompt template
 */
export interface AppRevisionInputPort {
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
// QUERY ATOM FAMILY
// ============================================================================

/**
 * Direct query atom family that fetches revision data from API.
 *
 * This uses @agenta/shared axios which works in both OSS and EE.
 * No injection or initialization required.
 */
const directQueryAtomFamily = atomFamily((revisionId: string) =>
    atomWithQuery<AppRevisionData | null>((get) => {
        const projectId = get(projectIdAtom)
        const enabled = !!revisionId && !!projectId

        return {
            queryKey: ["appRevision", revisionId, projectId],
            queryFn: () => fetchRevisionConfig(revisionId, projectId!),
            staleTime: 1000 * 60, // 1 minute
            refetchOnWindowFocus: false,
            enabled,
        }
    }),
)

/**
 * Query atom family - returns server data for a revision
 *
 * Uses direct API query via @agenta/shared axios.
 * Returns QueryState format for consistency with entity patterns.
 */
export const appRevisionQueryAtomFamily = atomFamily((revisionId: string) =>
    atom<QueryState<AppRevisionData>>((get) => {
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
 * Draft state for local edits to app revisions
 */
export const appRevisionDraftAtomFamily = atomFamily((_revisionId: string) =>
    atom<AppRevisionData | null>(null),
)

/**
 * Helper to get a writable draft atom
 */
function getDraftAtom(
    revisionId: string,
): WritableAtom<AppRevisionData | null, [AppRevisionData | null], void> {
    return appRevisionDraftAtomFamily(revisionId) as WritableAtom<
        AppRevisionData | null,
        [AppRevisionData | null],
        void
    >
}

// ============================================================================
// ENTITY ATOM (Merged Data)
// ============================================================================

/**
 * Entity atom - returns draft if exists, otherwise server data
 */
export const appRevisionEntityAtomFamily = atomFamily((revisionId: string) =>
    atom<AppRevisionData | null>((get) => {
        const draft = get(appRevisionDraftAtomFamily(revisionId))
        if (draft) {
            return draft
        }

        const query = get(appRevisionQueryAtomFamily(revisionId))
        return query.data ?? null
    }),
)

// ============================================================================
// DIRTY STATE
// ============================================================================

/**
 * Check if an app revision has local changes
 */
export const appRevisionIsDirtyAtomFamily = atomFamily((revisionId: string) =>
    atom<boolean>((get) => {
        const draft = get(appRevisionDraftAtomFamily(revisionId))
        if (!draft) return false

        const query = get(appRevisionQueryAtomFamily(revisionId))
        if (!query.data) return true // New entity

        // Compare draft with server data
        return JSON.stringify(draft) !== JSON.stringify(query.data)
    }),
)

// ============================================================================
// INPUT PORTS (derived from agConfig prompt template)
// ============================================================================

/**
 * Derives input ports from the revision's agConfig prompt template.
 *
 * Extracts template variables ({{variableName}}) from prompt messages
 * and returns them as input port definitions. This is the single source
 * of truth for "what inputs does this revision expect".
 *
 * Uses the merged entity data (draft + server) so it reacts to local edits.
 *
 * @example
 * ```typescript
 * const inputPorts = useAtomValue(appRevisionInputPortsAtomFamily(revisionId))
 * // Returns: [{ key: 'user_input', name: 'user_input', type: 'string', required: true }]
 * ```
 */
export const appRevisionInputPortsAtomFamily = atomFamily((revisionId: string) =>
    atom<AppRevisionInputPort[]>((get) => {
        // Use merged entity (draft + server) for reactive updates
        const data = get(appRevisionEntityAtomFamily(revisionId))
        if (!data) return []

        const agConfig = data.agConfig as Record<string, unknown> | undefined
        const dynamicKeys = extractVariablesFromAgConfig(agConfig)

        return dynamicKeys.map((key) => ({
            key,
            name: key,
            type: "string" as const,
            required: true,
        }))
    }),
)

// ============================================================================
// EXECUTION MODE
// ============================================================================
// NOTE: Execution mode atoms are now provided by the runnable extension
// See ./runnableSetup.ts for the implementation
// Re-exports for backward compatibility are in ./index.ts

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
 * Uses projectIdAtom from @agenta/shared and fetchVariantsList from api
 */
export const variantsQueryAtomFamily = atomFamily((appId: string) =>
    atomWithQuery<VariantListItem[]>((get) => {
        const projectId = get(projectIdAtom)
        const enabled = !!projectId && !!appId

        return {
            queryKey: ["variants-for-selection", appId, projectId],
            queryFn: () => fetchVariantsList(appId, projectId!),
            staleTime: 1000 * 60, // 1 minute
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
 * Uses projectIdAtom from @agenta/shared and fetchRevisionsList from api
 */
export const revisionsQueryAtomFamily = atomFamily((variantId: string) =>
    atomWithQuery<RevisionListItem[]>((get) => {
        const projectId = get(projectIdAtom)
        const enabled = !!projectId && !!variantId

        return {
            queryKey: ["revisions-for-selection", variantId, projectId],
            queryFn: () => fetchRevisionsList(variantId, projectId!),
            staleTime: 1000 * 60, // 1 minute
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
 * Uses projectIdAtom from @agenta/shared and fetchAppsList from api
 */
export const appsQueryAtom = atomWithQuery<AppListItem[]>((get) => {
    const projectId = get(projectIdAtom)
    const enabled = !!projectId

    return {
        queryKey: ["apps-for-selection", projectId],
        queryFn: async () => {
            return fetchAppsList(projectId!)
        },
        staleTime: 1000 * 60, // 1 minute
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

/**
 * Apps list atom type - can be overridden by OSS layer
 */
type AppsListAtomType = ReturnType<typeof atom<AppListItem[]>>

// Store reference for apps list atom override (optional)
let _appsListAtom: AppsListAtomType | null = null

/**
 * Set the apps list atom override.
 * Optional - defaults to package's appsListDataAtom.
 * Called by OSS layer if it needs to inject a different data source.
 */
export function setAppsListAtom(appsAtom: AppsListAtomType): void {
    _appsListAtom = appsAtom
}

/**
 * Apps list atom - returns list of apps
 * Uses package query by default, can be overridden by OSS layer
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

/**
 * Variants list atom family type - can be overridden by OSS layer
 */
type VariantsListAtomFamilyType = (appId: string) => ReturnType<typeof atom<VariantListItem[]>>

/**
 * Revisions list atom family type - can be overridden by OSS layer
 */
type RevisionsListAtomFamilyType = (
    variantId: string,
) => ReturnType<typeof atom<RevisionListItem[]>>

// Store references for override atoms (optional, defaults to package queries)
let _variantsListAtomFamily: VariantsListAtomFamilyType | null = null
let _revisionsListAtomFamily: RevisionsListAtomFamilyType | null = null

/**
 * Set the variants list atom family override.
 * Optional - defaults to package's variantsListDataAtomFamily.
 */
export function setVariantsListAtomFamily(family: VariantsListAtomFamilyType): void {
    _variantsListAtomFamily = family
}

/**
 * Set the revisions list atom family override.
 * Optional - defaults to package's revisionsListDataAtomFamily.
 */
export function setRevisionsListAtomFamily(family: RevisionsListAtomFamilyType): void {
    _revisionsListAtomFamily = family
}

/**
 * Variants list atom family - returns variants for an app
 * Uses package query by default, can be overridden by OSS layer
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
 * Revisions list atom family - returns revisions for a variant
 * Uses package query by default, can be overridden by OSS layer
 */
export const revisionsListAtomFamily = atomFamily((variantId: string) =>
    atom<RevisionListItem[]>((get) => {
        if (_revisionsListAtomFamily) {
            return get(_revisionsListAtomFamily(variantId))
        }
        return get(revisionsListDataAtomFamily(variantId))
    }),
)

// ============================================================================
// UPDATE ACTIONS
// ============================================================================

/**
 * Update app revision draft
 */
export const updateAppRevisionAtom = atom(
    null,
    (get, set, revisionId: string, changes: Partial<AppRevisionData>) => {
        const currentDraft = get(appRevisionDraftAtomFamily(revisionId))
        const query = get(appRevisionQueryAtomFamily(revisionId))
        const base = currentDraft || query.data

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
 * Discard app revision draft
 */
export const discardAppRevisionDraftAtom = atom(null, (_get, set, revisionId: string) => {
    set(getDraftAtom(revisionId), null)
})

// ============================================================================
// SPECIALIZED MUTATIONS
// ============================================================================

/**
 * Update a specific prompt in the revision
 */
export const updatePromptAtom = atom(
    null,
    (get, set, revisionId: string, promptIndex: number, changes: Partial<PromptConfig>) => {
        const entity = get(appRevisionEntityAtomFamily(revisionId))
        if (!entity) return

        const updated = produce(entity, (draft) => {
            if (draft.prompts[promptIndex]) {
                Object.assign(draft.prompts[promptIndex], changes)
            }
        })

        set(getDraftAtom(revisionId), updated)
    },
)

/**
 * Update a specific message in a prompt
 */
export const updateMessageAtom = atom(
    null,
    (
        get,
        set,
        revisionId: string,
        promptIndex: number,
        messageIndex: number,
        changes: Partial<MessageConfig>,
    ) => {
        const entity = get(appRevisionEntityAtomFamily(revisionId))
        if (!entity) return

        const updated = produce(entity, (draft) => {
            const prompt = draft.prompts[promptIndex]
            if (prompt?.messages[messageIndex]) {
                Object.assign(prompt.messages[messageIndex], changes)
            }
        })

        set(getDraftAtom(revisionId), updated)
    },
)

/**
 * Add a new message to a prompt
 */
export const addMessageAtom = atom(
    null,
    (get, set, revisionId: string, promptIndex: number, message: MessageConfig) => {
        const entity = get(appRevisionEntityAtomFamily(revisionId))
        if (!entity) return

        const updated = produce(entity, (draft) => {
            const prompt = draft.prompts[promptIndex]
            if (prompt) {
                prompt.messages.push(message)
            }
        })

        set(getDraftAtom(revisionId), updated)
    },
)

/**
 * Delete a message from a prompt
 */
export const deleteMessageAtom = atom(
    null,
    (get, set, revisionId: string, promptIndex: number, messageIndex: number) => {
        const entity = get(appRevisionEntityAtomFamily(revisionId))
        if (!entity) return

        const updated = produce(entity, (draft) => {
            const prompt = draft.prompts[promptIndex]
            if (prompt) {
                prompt.messages.splice(messageIndex, 1)
            }
        })

        set(getDraftAtom(revisionId), updated)
    },
)

/**
 * Reorder messages in a prompt
 */
export const reorderMessagesAtom = atom(
    null,
    (get, set, revisionId: string, promptIndex: number, fromIndex: number, toIndex: number) => {
        const entity = get(appRevisionEntityAtomFamily(revisionId))
        if (!entity) return

        const updated = produce(entity, (draft) => {
            const prompt = draft.prompts[promptIndex]
            if (prompt) {
                const [removed] = prompt.messages.splice(fromIndex, 1)
                prompt.messages.splice(toIndex, 0, removed)
            }
        })

        set(getDraftAtom(revisionId), updated)
    },
)
