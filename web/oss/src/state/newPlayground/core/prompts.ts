import {produce} from "immer"
import {atom} from "jotai"
import {RESET, atomFamily} from "jotai/utils"

import {metadataAtom} from "@/oss/lib/hooks/useStatelessVariants/state"
import type {EnhancedObjectConfig} from "@/oss/lib/shared/variant/genericTransformer/types"
import {extractVariables} from "@/oss/lib/shared/variant/inputHelpers"
import {generateId} from "@/oss/lib/shared/variant/stringUtils"
import {derivePromptsFromSpec} from "@/oss/lib/shared/variant/transformer/transformer"
import {transformToRequestBody} from "@/oss/lib/shared/variant/transformer/transformToRequestBody"
import type {AgentaConfigPrompt, EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {currentAppContextAtom} from "@/oss/state/app/selectors/app"
import {
    appSchemaAtom,
    appUriInfoAtom,
    getEnhancedRevisionById,
} from "@/oss/state/variant/atoms/fetcher"

import {
    customPropertiesByRevisionAtomFamily,
    derivedCustomPropsByRevisionAtomFamily,
} from "./customProperties"
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

// Derived prompts reactively recompute from variant + schema for a revision
const derivedPromptsByRevisionAtomFamily = atomFamily((revisionId: string) =>
    atom<EnhancedObjectConfig<AgentaConfigPrompt>[]>((get) => {
        const variant = getEnhancedRevisionById(get as any, revisionId)
        const spec = get(appSchemaAtom)
        if (!variant || !spec) return []
        const routePath = get(appUriInfoAtom)?.routePath
        return derivePromptsFromSpec(variant as any, spec as any, routePath)
    }),
)

const localTransformedPromptsByRevisionAtomFamily = atomFamily((revisionId: string) =>
    atom<any | undefined>(undefined),
)

const derivedTransformedPromptsByRevisionAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        const prompts = get(derivedPromptsByRevisionAtomFamily(revisionId))
        const customProps = get(derivedCustomPropsByRevisionAtomFamily(revisionId))
        const variables = get(stablePromptVariablesAtomFamily(revisionId))
        const appType = get(currentAppContextAtom)?.appType || undefined
        const isChat = get(variantFlagsAtomFamily({revisionId}))?.isChat
        const metadata = get(metadataAtom)
        return transformToRequestBody({
            prompts,
            customProperties: customProps,
            allMetadata: metadata,
            isChat,
            revisionId,
            appType,
            variables,
        })
    }),
)

export const clearLocalTransformedPromptsForRevisionAtomFamily = atomFamily((revisionId: string) =>
    atom(null, (_get, set) => {
        set(localTransformedPromptsByRevisionAtomFamily(revisionId), undefined)
    }),
)

const buildLiveTransformedPrompts = (get: any, revisionId: string) => {
    const promptsForTransform = get(promptsAtomFamily(revisionId)) as any[]
    const variables = get(promptVariablesAtomFamily(revisionId))
    const customProps = get(customPropertiesByRevisionAtomFamily(revisionId))
    const appType = get(currentAppContextAtom)?.appType || undefined
    const isChat = get(variantFlagsAtomFamily({revisionId}))?.isChat
    const metadata = get(metadataAtom)

    const transformed = transformToRequestBody({
        prompts: promptsForTransform,
        customProperties: customProps,
        allMetadata: metadata,
        isChat,
        revisionId,
        appType,
        variables,
    })

    return transformed
}

const regenerateEnhancedPromptIds = (value: any): any => {
    if (Array.isArray(value)) {
        return value.map((item) => regenerateEnhancedPromptIds(item))
    }

    if (value && typeof value === "object") {
        const clone: Record<string, any> = {}
        Object.keys(value).forEach((key) => {
            clone[key] = regenerateEnhancedPromptIds(value[key])
        })

        if ("__id" in clone) {
            clone.__id = generateId()
        }

        if ("__test" in clone) {
            clone.__test = generateId()
        }

        return clone
    }

    return value
}

const collectVariablesFromPrompts = (prompts: any[]): string[] => {
    const vars = new Set<string>()

    ;(prompts || []).forEach((prompt) => {
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
}

const localPromptVariablesByRevisionAtomFamily = atomFamily((revisionId: string) =>
    atom<string[] | undefined>(undefined),
)

const derivedStablePromptVariablesAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        try {
            const variant = getEnhancedRevisionById(get as any, revisionId)
            const spec = get(appSchemaAtom)
            const routePath = get(appUriInfoAtom)?.routePath
            if (!variant || !spec) return [] as string[]
            const prompts = derivePromptsFromSpec(variant as any, spec as any, routePath)
            return collectVariablesFromPrompts(prompts as any[])
        } catch {
            return [] as string[]
        }
    }),
)

const buildLivePromptVariables = (get: any, revisionId: string): string[] => {
    const flags = get(variantFlagsAtomFamily({revisionId}))
    if (flags?.isCustom) return [] as string[]
    const prompts = get(promptsAtomFamily(revisionId))
    return collectVariablesFromPrompts(Array.isArray(prompts) ? prompts : [])
}

// Local prompts cache keyed by revisionId (Playground-only live edits)
const localPromptsByRevisionAtomFamily = atomFamily((revisionId: string) =>
    atom<EnhancedObjectConfig<AgentaConfigPrompt>[] | null>(null),
)

/**
 * Stable prompts selector keyed ONLY by revisionId (prevents unstable atomFamily keys)
 * - Read: derives prompts from OpenAPI spec + saved parameters (reactive)
 * - Write: updates local revision cache for live edits
 */
export const promptsAtomFamily = atomFamily((revisionId: string) =>
    atom<EnhancedObjectConfig<AgentaConfigPrompt>[], any, void>(
        (get) => {
            // Prefer local prompts cache when available
            if (!revisionId) return []
            const local = get(localPromptsByRevisionAtomFamily(revisionId))
            if (Array.isArray(local)) return local
            return get(derivedPromptsByRevisionAtomFamily(revisionId))
        },
        (get, set, update) => {
            if (update === RESET) {
                set(localPromptsByRevisionAtomFamily(revisionId), null)
                return
            }
            const base =
                get(localPromptsByRevisionAtomFamily(revisionId)) ??
                get(derivedPromptsByRevisionAtomFamily(revisionId))

            let next: any
            if (typeof update === "function") {
                const fn: any = update
                if (fn.length >= 1) {
                    next = produce(base, fn)
                } else {
                    const res = fn(base)
                    next = res === undefined ? base : res
                }
            } else {
                next = update
            }

            set(localPromptsByRevisionAtomFamily(revisionId), next)
            // No explicit sync; variable selectors derive live state from prompts and rows
        },
    ),
)

/**
 * Clears the local prompts cache for a given revisionId.
 * Use this after a successful commit to ensure the previous revision's local edits are discarded.
 */
export const clearLocalPromptsForRevisionAtomFamily = atomFamily((revisionId: string) =>
    atom(null, (get, set) => {
        const derived = get(derivedPromptsByRevisionAtomFamily(revisionId))
        const regenerated = regenerateEnhancedPromptIds(derived)
        set(
            localPromptsByRevisionAtomFamily(revisionId),
            Array.isArray(regenerated) ? (regenerated as any) : null,
        )
    }),
)

/**
 * Transformed prompts to API request body
 * Backwards compatible signature: accepts either revisionId (string)
 * or an object with a flag to use stable revision parameters instead of local mutated prompts.
 */
export const transformedPromptsAtomFamily = atomFamily(
    (p: string | {revisionId: string; useStableParams?: boolean}) =>
        atom<any, any, void>(
            (get, set, update) => {
                const revisionId = typeof p === "string" ? p : p.revisionId
                const useStable = typeof p === "object" && !!p.useStableParams

                if (useStable) {
                    return get(derivedTransformedPromptsByRevisionAtomFamily(revisionId))
                }

                const local = get(localTransformedPromptsByRevisionAtomFamily(revisionId))
                if (local !== undefined) return local

                return buildLiveTransformedPrompts(get, revisionId)
            },
            (get, set, update) => {
                const revisionId = typeof p === "string" ? p : p.revisionId
                const useStable = typeof p === "object" && !!p.useStableParams

                if (useStable) return

                if (update === RESET) {
                    set(localTransformedPromptsByRevisionAtomFamily(revisionId), undefined)
                    return
                }

                const base =
                    get(localTransformedPromptsByRevisionAtomFamily(revisionId)) ??
                    buildLiveTransformedPrompts(get, revisionId)

                let next: any
                if (typeof update === "function") {
                    const fn: any = update
                    if (fn.length >= 1) {
                        next = produce(base, fn)
                    } else {
                        const res = fn(base)
                        next = res === undefined ? base : res
                    }
                } else {
                    next = update
                }

                set(localTransformedPromptsByRevisionAtomFamily(revisionId), next)
            },
        ),
)

/**
 * Derived: variables used in prompts' messages for a given revision
 * - Read-only (no setter)
 * - Extracts tokens like {{variable}} from message content (string or array parts)
 */
export const promptVariablesAtomFamily = atomFamily((revisionId: string) =>
    atom<string[], any, void>(
        (get, set, update) => {
            const local = get(localPromptVariablesByRevisionAtomFamily(revisionId))
            if (local !== undefined) return local
            return buildLivePromptVariables(get, revisionId)
        },
        (get, set, update) => {
            if (update === RESET) {
                set(localPromptVariablesByRevisionAtomFamily(revisionId), undefined)
                return
            }

            const base =
                get(localPromptVariablesByRevisionAtomFamily(revisionId)) ??
                buildLivePromptVariables(get, revisionId)

            let next: string[]
            if (typeof update === "function") {
                const fn: any = update
                const res = fn(base)
                next = res === undefined ? base : res
            } else {
                next = update
            }

            set(localPromptVariablesByRevisionAtomFamily(revisionId), next)
        },
    ),
)

/**
 * Stable prompt variables (from saved revision parameters only)
 * - Ignores local edits; derives prompts from saved parameters + schema
 * - Used for custom workflows to keep only initial variables
 */
export const stablePromptVariablesAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        return get(derivedStablePromptVariablesAtomFamily(revisionId))
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
            return collectVariablesFromPrompts([target])
        }),
)
