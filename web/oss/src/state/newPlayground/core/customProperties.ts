import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import type {Enhanced} from "@/oss/lib/shared/variant/genericTransformer/types"
import {deriveCustomPropertiesFromSpec} from "@/oss/lib/shared/variant/transformer/transformer"
import type {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {
    appSchemaAtom,
    appUriInfoAtom,
    getEnhancedRevisionById,
    getSpecLazy,
} from "@/oss/state/variant/atoms/fetcher"

/**
 * Writable custom properties selector
 * - Read: derives custom properties from OpenAPI spec + saved parameters (pure)
 * - Write: forwards updates via `onUpdateParameters` callback or keeps local Playground cache
 */
export interface CustomPropsAtomParams {
    variant: EnhancedVariant
    routePath?: string
    // revision this write should target; required for local cache updates
    revisionId?: string
    // Called on writes; receives a delta or next parameters snapshot as provided by caller
    onUpdateParameters?: (update: any) => void
}

// Internal local cache keyed by revisionId (Playground-only live edits)
const localCustomPropsByRevisionAtomFamily = atomFamily((revisionId: string) =>
    atom<Record<string, Enhanced<any>> | null>(null),
)

export const customPropertiesAtomFamily = atomFamily((params: CustomPropsAtomParams) =>
    atom<Record<string, Enhanced<any>>, any>(
        (get) => {
            // If a revision is provided and local props exist, prefer them for live edits
            if (params.revisionId) {
                const local = get(localCustomPropsByRevisionAtomFamily(params.revisionId))
                if (local && Object.keys(local).length > 0) {
                    return local
                }
            }

            // Otherwise derive from spec + saved config (pure)
            const spec = getSpecLazy()
            if (!spec || !params.variant) return {}
            return deriveCustomPropertiesFromSpec(params.variant, spec, params.routePath)
        },
        (get, set, update) => {
            const {revisionId} = params

            // Prefer local revision cache update to keep Playground behavior
            if (revisionId) {
                const current = get(localCustomPropsByRevisionAtomFamily(revisionId))
                let next: any
                if (typeof update === "function") {
                    // Support both patterns safely without Immer:
                    //  - recipe style: fn(draft) mutates draft and returns undefined
                    //  - pure style:  fn(prev) returns next object
                    const fn: any = update
                    if (fn.length >= 1) {
                        const base = current ? JSON.parse(JSON.stringify(current)) : {}
                        const result = fn(base)
                        next = result === undefined ? base : result
                    } else {
                        const res = fn(current)
                        next = res === undefined ? current : res
                    }
                } else {
                    next = update
                }

                set(localCustomPropsByRevisionAtomFamily(revisionId), next)
                return
            }

            // Fallback: forward to external handler if provided
            if (typeof params.onUpdateParameters === "function") {
                params.onUpdateParameters(update)
            }
        },
    ),
)

/**
 * Stable wrapper: derive custom properties by revisionId only (avoids unstable object params)
 */
export const customPropertiesByRevisionAtomFamily = atomFamily((revisionId: string) =>
    atom<Record<string, Enhanced<any>>>((get) => {
        // Prefer local cache when present
        const local = get(localCustomPropsByRevisionAtomFamily(revisionId))
        if (local && Object.keys(local).length > 0) return local

        // Derive from spec + saved config (reactive)
        const spec = get(appSchemaAtom)
        // Resolve variant lazily to avoid passing it through params
        const variant = getEnhancedRevisionById(get as any, revisionId)
        const routePath = get(appUriInfoAtom)?.routePath
        if (spec && variant) {
            return deriveCustomPropertiesFromSpec(variant, spec, routePath)
        }
        return {}
    }),
)

/**
 * Clears the local custom properties cache for a given revisionId.
 * Use this when discarding draft changes so custom workflow properties revert to saved state.
 */
export const clearLocalCustomPropsForRevisionAtomFamily = atomFamily((revisionId: string) =>
    atom(null, (_get, set) => {
        set(localCustomPropsByRevisionAtomFamily(revisionId), null)
    }),
)
