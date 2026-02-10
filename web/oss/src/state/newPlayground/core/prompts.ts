import {
    legacyAppRevisionMolecule,
    revisionEnhancedCustomPropertiesAtomFamily,
    revisionEnhancedPromptsAtomFamily,
} from "@agenta/entities/legacyAppRevision"
import {
    metadataAtom as mergedMetadataAtom,
    getAllMetadata,
} from "@agenta/entities/legacyAppRevision"
import {produce} from "immer"
import {atom} from "jotai"
import {RESET, atomFamily} from "jotai/utils"

import type {EnhancedObjectConfig} from "@/oss/lib/shared/variant/genericTransformer/types"
import {extractVariables} from "@/oss/lib/shared/variant/inputHelpers"
import {transformToRequestBody} from "@/oss/lib/shared/variant/transformer/transformToRequestBody"
import type {AgentaConfigPrompt, EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {currentAppContextAtom} from "@/oss/state/app/selectors/app"
import {moleculeBackedPromptsAtomFamily} from "@/oss/state/newPlayground/legacyEntityBridge"

import {customPropertiesByRevisionAtomFamily} from "./customProperties"
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

/**
 * Resolves revision data from the molecule (single source of truth).
 * No legacy fallbacks - molecule is the authoritative source.
 */
const resolveRevisionSource = (get: any, revisionId: string): EnhancedVariant | undefined => {
    // Prefer merged data (includes draft changes)
    const moleculeData = get(legacyAppRevisionMolecule.atoms.data(revisionId)) as any
    if (moleculeData) {
        return moleculeData as EnhancedVariant
    }

    // Fallback to server data if no merged data yet
    const serverData = get(legacyAppRevisionMolecule.atoms.serverData(revisionId)) as any
    if (serverData) {
        return serverData as EnhancedVariant
    }

    return undefined
}

// Internal cache for transformed prompts
const localTransformedPromptsByRevisionAtomFamily = atomFamily((revisionId: string) =>
    atom<any | undefined>(undefined),
)

const buildLiveTransformedPrompts = (get: any, revisionId: string) => {
    const variant = resolveRevisionSource(get, revisionId)
    const promptsForTransform = get(promptsAtomFamily(revisionId)) as any[]
    const variables = get(promptVariablesAtomFamily(revisionId))
    const customProps = get(customPropertiesByRevisionAtomFamily(revisionId))
    const appType = get(currentAppContextAtom)?.appType || undefined
    const isChat = get(variantFlagsAtomFamily({revisionId}))?.isChat
    const metadata = getAllMetadata()

    return transformToRequestBody({
        variant: variant as any,
        prompts: promptsForTransform,
        customProperties: customProps,
        allMetadata: metadata,
        isChat,
        revisionId,
        appType,
        variables,
    })
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

// Internal cache for prompt variables
const localPromptVariablesByRevisionAtomFamily = atomFamily((revisionId: string) =>
    atom<string[] | undefined>(undefined),
)

const buildLivePromptVariables = (get: any, revisionId: string): string[] => {
    const flags = get(variantFlagsAtomFamily({revisionId}))
    if (flags?.isCustom) return [] as string[]
    const prompts = get(promptsAtomFamily(revisionId))
    return collectVariablesFromPrompts(Array.isArray(prompts) ? prompts : [])
}

/**
 * Prompts atom family - single source of truth via legacyAppRevisionMolecule.
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
            const moleculeData = get(legacyAppRevisionMolecule.atoms.data(revisionId))
            if (
                moleculeData?.enhancedPrompts &&
                Array.isArray(moleculeData.enhancedPrompts) &&
                moleculeData.enhancedPrompts.length > 0
            ) {
                return moleculeData.enhancedPrompts as EnhancedObjectConfig<AgentaConfigPrompt>[]
            }

            // Fallback to entity-level derived prompts (per-revision schema query).
            // This matches moleculeBackedPromptsAtomFamily's fallback path, ensuring
            // that both the UI and transformedPromptsAtomFamily use the same data source.
            // The per-revision schema query resolves per-revision, making it the
            // authoritative fallback when molecule data is not yet populated.
            const entityPrompts = get(revisionEnhancedPromptsAtomFamily(revisionId))
            if (entityPrompts && Array.isArray(entityPrompts) && entityPrompts.length > 0) {
                return entityPrompts as EnhancedObjectConfig<AgentaConfigPrompt>[]
            }

            // Schema still loading — return empty until entity-level derivation resolves
            return []
        },
        (_get, set, update) => {
            if (update === RESET) {
                // Discard draft via molecule
                set(legacyAppRevisionMolecule.actions.discardDraft, revisionId)
                return
            }

            // Route writes through molecule reducers
            if (typeof update === "function") {
                set(legacyAppRevisionMolecule.reducers.mutateEnhancedPrompts, revisionId, update)
            } else {
                set(legacyAppRevisionMolecule.reducers.setEnhancedPrompts, revisionId, update)
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
                    const variant = resolveRevisionSource(get, revisionId)
                    const prompts = get(revisionEnhancedPromptsAtomFamily(revisionId))
                    const customProps = get(revisionEnhancedCustomPropertiesAtomFamily(revisionId))
                    const variables = get(stablePromptVariablesAtomFamily(revisionId))
                    const appType = get(currentAppContextAtom)?.appType || undefined
                    const isChat = get(variantFlagsAtomFamily({revisionId}))?.isChat
                    const metadata = get(mergedMetadataAtom)
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
 * @see legacyAppRevisionMolecule.atoms.inputPorts
 */
export const stablePromptVariablesAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        if (!revisionId) return [] as string[]

        // Use molecule's inputPorts - single source of truth for template variables
        const inputPorts = get(legacyAppRevisionMolecule.atoms.inputPorts(revisionId))
        if (inputPorts && inputPorts.length > 0) {
            return inputPorts.map((port) => port.key)
        }

        // Molecule not yet populated — return empty until entity resolves
        return [] as string[]
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
            // Use moleculeBackedPromptsAtomFamily — same source as the component's
            // promptId (from useVariantPrompts). Using a different source
            // (e.g. promptsAtomFamily) can produce __id mismatches during initial load.
            const prompts = get(moleculeBackedPromptsAtomFamily(p.revisionId))
            const list = Array.isArray(prompts) ? prompts : []
            const target =
                list.find((pr: any) => pr?.__id === p.promptId) ||
                list.find((pr: any) => pr?.__name === p.promptId)
            if (!target) return [] as string[]
            return collectVariablesFromPrompts([target])
        }),
)
