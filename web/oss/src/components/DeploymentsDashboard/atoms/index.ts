import {type Key} from "react"

import {atom} from "jotai"

import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import {EnhancedObjectConfig} from "@/oss/lib/shared/variant/genericTransformer/types"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {AgentaConfigPrompt} from "@/oss/lib/shared/variant/transformer/types"
import {DeploymentRevision, DeploymentRevisions} from "@/oss/lib/Types"

import {revisionListAtom} from "../../Playground/state/atoms"

export type DeploymentRevisionWithVariant = DeploymentRevision & {
    variant: EnhancedVariant<EnhancedObjectConfig<AgentaConfigPrompt>> | undefined
    environment_revision: number
}

// ============================================================================
// BASE STATE ATOMS
// ============================================================================

/**
 * Search term for filtering deployment revisions
 */
export const deploymentSearchAtom = atom("")

/**
 * Selected row keys in the deployment table
 */
export const selectedDeploymentRowKeysAtom = atom<Key[]>([])

/**
 * Deployment note for publish operations
 */
export const deploymentNoteAtom = atom("")

/**
 * Selected revision row for details and operations
 */
export const selectedRevisionRowAtom = atom<DeploymentRevisionWithVariant | undefined>(undefined)

/**
 * Selected variant revision ID for revert operations
 */
export const selectedVariantRevisionIdToRevertAtom = atom("")

/**
 * Environment revisions data (synced from props)
 */
export const envRevisionsAtom = atom<DeploymentRevisions | undefined>(undefined)

// ============================================================================
// UI STATE ATOMS
// ============================================================================

/**
 * Modal states for deployment dashboard
 */
export const deploymentModalsAtom = atom({
    isDeployVariantModalOpen: false,
    isSelectDeployVariantModalOpen: false,
    isRevertModalOpen: false,
    isUseApiDrawerOpen: false,
    isRevisionsDetailsDrawerOpen: false,
})

// ============================================================================
// SELECTOR ATOMS (DERIVED STATE)
// ============================================================================

/**
 * Processed deployment revisions with variants and formatting
 */
export const processedDeploymentRevisionsAtom = atom<DeploymentRevisionWithVariant[]>((get) => {
    const variants = get(revisionListAtom) || []
    const envRevisions = get(envRevisionsAtom)

    if (!envRevisions?.revisions) {
        return []
    }

    return envRevisions.revisions
        .filter((rev) => rev.revision !== null && rev.revision !== undefined && rev.revision >= 0)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .map((rev, index, arr) => ({
            ...rev,
            created_at: formatDay({date: rev.created_at}),
            variant: variants.find((variant) => variant.id === rev.deployed_app_variant_revision),
            environment_revision: arr.length - index,
        }))
})

/**
 * Filtered deployment revisions based on search term
 */
export const filteredDeploymentRevisionsAtom = atom<DeploymentRevisionWithVariant[]>((get) => {
    const revisions = get(processedDeploymentRevisionsAtom)
    const searchTerm = get(deploymentSearchAtom)

    if (!searchTerm) {
        return revisions
    }

    return revisions.filter(
        (item) =>
            `v${item.environment_revision}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
            item.commit_message?.toLowerCase().includes(searchTerm.toLowerCase()),
    )
})

/**
 * Selected variant for deployment (derived from selected row keys)
 */
export const selectedVariantToDeployAtom = atom((get) => {
    const variants = get(revisionListAtom) || []
    const selectedKeys = get(selectedDeploymentRowKeysAtom)
    return variants.find((variant) => variant.id === selectedKeys[0])
})

/**
 * Selected variant for revert (derived from revert selection)
 */
export const selectedVariantToRevertAtom = atom((get) => {
    const variants = get(revisionListAtom) || []
    const selectedVariantRevisionId = get(selectedVariantRevisionIdToRevertAtom)
    return variants.find((variant) => variant.id === selectedVariantRevisionId)
})

// ============================================================================
// WRITE ATOMS (ACTIONS)
// ============================================================================

/**
 * Action to update a specific modal state
 */
export const updateModalStateAtom = atom(
    null,
    (get, set, update: {modal: keyof typeof deploymentModalsAtom.init; isOpen: boolean}) => {
        const currentState = get(deploymentModalsAtom)
        set(deploymentModalsAtom, {
            ...currentState,
            [update.modal]: update.isOpen,
        })
    },
)

/**
 * Action to reset all UI state (useful after successful operations)
 */
export const resetDeploymentUIStateAtom = atom(null, (get, set) => {
    set(deploymentNoteAtom, "")
    set(selectedDeploymentRowKeysAtom, [])
    set(selectedVariantRevisionIdToRevertAtom, "")
    set(deploymentModalsAtom, {
        isDeployVariantModalOpen: false,
        isSelectDeployVariantModalOpen: false,
        isRevertModalOpen: false,
        isUseApiDrawerOpen: false,
        isRevisionsDetailsDrawerOpen: false,
    })
})
