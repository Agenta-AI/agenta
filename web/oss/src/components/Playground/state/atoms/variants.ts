import {
    ossAppsListAtom,
    ossAppToVariantRelation,
    ossVariantToRevisionRelation,
    isLocalDraftId,
    localDraftIdsAtom,
    variantsListWithDraftsAtomFamily,
    revisionsListWithDraftsAtomFamily,
    variantsQueryAtomFamily,
    revisionsQueryAtomFamily,
    type AppListItem,
    type VariantListItem,
    type RevisionListItem,
} from "@agenta/entities/legacyAppRevision"
import {isPlaceholderId} from "@agenta/playground"
import isEqual from "fast-deep-equal"
import {atom, getDefaultStore} from "jotai"
import {selectAtom} from "jotai/utils"

import {formatDate24} from "@/oss/lib/helpers/dateTimeHelper"
import {
    extractVariables,
    extractVariablesFromJson,
    extractInputKeysFromSchema,
} from "@/oss/lib/shared/variant/inputHelpers"
import {currentAppAtom} from "@/oss/state/app"
import {currentAppContextAtom, selectedAppIdAtom} from "@/oss/state/app/selectors/app"
import {
    moleculeBackedPromptsAtomFamily,
    moleculeBackedCustomPropertiesAtomFamily,
} from "@/oss/state/newPlayground/legacyEntityBridge"

import {appChatModeAtom} from "./app"
import {selectedVariantsAtom} from "./core"
import {
    playgroundAppSchemaAtom,
    playgroundAppRoutePathAtom,
    playgroundHasAgConfigAtom,
} from "./playgroundAppAtoms"

const isPromiseLike = (value: unknown): value is Promise<unknown> =>
    Boolean(value && typeof (value as {then?: unknown}).then === "function")

// ============================================================================
// READINESS SIGNAL
// ============================================================================

/**
 * Indicates whether the playground revision list has completed its initial load.
 *
 * Checks the RAW query atoms (not the "with drafts" wrappers) because
 * variantsListWithDraftsAtomFamily.isPending becomes false when local drafts
 * exist, even if server data is still loading.
 *
 * Must be true before we filter selectedVariantsAtom against the revision list
 * or attempt to apply default selections. Without this guard, revisions from
 * variants whose query hasn't resolved yet get silently dropped.
 */
export const playgroundRevisionsReadyAtom = atom((get) => {
    const appId = get(selectedAppIdAtom)
    if (!appId || isPromiseLike(appId)) return false

    const variantsQuery = get(variantsQueryAtomFamily(appId))
    if (variantsQuery.isPending) return false

    const variantsData = (variantsQuery.data ?? []) as {id: string}[]
    if (variantsData.length === 0) return true

    for (const variant of variantsData) {
        if (!variant?.id) continue
        const revisionsQuery = get(revisionsQueryAtomFamily(variant.id))
        if (revisionsQuery.isPending) return false
    }
    return true
})

// ============================================================================
// MOLECULE-BACKED LIST WRAPPER ATOMS
// ============================================================================

/**
 * Apps list atom - wraps ossAppsListAtom for Playground usage
 */
export const appsListAtom = ossAppsListAtom

/**
 * Variants list atom family - returns variants for an app using relation list atoms
 */
export const variantsListAtomFamily = (appId: string) =>
    ossAppToVariantRelation.listAtomFamily?.(appId)

/**
 * Revisions list atom family - returns revisions for a variant using relation list atoms
 */
export const revisionsListAtomFamily = (variantId: string) =>
    ossVariantToRevisionRelation.listAtomFamily?.(variantId)

// ============================================================================
// PLAYGROUND REVISION LIST ATOM
// ============================================================================

/**
 * Playground revision list atom - merges server revisions with local drafts.
 * This is the primary source of truth for Playground UI layout and selection.
 *
 * Combines entity list atoms:
 * - variantsListWithDraftsAtomFamily (app scope)
 * - revisionsListWithDraftsAtomFamily (variant scope)
 */
export const playgroundRevisionListAtom = atom((get) => {
    const appId = get(selectedAppIdAtom)
    if (!appId || isPromiseLike(appId)) return []

    const variantsQuery = get(variantsListWithDraftsAtomFamily(appId))
    const variants = variantsQuery.data ?? []

    const revisions = variants.flatMap((variant: any) => {
        if (!variant?.id) return []
        const revisionsQuery = get(revisionsListWithDraftsAtomFamily(variant.id))
        const list = revisionsQuery.data ?? []
        const variantName =
            (variant.name as string) || (variant.baseName as string) || variant.id || "-"

        return list.map((revision: any) => {
            const createdAt = revision.createdAt
            const updatedAt = revision.updatedAt ?? revision.updated_at ?? createdAt
            const createdTimestamp = createdAt ? new Date(createdAt).valueOf() : Date.now()
            const updatedTimestamp = updatedAt ? new Date(updatedAt).valueOf() : createdTimestamp
            const safeCreatedTimestamp = Number.isNaN(createdTimestamp)
                ? Date.now()
                : createdTimestamp
            const safeUpdatedTimestamp = Number.isNaN(updatedTimestamp)
                ? safeCreatedTimestamp
                : updatedTimestamp

            return {
                ...revision,
                variantId: revision.variantId ?? variant.id,
                variantName: revision.variantName ?? variantName,
                createdAtTimestamp: safeCreatedTimestamp,
                updatedAtTimestamp: safeUpdatedTimestamp,
                commit_message: revision.commitMessage ?? revision.commit_message,
                modifiedBy: revision.author ?? revision.modifiedBy ?? revision.modified_by ?? null,
            }
        })
    })

    const filtered = revisions.filter(
        (revision: any) => revision?.isLocalDraft || Number(revision?.revision ?? 0) > 0,
    )
    const localDrafts = filtered.filter((revision: any) => revision?.isLocalDraft)
    const serverRevisions = filtered.filter((revision: any) => !revision?.isLocalDraft)
    serverRevisions.sort(
        (a: any, b: any) => (b.updatedAtTimestamp ?? 0) - (a.updatedAtTimestamp ?? 0),
    )

    return [...localDrafts, ...serverRevisions]
})

/**
 * Latest server revision ID derived from the playground revision list.
 * Used by ensurePlaygroundDefaults() to select a default revision when
 * no selection exists.
 */
export const playgroundLatestRevisionIdAtom = selectAtom(
    playgroundRevisionListAtom,
    (revisions) => {
        const serverRevision = revisions.find((r: any) => !r.isLocalDraft)
        return serverRevision?.id ?? null
    },
    (a, b) => a === b,
)

// Re-export types for consumers
export type {AppListItem, VariantListItem, RevisionListItem}

// PERFORMANCE OPTIMIZATION: Single derived atom for all layout state
// This prevents usePlaygroundLayout from subscribing to multiple atoms
export const playgroundLayoutAtom = selectAtom(
    atom((get) => ({
        earlyDisplayedVariants: get(earlyDisplayedVariantsAtom),
        displayedVariants: get(displayedVariantsAtom),
        selectedVariants: get(selectedVariantsAtom),
    })),
    (state) => {
        // Use early displayed variants if available, otherwise fall back to regular ones
        const activeDisplayedVariants =
            state.earlyDisplayedVariants.length > 0
                ? state.earlyDisplayedVariants
                : state.displayedVariants

        const isComparisonView = state.selectedVariants?.length > 1

        return {
            displayedVariants: activeDisplayedVariants,
            selectedVariants: state.selectedVariants,
            isComparisonView,
            // Additional derived state
            variantCount: activeDisplayedVariants.length,
            usingEarlyVariants: state.earlyDisplayedVariants.length > 0,
        }
    },
    isEqual, // Only re-render if the computed layout state actually changes
)

// Focused boolean selector to avoid broad layout subscriptions
// Uses validated selection (filters stale IDs against revisions + tracked local drafts)
// This ensures comparison mode exits when stale local draft IDs are filtered out
export const isComparisonViewAtom = selectAtom(
    atom((get) => {
        const selected = get(selectedVariantsAtom) || []
        const revisions = get(playgroundRevisionListAtom) || []
        const trackedLocalDraftIds = get(localDraftIdsAtom) || []
        const isReady = get(playgroundRevisionsReadyAtom)

        // Filter to only valid IDs (same logic as displayedVariantsAtom)
        const validIds = selected.filter((id) => {
            if (isPlaceholderId(id)) return true
            if (isLocalDraftId(id)) {
                return (
                    trackedLocalDraftIds.includes(id) ||
                    revisions.some((revision: any) => revision.id === id)
                )
            }
            // Keep server revision IDs while data is still loading
            if (!isReady) return true
            return revisions.some((revision: any) => revision.id === id)
        })

        return validIds.length
    }),
    (count) => count > 1,
    (a, b) => a === b,
)

// Displayed variants (filtered selected variants that exist in the revision list)
export const displayedVariantsAtom = selectAtom(
    atom((get) => ({
        selected: get(selectedVariantsAtom),
        revisions: get(playgroundRevisionListAtom),
        trackedLocalDraftIds: get(localDraftIdsAtom),
        isReady: get(playgroundRevisionsReadyAtom),
    })),
    (state) => {
        const selected = state.selected || []
        const revisions = state.revisions || []

        const displayedIds = selected.filter((id) => {
            if (isPlaceholderId(id)) return true
            if (isLocalDraftId(id)) {
                const inTracked = state.trackedLocalDraftIds.includes(id)
                const inRevisions = revisions.some((revision: any) => revision.id === id)
                return inTracked || inRevisions
            }
            // Keep server revision IDs while data is still loading
            if (!state.isReady) return true
            return revisions.some((revision: any) => revision.id === id)
        })

        return displayedIds
    },
    isEqual,
)

// Variants by ID lookup map for O(1) access
export const variantsByIdAtom = selectAtom(
    atom((get) => {
        const appId = get(selectedAppIdAtom)
        if (!appId || isPromiseLike(appId)) return [] as any[]
        const variants = get(variantsListWithDraftsAtomFamily(appId))?.data ?? ([] as any[])
        return variants.filter((variant: any) => !variant?.isLocalDraftGroup)
    }),
    (variants) =>
        variants.reduce(
            (acc, variant: any) => {
                const id = variant?.id ?? variant?.variantId
                if (id) acc[id] = variant
                return acc
            },
            {} as Record<string, any>,
        ),
    isEqual,
)

// OPTIMIZATION: Early revision IDs atom for faster loading
// This provides revision IDs as soon as revisions are available,
// including local drafts
export const earlyRevisionIdsAtom = atom((get) => {
    const revisions = get(playgroundRevisionListAtom)

    if (!revisions || revisions.length === 0) {
        return []
    }

    // Extract all revision IDs from the merged list (server + local drafts)
    return revisions.map((revision: any) => revision.id).filter(Boolean)
})

// OPTIMIZATION: Early displayed variants atom using early revision IDs
// This can render components immediately when revision IDs are available
export const earlyDisplayedVariantsAtom = selectAtom(
    atom((get) => ({
        selected: get(selectedVariantsAtom),
        earlyRevisionIds: get(earlyRevisionIdsAtom),
        trackedLocalDraftIds: get(localDraftIdsAtom),
        isReady: get(playgroundRevisionsReadyAtom),
    })),
    (state) => {
        const selected = state.selected || []

        const displayedIds = selected.filter((id) => {
            if (isPlaceholderId(id)) return true
            if (isLocalDraftId(id)) {
                return (
                    state.trackedLocalDraftIds.includes(id) || state.earlyRevisionIds.includes(id)
                )
            }
            // Keep server revision IDs while data is still loading
            if (!state.isReady) return true
            return state.earlyRevisionIds.includes(id)
        })
        return displayedIds
    },
    isEqual,
)

/**
 * Displayed Variants Variable Collection
 * Collects all template variables from all currently displayed variants.
 * This ensures input fields include all variables from displayed variants
 * in both single variant mode and comparison mode for consistent UX.
 */
export const displayedVariantsVariablesAtom = selectAtom(
    atom((get) => ({
        displayedVariantIds: get(playgroundLayoutAtom).displayedVariants,
        revisions: get(playgroundRevisionListAtom) || [],
        isChat: get(appChatModeAtom),
        // Use molecule-backed prompts for single source of truth
        promptsByRevision: get(playgroundLayoutAtom).displayedVariants.map((id) => {
            return get(moleculeBackedPromptsAtomFamily(id))
        }),
        // Include schema + route for spec-derived input keys (custom workflows)
        spec: get(playgroundAppSchemaAtom),
        routePath: get(playgroundAppRoutePathAtom),
        appType: (() => {
            const ctx = get(currentAppContextAtom)
            return ctx && !isPromiseLike(ctx) ? ctx.appType || undefined : undefined
        })(),
        // Include custom properties for additional token extraction (molecule-backed)
        customPropsByRevision: get(playgroundLayoutAtom).displayedVariants.map((id) => {
            return get(moleculeBackedCustomPropertiesAtomFamily(id))
        }),
        // Pre-parsed ag_config detection (avoids fragile routePath lookup)
        hasAgConfig: get(playgroundHasAgConfigAtom),
    })),
    (state) => {
        const allVariables = new Set<string>()
        const appType = (() => {
            const app = getDefaultStore().get(currentAppAtom)
            return app && !isPromiseLike(app) ? app.app_type : undefined
        })()
        // Determine if this app is custom (no ag_config in schema).
        // Uses pre-parsed agConfigSchema instead of fragile
        // getRequestSchema path lookups (which fail when routePath is empty).
        // When hasAgConfig is undefined (still loading), treat as non-custom
        // to allow prompt-based variable extraction to proceed immediately.
        const hasAgConfig = state.hasAgConfig
        const isCustom =
            (appType || "") === "custom" || (hasAgConfig === false && Boolean(state.spec))
        if (!isCustom) {
            state.promptsByRevision.forEach((prompts) => {
                if (!prompts || !Array.isArray(prompts)) return

                prompts.forEach((prompt) => {
                    // Extract from message contents
                    const messages = (prompt as any)?.messages?.value || []
                    messages.forEach((message: any) => {
                        const content = message?.content?.value

                        if (typeof content === "string") {
                            const messageVars = extractVariables(content)
                            messageVars.forEach((variable) => allVariables.add(variable))
                        } else if (Array.isArray(content)) {
                            // Handle array content (multimodal messages)
                            content.forEach((part: any) => {
                                const text = part?.text?.value || ""
                                if (typeof text === "string") {
                                    const messageVars = extractVariables(text)
                                    messageVars.forEach((variable) => allVariables.add(variable))
                                }
                            })
                        }
                    })

                    // Extract from response format if present
                    // Handle both camelCase (llmConfig) and snake_case (llm_config) keys
                    const llmConfigKey = (prompt as any)?.llm_config ? "llm_config" : "llmConfig"
                    const llm = (prompt as any)?.[llmConfigKey]
                    const responseFormat = llm?.responseFormat?.value ?? llm?.response_format?.value
                    if (responseFormat) {
                        const responseVars = extractVariablesFromJson(responseFormat)
                        responseVars.forEach((variable) => allVariables.add(variable))
                    }

                    // Extract from tools schemas and string fields if present
                    const tools = llm?.tools?.value || []
                    if (Array.isArray(tools)) {
                        tools.forEach((tool: any) => {
                            // Some tools are stored under value.function.parameters (OpenAI-style function tools)
                            const fnParams = tool?.value?.function?.parameters
                            if (fnParams) {
                                const toolParamVars = extractVariablesFromJson(fnParams)
                                toolParamVars.forEach((v) => allVariables.add(v))
                            }

                            // Also scan common string fields for tokens
                            const fnName = tool?.value?.function?.name
                            if (typeof fnName === "string") {
                                extractVariables(fnName).forEach((v) => allVariables.add(v))
                            }
                            const fnDescription = tool?.value?.function?.description
                            if (typeof fnDescription === "string") {
                                extractVariables(fnDescription).forEach((v) => allVariables.add(v))
                            }

                            // Generic tool.description (non-function types)
                            const toolDesc = tool?.value?.description
                            if (typeof toolDesc === "string") {
                                extractVariables(toolDesc).forEach((v) => allVariables.add(v))
                            }
                            // Generic tool.parameters schema (non-function types)
                            const toolParams = tool?.value?.parameters
                            if (toolParams) {
                                const genericParamVars = extractVariablesFromJson(toolParams)
                                genericParamVars.forEach((v) => allVariables.add(v))
                            }
                        })
                    }
                })
            })
        } else if (state.spec) {
            //
            const inputKeys = extractInputKeysFromSchema(state.spec as any, state.routePath)
            inputKeys.forEach((k) => allVariables.add(k))
        }

        return Array.from(allVariables)
    },
    isEqual,
)

/**
 * Schema Input Keys
 * Returns input keys directly derived from the app's OpenAPI request schema
 * for the current routePath. This is a pure view (no side-effects) and is
 * useful for debugging or downstream consumers that want schema-only keys.
 */
export const schemaInputKeysAtom = selectAtom(
    atom((get) => {
        const spec = get(playgroundAppSchemaAtom)
        const routePath = get(playgroundAppRoutePathAtom)
        if (!spec) return [] as string[]
        try {
            const keys = extractInputKeysFromSchema(spec as any, routePath)
            return keys
        } catch {
            return [] as string[]
        }
    }),
    (keys) => keys,
    isEqual,
)

// ============================================================================
// RECENT REVISIONS FOR OVERVIEW PAGE
// ============================================================================

/**
 * Recent revisions formatted for the overview table.
 * Pipeline B replacement for the old `recentRevisionsTableRowsAtom`.
 * Returns the 5 most recently updated server revisions with pre-formatted fields.
 *
 * Lives here (not in playgroundAppAtoms) to avoid a circular import:
 * playgroundAppAtoms ↔ variants would deadlock on `selectAtom(playgroundRevisionListAtom)`.
 */
export const recentRevisionsOverviewAtom = selectAtom(
    playgroundRevisionListAtom,
    (revisions) =>
        revisions
            .filter((r: any) => !r.isLocalDraft)
            .slice(0, 5)
            .map((r: any) => {
                const ts = r.updatedAtTimestamp ?? r.createdAtTimestamp
                const params = r.parameters || {}
                const llmConfig = params?.prompt?.llm_config || params
                const modelName =
                    typeof llmConfig?.model === "string" && llmConfig.model.trim()
                        ? llmConfig.model
                        : undefined
                return {
                    ...r,
                    createdAt: formatDate24(ts),
                    modelName,
                }
            }),
    isEqual,
)

// Re-export as revisionListAtom for backward compatibility
export {playgroundRevisionListAtom as revisionListAtom}
