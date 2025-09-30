import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {
    getAllMetadata,
    getMetadataLazy,
    metadataSelectorFamily,
} from "@/oss/lib/hooks/useStatelessVariants/state"
import type {ConfigMetadata} from "@/oss/lib/shared/variant/genericTransformer/types"
import {getSpecLazy} from "@/oss/state/variant/atoms/fetcher"

/**
 * Metadata Management Atoms
 *
 * Centralized metadata handling for the new playground state.
 * Reuses existing metadata utilities while providing clean atom-based access.
 */

// Metadata atoms - canonical selectors for playground code
export const allMetadataAtom = atom<Record<string, ConfigMetadata>>(() => {
    try {
        return getAllMetadata()
    } catch (error) {
        console.error("❌ Error getting all metadata:", error)
        return {}
    }
})

// Per-hash reactive selector (leverages metadataSelectorFamily from the stateless store)
export const metadataByHashAtomFamily = atomFamily((hash?: string) =>
    atom((get) => {
        if (!hash) return null
        // Directly read the per-key selector to minimize re-renders
        return get(metadataSelectorFamily(hash)) ?? null
    }),
)

// Metadata validation utilities
export const validateMetadata = (metadata: Record<string, ConfigMetadata>): boolean => {
    try {
        return Object.keys(metadata).length > 0
    } catch {
        return false
    }
}

export const getMetadataForVariant = (
    variantId: string,
    allMetadata: Record<string, ConfigMetadata>,
): Record<string, ConfigMetadata> => {
    // Filter metadata relevant to this variant
    // This could be enhanced based on specific variant metadata requirements
    return allMetadata
}
