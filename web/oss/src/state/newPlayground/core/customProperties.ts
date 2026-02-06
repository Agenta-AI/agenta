import {
    legacyAppRevisionMolecule,
    revisionCustomPropertyKeysAtomFamily,
} from "@agenta/entities/legacyAppRevision"
import {atom} from "jotai"
import {RESET, atomFamily} from "jotai/utils"

import {
    playgroundAppSchemaAtom,
    playgroundAppRoutePathAtom,
} from "@/oss/components/Playground/state/atoms/pipelineBBridge"
import type {Enhanced} from "@/oss/lib/shared/variant/genericTransformer/types"
import {deriveCustomPropertiesFromSpec} from "@/oss/lib/shared/variant/transformer/transformer"
import type {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"

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

/**
 * Resolves revision data from the molecule (single source of truth).
 * No legacy fallbacks - molecule is the authoritative source.
 */
const resolveRevisionSource = (get: any, revisionId: string): EnhancedVariant | undefined => {
    // Prefer merged data (includes draft changes)
    const moleculeData = get(legacyAppRevisionMolecule.atoms.data(revisionId)) as any
    if (moleculeData) return moleculeData as EnhancedVariant

    // Fallback to server data if no merged data yet
    const serverData = get(legacyAppRevisionMolecule.atoms.serverData(revisionId)) as any
    if (serverData) return serverData as EnhancedVariant

    return undefined
}

/**
 * @deprecated Legacy local cache - kept for backwards compatibility during migration.
 * New code should use molecule directly via moleculeBackedCustomPropertiesAtomFamily.
 */
export const localCustomPropsByRevisionAtomFamily = atomFamily((revisionId: string) =>
    atom<Record<string, Enhanced<any>> | undefined>(undefined),
)

// Debug logging for development
const DEBUG_CUSTOM_PROPS = process.env.NODE_ENV === "development"
const logCustomProps = (...args: unknown[]) => {
    if (DEBUG_CUSTOM_PROPS) {
        console.info("[newPlayground/customProperties]", ...args)
    }
}

// Derived custom properties from spec + saved variant parameters for a revision
export const derivedCustomPropsByRevisionAtomFamily = atomFamily((revisionId: string) =>
    atom<Record<string, Enhanced<any>>>((get) => {
        const variant = resolveRevisionSource(get, revisionId)
        const spec = get(playgroundAppSchemaAtom)
        if (!variant || !spec) {
            logCustomProps("derivedCustomProps: missing variant or spec", {
                revisionId,
                hasVariant: !!variant,
                hasSpec: !!spec,
            })
            return {}
        }
        const routePath = get(playgroundAppRoutePathAtom)
        const customProps = deriveCustomPropertiesFromSpec(variant as any, spec as any, routePath)
        logCustomProps("derivedCustomProps: derived", {
            revisionId,
            customPropKeys: Object.keys(customProps),
            routePath,
            variantParametersKeys: variant.parameters ? Object.keys(variant.parameters) : [],
        })
        return customProps
    }),
)

/**
 * Custom properties atom family - single source of truth via legacyAppRevisionMolecule.
 *
 * - Read: molecule.data.enhancedCustomProperties (includes draft changes)
 * - Write: molecule.reducers.mutateEnhancedCustomProperties / setEnhancedCustomProperties
 *
 * This replaces the legacy pattern of local caches + fallback derivation.
 */
export const customPropertiesAtomFamily = atomFamily((params: CustomPropsAtomParams) =>
    atom(
        (get) => {
            // If a revision is provided, use molecule as single source
            if (params.revisionId) {
                const moleculeData = get(legacyAppRevisionMolecule.atoms.data(params.revisionId))
                if (moleculeData?.enhancedCustomProperties) {
                    return moleculeData.enhancedCustomProperties as Record<string, Enhanced<any>>
                }
                // Fallback to derived if molecule not yet populated
                return get(derivedCustomPropsByRevisionAtomFamily(params.revisionId))
            }

            // Otherwise derive from spec + saved config (pure)
            const spec = get(playgroundAppSchemaAtom)
            const routePath = params.routePath ?? get(playgroundAppRoutePathAtom)
            if (!spec || !params.variant) return {}
            return deriveCustomPropertiesFromSpec(params.variant, spec, routePath)
        },
        (
            _get,
            set,
            update:
                | typeof RESET
                | Record<string, Enhanced<any>>
                | ((draft: Record<string, unknown>) => void),
        ) => {
            const {revisionId} = params

            if (revisionId) {
                if (update === RESET) {
                    // Discard draft via molecule
                    set(legacyAppRevisionMolecule.actions.discardDraft, revisionId)
                    return
                }

                // Route writes through molecule reducers
                if (typeof update === "function") {
                    set(
                        legacyAppRevisionMolecule.reducers.mutateEnhancedCustomProperties,
                        revisionId,
                        update as (draft: Record<string, unknown>) => void,
                    )
                } else {
                    set(
                        legacyAppRevisionMolecule.reducers.setEnhancedCustomProperties,
                        revisionId,
                        update as Record<string, unknown>,
                    )
                }
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
        const routePath = get(playgroundAppRoutePathAtom)
        return get(
            customPropertiesAtomFamily({
                revisionId,
                routePath,
            }),
        )
    }),
)

/**
 * Get custom property IDs for a revision.
 * Directly re-exports the entity-level atom family for proper reactivity.
 */
export const customPropertyIdsByRevisionAtomFamily = revisionCustomPropertyKeysAtomFamily
