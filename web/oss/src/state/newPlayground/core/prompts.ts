import {ossAppRevisionMolecule} from "@agenta/entities/ossAppRevision"
import {produce} from "immer"
import {atom} from "jotai"
import {RESET, atomFamily} from "jotai/utils"

import {metadataAtom} from "@/oss/lib/hooks/useStatelessVariants/state"
import type {EnhancedObjectConfig} from "@/oss/lib/shared/variant/genericTransformer/types"
import {extractVariables} from "@/oss/lib/shared/variant/inputHelpers"
import {derivePromptsFromSpec} from "@/oss/lib/shared/variant/transformer/transformer"
import {transformToRequestBody} from "@/oss/lib/shared/variant/transformer/transformToRequestBody"
import type {AgentaConfigPrompt, EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {currentAppContextAtom} from "@/oss/state/app/selectors/app"
import {appSchemaAtom, appUriInfoAtom} from "@/oss/state/variant/atoms/fetcher"

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

// Debug logging for resolveRevisionSource
const DEBUG_RESOLVE = process.env.NODE_ENV === "development"
const logResolve = (...args: unknown[]) => {
    if (DEBUG_RESOLVE) {
        console.info("[newPlayground/prompts/resolve]", ...args)
    }
}

/**
 * Resolves revision data from the molecule (single source of truth).
 * No legacy fallbacks - molecule is the authoritative source.
 */
const resolveRevisionSource = (get: any, revisionId: string): EnhancedVariant | undefined => {
    // Prefer merged data (includes draft changes)
    const moleculeData = get(ossAppRevisionMolecule.atoms.data(revisionId)) as any
    if (moleculeData) {
        logResolve("resolveRevisionSource: returning moleculeData", {
            revisionId,
            hasParameters: !!moleculeData.parameters,
            parametersKeys: moleculeData.parameters ? Object.keys(moleculeData.parameters) : [],
            hasUri: !!moleculeData.uri,
        })
        return moleculeData as EnhancedVariant
    }

    // Fallback to server data if no merged data yet
    const serverData = get(ossAppRevisionMolecule.atoms.serverData(revisionId)) as any
    if (serverData) {
        logResolve("resolveRevisionSource: returning serverData", {
            revisionId,
            hasParameters: !!serverData.parameters,
            parametersKeys: serverData.parameters ? Object.keys(serverData.parameters) : [],
            hasUri: !!serverData.uri,
        })
        return serverData as EnhancedVariant
    }

    logResolve("resolveRevisionSource: no data found", {revisionId})
    return undefined
}

// Derived prompts reactively recompute from variant + schema for a revision
// Exported for server data initialization (baseline for isDirty comparison)
export const derivedPromptsByRevisionAtomFamily = atomFamily((revisionId: string) =>
    atom<EnhancedObjectConfig<AgentaConfigPrompt>[]>((get) => {
        const variant = resolveRevisionSource(get, revisionId)
        const spec = get(appSchemaAtom)
        if (!variant || !spec) {
            logResolve("derivedPromptsByRevisionAtomFamily: missing variant or spec", {
                revisionId,
                hasVariant: !!variant,
                hasSpec: !!spec,
            })
            return []
        }
        const routePath = get(appUriInfoAtom)?.routePath
        const prompts = derivePromptsFromSpec(variant as any, spec as any, routePath)
        logResolve("derivedPromptsByRevisionAtomFamily: derived prompts", {
            revisionId,
            promptCount: prompts.length,
            routePath,
        })
        return prompts
    }),
)

// Internal cache for transformed prompts - exported for unified discard
export const localTransformedPromptsByRevisionAtomFamily = atomFamily((revisionId: string) =>
    atom<any | undefined>(undefined),
)

const derivedTransformedPromptsByRevisionAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        const variant = resolveRevisionSource(get, revisionId)
        const prompts = get(derivedPromptsByRevisionAtomFamily(revisionId))
        const customProps = get(derivedCustomPropsByRevisionAtomFamily(revisionId))
        const variables = get(stablePromptVariablesAtomFamily(revisionId))
        const appType = get(currentAppContextAtom)?.appType || undefined
        const isChat = get(variantFlagsAtomFamily({revisionId}))?.isChat
        const metadata = get(metadataAtom)
        return transformToRequestBody({
            variant: variant as any,
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

const buildLiveTransformedPrompts = (get: any, revisionId: string) => {
    const variant = resolveRevisionSource(get, revisionId)
    const promptsForTransform = get(promptsAtomFamily(revisionId)) as any[]
    const variables = get(promptVariablesAtomFamily(revisionId))
    const customProps = get(customPropertiesByRevisionAtomFamily(revisionId))
    const appType = get(currentAppContextAtom)?.appType || undefined
    const isChat = get(variantFlagsAtomFamily({revisionId}))?.isChat
    const metadata = get(metadataAtom)

    const transformed = transformToRequestBody({
        variant: variant as any,
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

// Internal cache for prompt variables - exported for unified discard
export const localPromptVariablesByRevisionAtomFamily = atomFamily((revisionId: string) =>
    atom<string[] | undefined>(undefined),
)

const derivedStablePromptVariablesAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        try {
            const variant = resolveRevisionSource(get, revisionId)
            const spec = get(appSchemaAtom)
            const routePath = get(appUriInfoAtom)?.routePath
            if (!variant || !spec) return [] as string[]
            const prompts = derivePromptsFromSpec(variant as any, spec as any, routePath)
            const vars = collectVariablesFromPrompts(prompts as any[])

            return vars
        } catch (error) {
            if (process.env.NODE_ENV !== "production") {
                console.warn("derivedStablePromptVariables error", {revisionId, error})
            }
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

/**
 * @deprecated Legacy local cache - kept for backwards compatibility during migration.
 * New code should use molecule directly via moleculeBackedPromptsAtomFamily.
 */
export const localPromptsByRevisionAtomFamily = atomFamily((revisionId: string) =>
    atom<EnhancedObjectConfig<AgentaConfigPrompt>[] | null>(null),
)

// Debug logging for development
const DEBUG_PROMPTS = process.env.NODE_ENV === "development"
const logPrompts = (...args: unknown[]) => {
    if (DEBUG_PROMPTS) {
        console.info("[newPlayground/prompts]", ...args)
    }
}

/**
 * Prompts atom family - single source of truth via ossAppRevisionMolecule.
 *
 * - Read: molecule.data.enhancedPrompts (includes draft changes)
 * - Write: molecule.reducers.mutateEnhancedPrompts / setEnhancedPrompts
 *
 * This replaces the legacy pattern of local caches + fallback derivation.
 */
export const promptsAtomFamily = atomFamily((revisionId: string) =>
    atom<EnhancedObjectConfig<AgentaConfigPrompt>[], any, void>(
        (get) => {
            if (!revisionId) return []

            // Single source: molecule data (merged server + draft)
            const moleculeData = get(ossAppRevisionMolecule.atoms.data(revisionId))
            if (moleculeData?.enhancedPrompts && Array.isArray(moleculeData.enhancedPrompts)) {
                logPrompts("promptsAtomFamily: returning molecule enhancedPrompts", {
                    revisionId,
                    count: moleculeData.enhancedPrompts.length,
                })
                return moleculeData.enhancedPrompts as EnhancedObjectConfig<AgentaConfigPrompt>[]
            }

            // Fallback to derived prompts if molecule not yet populated
            const derived = get(derivedPromptsByRevisionAtomFamily(revisionId))
            logPrompts("promptsAtomFamily: falling back to derived", {
                revisionId,
                hasMoleculeData: !!moleculeData,
                moleculeHasParameters: !!moleculeData?.parameters,
                moleculeParametersKeys: moleculeData?.parameters
                    ? Object.keys(moleculeData.parameters)
                    : [],
                derivedCount: derived.length,
            })
            return derived
        },
        (_get, set, update) => {
            if (update === RESET) {
                // Discard draft via molecule
                set(ossAppRevisionMolecule.actions.discardDraft, revisionId)
                return
            }

            // Route writes through molecule reducers
            if (typeof update === "function") {
                set(ossAppRevisionMolecule.reducers.mutateEnhancedPrompts, revisionId, update)
            } else {
                set(ossAppRevisionMolecule.reducers.setEnhancedPrompts, revisionId, update)
            }
        },
    ),
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
 * Stable prompt variables derived from molecule's inputPorts.
 *
 * Uses the molecule's inputPorts atom which extracts template variables
 * from the revision's parameters (ag_config). This is the preferred way
 * to get variables as it uses the molecule as single source of truth.
 *
 * @see ossAppRevisionMolecule.atoms.inputPorts
 */
export const stablePromptVariablesAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        if (!revisionId) return [] as string[]

        // Use molecule's inputPorts - single source of truth for template variables
        const inputPorts = get(ossAppRevisionMolecule.atoms.inputPorts(revisionId))
        if (inputPorts && inputPorts.length > 0) {
            return inputPorts.map((port) => port.key)
        }

        // Fallback to legacy derivation if molecule not populated
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
