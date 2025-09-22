import {produce} from "immer"
import {atom} from "jotai"
import {RESET, atomFamily} from "jotai/utils"

import type {Enhanced} from "@/oss/lib/shared/variant/genericTransformer/types"
import {generateId} from "@/oss/lib/shared/variant/stringUtils"
import {deriveCustomPropertiesFromSpec} from "@/oss/lib/shared/variant/transformer/transformer"
import type {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {
    appSchemaAtom,
    appUriInfoAtom,
    getEnhancedRevisionById,
} from "@/oss/state/variant/atoms/fetcher"

/**
 * Writable custom properties selector
 * - Read: derives custom properties from OpenAPI spec + saved parameters (pure)
 * - Write: forwards updates via `onUpdateParameters` callback or keeps local Playground cache
 */
export interface CustomPropsAtomParams {
    variant?: EnhancedVariant
    routePath?: string
    // revision this write should target; required for local cache updates
    revisionId?: string
    // Called on writes; receives a delta or next parameters snapshot as provided by caller
    onUpdateParameters?: (update: any) => void
}

// Internal local cache keyed by revisionId (Playground-only live edits)
const localCustomPropsByRevisionAtomFamily = atomFamily((revisionId: string) =>
    atom<Record<string, Enhanced<any>> | undefined>(undefined),
)

const regenerateEnhancedIds = (value: any): any => {
    if (Array.isArray(value)) {
        return value.map((item) => regenerateEnhancedIds(item))
    }

    if (value && typeof value === "object") {
        const clone: Record<string, any> = {}
        Object.keys(value).forEach((key) => {
            clone[key] = regenerateEnhancedIds(value[key])
        })

        if ("__test" in clone) {
            clone.__test = generateId()
        }

        return clone
    }

    return value
}

// Derived custom properties from spec + saved variant parameters for a revision
export const derivedCustomPropsByRevisionAtomFamily = atomFamily((revisionId: string) =>
    atom<Record<string, Enhanced<any>>>((get) => {
        const variant = getEnhancedRevisionById(get as any, revisionId)
        const spec = get(appSchemaAtom)
        if (!variant || !spec) return {}
        const routePath = get(appUriInfoAtom)?.routePath
        return deriveCustomPropertiesFromSpec(variant as any, spec as any, routePath)
    }),
)

export const customPropertiesAtomFamily = atomFamily((params: CustomPropsAtomParams) =>
    atom<Record<string, Enhanced<any>>, any>(
        (get) => {
            // If a revision is provided and local props exist, prefer them for live edits
            if (params.revisionId) {
                const local = get(localCustomPropsByRevisionAtomFamily(params.revisionId))
                if (local !== undefined) return local
                return get(derivedCustomPropsByRevisionAtomFamily(params.revisionId))
            }

            // Otherwise derive from spec + saved config (pure)
            const spec = get(appSchemaAtom)
            const routePath = params.routePath ?? get(appUriInfoAtom)?.routePath
            if (!spec || !params.variant) return {}
            return deriveCustomPropertiesFromSpec(params.variant, spec, routePath)
        },
        (get, set, update) => {
            const {revisionId} = params

            // Prefer local revision cache update to keep Playground behavior
            if (revisionId) {
                if (update === RESET) {
                    set(localCustomPropsByRevisionAtomFamily(revisionId), undefined)
                    return
                }

                const base =
                    get(localCustomPropsByRevisionAtomFamily(revisionId)) ??
                    get(derivedCustomPropsByRevisionAtomFamily(revisionId))

                let next: any
                if (typeof update === "function") {
                    const fn: any = update
                    if (fn.length >= 1) {
                        const source = base === undefined ? {} : base
                        next = produce(source, (draft: any) => {
                            const res = fn(draft)
                            if (res !== undefined) {
                                return res
                            }
                        })
                    } else {
                        const res = fn(base)
                        next = res === undefined ? base : res
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
        const routePath = get(appUriInfoAtom)?.routePath
        return get(
            customPropertiesAtomFamily({
                revisionId,
                routePath,
            }),
        )
    }),
)

export const customPropertyIdsByRevisionAtomFamily = atomFamily((revisionId: string) =>
    atom<string[]>((get) => {
        const local = get(localCustomPropsByRevisionAtomFamily(revisionId))
        const source = local ?? get(derivedCustomPropsByRevisionAtomFamily(revisionId))
        if (!source) {
            return []
        }
        return Object.keys(source)
    }),
)

/**
 * Clears the local custom properties cache for a given revisionId.
 * Use this when discarding draft changes so custom workflow properties revert to saved state.
 */
export const clearLocalCustomPropsForRevisionAtomFamily = atomFamily((revisionId: string) =>
    atom(null, (get, set) => {
        const derived = get(derivedCustomPropsByRevisionAtomFamily(revisionId))
        set(localCustomPropsByRevisionAtomFamily(revisionId), regenerateEnhancedIds(derived))
    }),
)
