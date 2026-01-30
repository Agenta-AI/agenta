import {
    ossAppsListAtom,
    ossAppToVariantRelation,
    ossVariantToRevisionRelation,
    isLocalDraftId,
    localDraftIdsAtom,
    variantsListWithDraftsAtomFamily,
    revisionsListWithDraftsAtomFamily,
    type AppListItem,
    type VariantListItem,
    type RevisionListItem,
} from "@agenta/entities/ossAppRevision"
import isEqual from "fast-deep-equal"
import {atom, getDefaultStore} from "jotai"
import {selectAtom} from "jotai/utils"

import {
    extractVariables,
    extractVariablesFromJson,
    extractInputKeysFromSchema,
} from "@/oss/lib/shared/variant/inputHelpers"
import {getRequestSchema} from "@/oss/lib/shared/variant/openapiUtils"
import {currentAppAtom} from "@/oss/state/app"
import {currentAppContextAtom, selectedAppIdAtom} from "@/oss/state/app/selectors/app"
import {
    moleculeBackedPromptsAtomFamily,
    moleculeBackedCustomPropertiesAtomFamily,
} from "@/oss/state/newPlayground/legacyEntityBridge"
import {appSchemaAtom, appUriInfoAtom} from "@/oss/state/variant/atoms/fetcher"

import {appChatModeAtom} from "./app"
import {selectedVariantsAtom} from "./core"

const isPromiseLike = (value: unknown): value is Promise<unknown> =>
    Boolean(value && typeof (value as {then?: unknown}).then === "function")

// ============================================================================
// WP-6.1: MOLECULE-BACKED LIST WRAPPER ATOMS
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
// WP-6.2: PLAYGROUND REVISION LIST ATOM
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
            const timestamp = createdAt ? new Date(createdAt).valueOf() : Date.now()
            const safeTimestamp = Number.isNaN(timestamp) ? Date.now() : timestamp

            return {
                ...revision,
                variantId: revision.variantId ?? variant.id,
                variantName: revision.variantName ?? variantName,
                createdAtTimestamp: safeTimestamp,
                updatedAtTimestamp: safeTimestamp,
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
export const isComparisonViewAtom = selectAtom(
    selectedVariantsAtom,
    (selected) => (selected?.length || 0) > 1,
    (a, b) => a === b,
)

// Displayed variants (filtered selected variants that exist)
// WP-6.3: Updated to use playgroundRevisionListAtom
export const displayedVariantsAtom = selectAtom(
    atom((get) => ({
        selected: get(selectedVariantsAtom),
        revisions: get(playgroundRevisionListAtom),
        trackedLocalDraftIds: get(localDraftIdsAtom),
    })),
    (state) => {
        // Guard against undefined/null selected array
        const selected = state.selected || []

        // Filter selectedVariants (revision IDs) against actual revision data
        // For local drafts, check if they're actually tracked (not just by ID format)
        const displayedIds = selected.filter(
            (id) =>
                (isLocalDraftId(id) && state.trackedLocalDraftIds.includes(id)) ||
                state.revisions?.some((revision: any) => revision.id === id),
        )

        return displayedIds
    },
    isEqual, // PERFORMANCE OPTIMIZATION: Only re-render if the actual IDs array changes
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
// WP-6.3: Updated to derive from playgroundRevisionListAtom (molecule-backed)
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
    })),
    (state) => {
        // Guard against undefined/null selected array
        const selected = state.selected || []

        // Filter selectedVariants (revision IDs) against early revision IDs
        // For local drafts, check if they're actually tracked (not just by ID format)
        const displayedIds = selected.filter(
            (id) =>
                (isLocalDraftId(id) && state.trackedLocalDraftIds.includes(id)) ||
                state.earlyRevisionIds.includes(id),
        )
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
// WP-6.3: Updated to use playgroundRevisionListAtom
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
        spec: get(appSchemaAtom),
        routePath: get(appUriInfoAtom)?.routePath || "",
        appType: (() => {
            const ctx = get(currentAppContextAtom)
            return ctx && !isPromiseLike(ctx) ? ctx.appType || undefined : undefined
        })(),
        // Include custom properties for additional token extraction (molecule-backed)
        customPropsByRevision: get(playgroundLayoutAtom).displayedVariants.map((id) => {
            return get(moleculeBackedCustomPropertiesAtomFamily(id))
        }),
    })),
    (state) => {
        const allVariables = new Set<string>()
        const appType = (() => {
            const app = getDefaultStore().get(currentAppAtom)
            return app && !isPromiseLike(app) ? app.app_type : undefined
        })()
        // Determine if this app is custom (no inputs/messages container in schema)
        const req = state.spec
            ? (getRequestSchema as any)(state.spec, {routePath: state.routePath})
            : undefined
        const isCustom =
            (appType || "") === "custom" ||
            (Boolean(state.spec) && !req?.properties?.inputs && !req?.properties?.messages)

        // Collect variables from all displayed revisions' local prompts (non-custom apps only)
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
                    const responseFormat = (prompt as any)?.llmConfig?.responseFormat?.value
                    if (responseFormat) {
                        const responseVars = extractVariablesFromJson(responseFormat)
                        responseVars.forEach((variable) => allVariables.add(variable))
                    }

                    // Extract from tools schemas and string fields if present
                    const tools = (prompt as any)?.llmConfig?.tools?.value || []
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
        const spec = get(appSchemaAtom)
        const routePath = get(appUriInfoAtom)?.routePath || ""
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

// Re-export revisionListAtom for backward compatibility
// WP-6.6: Export playgroundRevisionListAtom as the primary list
export {playgroundRevisionListAtom as revisionListAtom}
