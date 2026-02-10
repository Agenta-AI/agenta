import {
    legacyAppRevisionMolecule,
    revisionCustomPropertyKeysAtomFamily,
    revisionEnhancedCustomPropertiesAtomFamily,
} from "@agenta/entities/legacyAppRevision"
import {atom} from "jotai"
import {RESET, atomFamily} from "jotai/utils"

import {
    playgroundAppSchemaAtom,
    playgroundAppRoutePathAtom,
} from "@/oss/components/Playground/state/atoms/playgroundAppAtoms"
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
                // Fallback to entity-level derived custom properties (per-revision schema query)
                return get(revisionEnhancedCustomPropertiesAtomFamily(params.revisionId)) as Record<
                    string,
                    Enhanced<any>
                >
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
