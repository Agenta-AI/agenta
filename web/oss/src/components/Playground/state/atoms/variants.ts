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
import {currentAppContextAtom} from "@/oss/state/app/selectors/app"
import {customPropertiesByRevisionAtomFamily} from "@/oss/state/newPlayground/core/customProperties"
import {promptsAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {
    variantsAtom as rawVariantsAtom,
    variantRevisionsQueryFamily,
    variantsAtom,
} from "@/oss/state/variant/atoms/fetcher"
import {appSchemaAtom, appUriInfoAtom} from "@/oss/state/variant/atoms/fetcher"

import {revisionListAtom} from "../../../../state/variant/selectors/variant"

import {appChatModeAtom} from "./app"
import {selectedVariantsAtom} from "./core"

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
export const displayedVariantsAtom = selectAtom(
    atom((get) => ({
        selected: get(selectedVariantsAtom),
        revisions: get(revisionListAtom),
    })),
    (state) => {
        // Filter selectedVariants (revision IDs) against actual revision data
        const displayedIds = state.selected.filter((id) =>
            state.revisions?.some((revision) => revision.id === id),
        )

        return displayedIds
    },
    isEqual, // PERFORMANCE OPTIMIZATION: Only re-render if the actual IDs array changes
)

// Variants by ID lookup map for O(1) access
export const variantsByIdAtom = selectAtom(
    variantsAtom,
    (variants) =>
        variants.reduce((acc, v: any) => ({...acc, [v.variantId]: v}), {} as Record<string, any>),
    isEqual,
)

// OPTIMIZATION: Early revision IDs atom for faster loading
// This provides revision IDs as soon as raw variants and their revisions are available,
// without waiting for enhanced/transformed data
export const earlyRevisionIdsAtom = atom((get) => {
    const rawVariants = get(rawVariantsAtom)

    if (!rawVariants || rawVariants.length === 0) {
        return []
    }

    // Get all revision IDs from raw variant revision queries
    const allRevisionIds: string[] = []

    rawVariants.forEach((variant) => {
        if (variant.variantId) {
            const revisionsQuery = get(variantRevisionsQueryFamily(variant.variantId))
            const revisions = (revisionsQuery as any)?.data || []

            // Add revision IDs (these are the actual revision IDs the playground needs)
            revisions.forEach((revision: any) => {
                if (revision.id) {
                    allRevisionIds.push(revision.id)
                }
            })
        }
    })

    return allRevisionIds
})

// OPTIMIZATION: Early displayed variants atom using early revision IDs
// This can render components immediately when revision IDs are available
export const earlyDisplayedVariantsAtom = selectAtom(
    atom((get) => ({
        selected: get(selectedVariantsAtom),
        earlyRevisionIds: get(earlyRevisionIdsAtom),
    })),
    (state) => {
        // Filter selectedVariants (revision IDs) against early revision IDs
        const displayedIds = state.selected.filter((id) => state.earlyRevisionIds.includes(id))
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
        revisions: get(revisionListAtom) || [],
        isChat: get(appChatModeAtom),
        promptsByRevision: get(playgroundLayoutAtom).displayedVariants.map((id) => {
            return get(promptsAtomFamily(id))
        }),
        // Include schema + route for spec-derived input keys (custom workflows)
        spec: get(appSchemaAtom),
        routePath: get(appUriInfoAtom)?.routePath || "",
        appType: get(currentAppContextAtom)?.appType || undefined,
        // Include custom properties for additional token extraction
        customPropsByRevision: get(playgroundLayoutAtom).displayedVariants.map((id) => {
            return get(customPropertiesByRevisionAtomFamily(id))
        }),
    })),
    (state) => {
        const allVariables = new Set<string>()
        const appType = getDefaultStore().get(currentAppAtom)?.app_type
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

// Re-export revisionListAtom for use in other files
export {revisionListAtom}
