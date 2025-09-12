import {produce} from "immer"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {forceSyncPromptVariablesToNormalizedAtom} from "@/oss/components/Playground/state/atoms/generationMutations"
import type {EnhancedObjectConfig} from "@/oss/lib/shared/variant/genericTransformer/types"
import {extractVariables} from "@/oss/lib/shared/variant/inputHelpers"
import {
    derivePromptsFromSpec,
    deriveCustomPropertiesFromSpec,
} from "@/oss/lib/shared/variant/transformer/transformer"
import {transformToRequestBody} from "@/oss/lib/shared/variant/transformer/transformToRequestBody"
import type {AgentaConfigPrompt, EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {
    appSchemaAtom,
    appUriInfoAtom,
    getEnhancedRevisionById,
} from "@/oss/state/variant/atoms/fetcher"

import {customPropertiesByRevisionAtomFamily} from "./customProperties"
import {currentAppContextAtom} from "@/oss/state/newApps/selectors/apps"
import {variantFlagsAtomFamily} from "./variantFlags"

/**
 * Writable prompts selector
 * - Read: derives prompts from OpenAPI spec + saved parameters (pure; no mutation)
 * - Write: forwards updates via `onUpdateParameters` callback to persist playground mutations
 */
export interface PromptsAtomParams {
    // Prefer passing only revisionId; variant will be resolved internally if not provided
    variant?: EnhancedVariant
    // revision this prompts write should target; required for local cache updates and variant resolution
    revisionId?: string
    // Called on writes; receives a delta or next parameters snapshot as provided by caller
    onUpdateParameters?: (update: any) => void
}

// Internal local prompts cache keyed by revisionId (Playground-only live edits)
const localPromptsByRevisionAtomFamily = atomFamily((revisionId: string) =>
    atom<any[] | null>(null),
)

/**
 * Stable prompts selector keyed ONLY by revisionId (prevents unstable atomFamily keys)
 * - Read: derives prompts from OpenAPI spec + saved parameters (reactive)
 * - Write: updates local revision cache for live edits
 */
// export const promptsByRevisionAtomFamily = atomFamily((revisionId: string) =>
export const promptsAtomFamily = atomFamily((revisionId: string) =>
    atom<EnhancedObjectConfig<AgentaConfigPrompt>[], any, void>(
        (get) => {
            // Prefer local prompts cache when available
            if (revisionId) {
                const local = get(localPromptsByRevisionAtomFamily(revisionId))
                if (Array.isArray(local) && local.length > 0) {
                    return local as unknown as EnhancedObjectConfig<AgentaConfigPrompt>[]
                }
            }

            // Derive variant reactively from revisionId
            const variant = getEnhancedRevisionById(get as any, revisionId) as any
            if (!variant) return []

            // Reactive spec + route
            const spec = get(appSchemaAtom)
            if (!spec) return []
            const routePath = get(appUriInfoAtom)?.routePath
            const derivedPrompts = derivePromptsFromSpec(variant, spec, routePath)

            // Note: do not write to atoms during read; this can cause recursive updates/stack overflows
            // If caching is desired, perform it in the write path or via a component effect.
            return derivedPrompts
        },
        (get, set, update) => {
            // Writes target local cache by revisionId
            const current = get(localPromptsByRevisionAtomFamily(revisionId))

            // If no local cache exists yet, seed it from the derived prompts so that
            // recipe updaters receive a proper mutable draft instead of null.
            let base = current
            if (!base) {
                try {
                    const variant = getEnhancedRevisionById(get as any, revisionId)
                    const spec = get(appSchemaAtom)
                    const routePath = get(appUriInfoAtom)?.routePath
                    base =
                        variant && spec
                            ? derivePromptsFromSpec(variant as any, spec as any, routePath)
                            : []
                } catch {
                    base = []
                }
            }

            let next: any
            if (typeof update === "function") {
                const fn: any = update
                if (fn.length >= 1) {
                    // Treat as Immer recipe on the seeded base value
                    next = produce(base, fn)
                } else {
                    const res = fn(base)
                    next = res === undefined ? base : res
                }
            } else {
                next = update
            }

            set(localPromptsByRevisionAtomFamily(revisionId), next)

            // Ensure normalized variables reflect prompt changes (add/remove/edit messages)
            // Defer one tick so extraction selectors see the latest prompts before syncing
            try {
                setTimeout(() => {
                    try {
                        set(forceSyncPromptVariablesToNormalizedAtom)
                    } catch {}
                }, 0)
            } catch {}
        },
    ),
)

/**
 * Clears the local prompts cache for a given revisionId.
 * Use this after a successful commit to ensure the previous revision's local edits are discarded.
 */
export const clearLocalPromptsForRevisionAtomFamily = atomFamily((revisionId: string) =>
    atom(null, (_get, set) => {
        set(localPromptsByRevisionAtomFamily(revisionId), null)
    }),
)

/**
 * Transformed prompts to API request body
 * Backwards compatible signature: accepts either revisionId (string)
 * or an object with a flag to use stable revision parameters instead of local mutated prompts.
 */
export const transformedPromptsAtomFamily = atomFamily(
    (p: string | {revisionId: string; useStableParams?: boolean}) =>
        atom((get) => {
            const revisionId = typeof p === "string" ? p : p.revisionId
            const useStable = typeof p === "object" && !!p.useStableParams

            let promptsForTransform: any[] | undefined

            if (useStable) {
                // Derive prompts from spec + saved revision parameters only (no local draft state)
                try {
                    const variant = getEnhancedRevisionById(get as any, revisionId)
                    const spec = get(appSchemaAtom)
                    const routePath = get(appUriInfoAtom)?.routePath
                    if (variant && spec) {
                        promptsForTransform = derivePromptsFromSpec(
                            variant as any,
                            spec as any,
                            routePath,
                        ) as any[]
                    } else {
                        promptsForTransform = []
                    }
                } catch {
                    promptsForTransform = []
                }
            } else {
                // Default: use local mutated prompts cache
                promptsForTransform = get(promptsAtomFamily(revisionId)) as any[]
            }

            const variables = useStable
                ? get(stablePromptVariablesAtomFamily(revisionId))
                : get(promptVariablesAtomFamily(revisionId))

            // For useStable, ensure custom properties come from saved revision + spec (ignore local cache)
            const customProps = (() => {
                if (useStable) {
                    try {
                        const variant = getEnhancedRevisionById(get as any, revisionId)
                        const spec = get(appSchemaAtom)
                        const routePath = get(appUriInfoAtom)?.routePath
                        if (variant && spec) {
                            return deriveCustomPropertiesFromSpec(
                                variant as any,
                                spec as any,
                                routePath,
                            )
                        }
                        return {}
                    } catch {
                        return {}
                    }
                }
                return get(customPropertiesByRevisionAtomFamily(revisionId))
            })()

            const appType = get(currentAppContextAtom)?.appType || undefined
            const currentParams = transformToRequestBody({
                prompts: promptsForTransform,
                customProperties: customProps,
                isChat: get(variantFlagsAtomFamily({revisionId}))?.isChat,
                revisionId,
                appType,
                variables,
            })

            return currentParams
        }),
)

/**
 * Derived: variables used in prompts' messages for a given revision
 * - Read-only (no setter)
 * - Extracts tokens like {{variable}} from message content (string or array parts)
 */
export const promptVariablesAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        // Do not derive variables from prompt messages for custom workflows
        const flags = get(variantFlagsAtomFamily({revisionId}))
        if (flags?.isCustom) return [] as string[]
        const prompts = get(promptsAtomFamily(revisionId))
        const vars = new Set<string>()

        if (Array.isArray(prompts)) {
            prompts.forEach((prompt) => {
                const messages = (prompt as any)?.messages?.value || []
                messages.forEach((message: any) => {
                    const content = message?.content?.value
                    if (typeof content === "string") {
                        extractVariables(content).forEach((v) => vars.add(v))
                    } else if (Array.isArray(content)) {
                        content.forEach((part: any) => {
                            const text = part?.text?.value ?? part?.text ?? ""
                            if (typeof text === "string") {
                                extractVariables(text).forEach((v) => vars.add(v))
                            }
                        })
                    }
                })
            })
        }

        return Array.from(vars)
    }),
)

/**
 * Stable prompt variables (from saved revision parameters only)
 * - Ignores local edits; derives prompts from saved parameters + schema
 * - Used for custom workflows to keep only initial variables
 */
export const stablePromptVariablesAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        try {
            const variant = getEnhancedRevisionById(get as any, revisionId)
            const spec = get(appSchemaAtom)
            const routePath = get(appUriInfoAtom)?.routePath
            if (!variant || !spec) return [] as string[]
            const prompts = derivePromptsFromSpec(variant as any, spec as any, routePath)

            const vars = new Set<string>()
            ;(prompts || []).forEach((prompt: any) => {
                const messages = (prompt as any)?.messages?.value || []
                messages.forEach((message: any) => {
                    const content = message?.content?.value
                    if (typeof content === "string") {
                        extractVariables(content).forEach((v) => vars.add(v))
                    } else if (Array.isArray(content)) {
                        content.forEach((part: any) => {
                            const text = part?.text?.value ?? part?.text ?? ""
                            if (typeof text === "string") {
                                extractVariables(text).forEach((v) => vars.add(v))
                            }
                        })
                    }
                })
            })
            return Array.from(vars)
        } catch {
            return [] as string[]
        }
    }),
)

/**
 * Variables for a specific prompt within a revision.
 * Reuses the same extraction logic but scopes to a single prompt (__name or __id match).
 */
export const promptVariablesByPromptAtomFamily = atomFamily(
    (p: {revisionId: string; promptId: string}) =>
        atom((get) => {
            // Do not derive variables from prompt messages for custom workflows
            const flags = get(variantFlagsAtomFamily({revisionId: p.revisionId}))
            if (flags?.isCustom) return [] as string[]
            const prompts = get(promptsAtomFamily(p.revisionId))
            const list = Array.isArray(prompts) ? prompts : []
            const target =
                list.find((pr: any) => pr?.__name === p.promptId) ||
                list.find((pr: any) => pr?.__id === p.promptId)
            if (!target) return [] as string[]

            const vars = new Set<string>()
            const messages = (target as any)?.messages?.value || []
            messages.forEach((message: any) => {
                const content = message?.content?.value
                if (typeof content === "string") {
                    extractVariables(content).forEach((v) => vars.add(v))
                } else if (Array.isArray(content)) {
                    content.forEach((part: any) => {
                        const text = part?.text?.value ?? part?.text ?? ""
                        if (typeof text === "string") {
                            extractVariables(text).forEach((v) => vars.add(v))
                        }
                    })
                }
            })
            return Array.from(vars)
        }),
)
