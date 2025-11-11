import {atomStore, allRevisionsAtom, specAtom} from "@/oss/lib/hooks/useStatelessVariants/state"
import {LightweightRevision} from "@/oss/lib/hooks/useStatelessVariants/state/types"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {OpenAPISpec} from "@/oss/lib/shared/variant/types/openapi"
import {User} from "@/oss/lib/Types"

import {PlaygroundStateData} from "../types"

/**
 * Updates state with processed revisions data, maintaining atom-based optimization.
 * This is a shared utility for both initial load and schema refresh scenarios.
 *
 * @param state The current state object to update
 * @param processedRevisions All transformed revisions
 * @param spec The OpenAPI spec
 * @param uri The app URI information
 * @returns The updated state object
 */
export const updateStateWithProcessedRevisions = (
    state: PlaygroundStateData,
    processedRevisions: EnhancedVariant[],
    spec: OpenAPISpec,
    uri: {routePath: string; runtimePrefix: string},
): PlaygroundStateData => {
    // Update URI and spec information in state
    state.uri = uri
    state.spec = spec

    // Store all transformed revisions in atom for efficient retrieval
    atomStore.set(allRevisionsAtom, () => processedRevisions)

    // Create lightweight list of all available revisions for UI selection
    state.availableRevisions = processedRevisions.map((revision) => {
        // Use type assertion for the extended properties that aren't in the base type
        const enhancedRevision = revision as EnhancedVariant & {
            variantId: string
            isLatestRevision: boolean
            isLatestVariantRevision: boolean
            userProfile?: User
            deployedIn?: string[]
            commitMessage: string | null
            createdAtTimestamp: number
        }

        return {
            id: revision.id,
            name: revision.name || revision.variantName,
            revisionNumber: revision.revision,
            variantId: enhancedRevision.variantId,
            variantName: revision.variantName,
            createdAt: revision.createdAt,
            isLatestRevision: enhancedRevision.isLatestRevision,
            isLatestVariantRevision: enhancedRevision.isLatestVariantRevision,
            userProfile: enhancedRevision.userProfile,
            deployedIn: enhancedRevision.deployedIn || [],
            commitMessage: enhancedRevision.commitMessage,
            createdAtTimestamp: enhancedRevision.createdAtTimestamp,
        } as LightweightRevision
    })

    // Sort revisions by createdAtTimestamp from newest to oldest
    state.availableRevisions.sort((a, b) => b.createdAtTimestamp - a.createdAtTimestamp)

    // Store spec in atom
    atomStore.set(specAtom, () => spec)

    return state
}
