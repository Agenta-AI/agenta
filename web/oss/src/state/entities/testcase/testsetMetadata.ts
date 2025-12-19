import {atom} from "jotai"
import {atomFamily} from "jotai/utils"
import {queryClientAtom} from "jotai-tanstack-query"

import {projectIdAtom} from "@/oss/state/project/selectors/project"

import {currentRevisionIdAtom, revisionQueryAtom, testsetNameQueryAtom} from "./queries"

// Note: queryClientAtom and projectIdAtom are still used in testsetMetadataAtom below

// ============================================================================
// TESTSET METADATA (REVISION-SCOPED)
// Server data is read directly from React Query cache - no sync needed
// Local edits are stored per revision using atomFamily
// ============================================================================

/**
 * Local edits per revision - atomFamily keyed by revisionId
 * Only stores local edits, not server data
 */
export const localMetadataAtomFamily = atomFamily((_revisionId: string) =>
    atom<{localName: string | null; localDescription: string | null}>({
        localName: null,
        localDescription: null,
    }),
)

/**
 * Derived atom: server testset name from query atom
 * Reads from testsetNameQueryAtom for reactive updates
 */
export const serverTestsetNameAtom = atom((get) => {
    const nameQuery = get(testsetNameQueryAtom)
    return nameQuery.data ?? ""
})

/**
 * Derived atom: server description from query atom
 * Reads from revisionQueryAtom for reactive updates
 */
export const serverDescriptionAtom = atom((get) => {
    const revisionQuery = get(revisionQueryAtom)
    return revisionQuery.data?.description ?? ""
})

/**
 * Derived atom: local edits for current revision
 */
const currentLocalMetadataAtom = atom((get) => {
    const revisionId = get(currentRevisionIdAtom)
    if (!revisionId) return {localName: null, localDescription: null}
    return get(localMetadataAtomFamily(revisionId))
})

/**
 * Current testset name - local if edited, otherwise server
 */
export const currentTestsetNameAtom = atom((get) => {
    const local = get(currentLocalMetadataAtom)
    if (local.localName !== null) return local.localName
    return get(serverTestsetNameAtom)
})

/**
 * Current description - local if edited, otherwise server
 */
export const currentDescriptionAtom = atom((get) => {
    const local = get(currentLocalMetadataAtom)
    if (local.localDescription !== null) return local.localDescription
    return get(serverDescriptionAtom)
})

/**
 * Write-only atom to set local testset name
 */
export const setLocalTestsetNameAtom = atom(null, (get, set, name: string) => {
    const revisionId = get(currentRevisionIdAtom)
    if (!revisionId) return
    const current = get(localMetadataAtomFamily(revisionId))
    set(localMetadataAtomFamily(revisionId), {...current, localName: name})
})

/**
 * Write-only atom to set local description
 */
export const setLocalDescriptionAtom = atom(null, (get, set, description: string) => {
    const revisionId = get(currentRevisionIdAtom)
    if (!revisionId) return
    const current = get(localMetadataAtomFamily(revisionId))
    set(localMetadataAtomFamily(revisionId), {...current, localDescription: description})
})

/**
 * Write-only atom to reset metadata changes (clear local edits)
 * Call this when discarding changes or after successful save
 */
export const resetMetadataAtom = atom(null, (get, set) => {
    const revisionId = get(currentRevisionIdAtom)
    if (!revisionId) return
    set(localMetadataAtomFamily(revisionId), {
        localName: null,
        localDescription: null,
    })
})

/**
 * Derived atom to check if testset name has changed
 */
export const testsetNameChangedAtom = atom((get) => {
    const local = get(currentLocalMetadataAtom)
    if (local.localName === null) return false
    return local.localName !== get(serverTestsetNameAtom)
})

/**
 * Derived atom to check if description has changed
 */
export const descriptionChangedAtom = atom((get) => {
    const local = get(currentLocalMetadataAtom)
    if (local.localDescription === null) return false
    return local.localDescription !== get(serverDescriptionAtom)
})

/**
 * Derived atom to check if there are any metadata changes
 */
export const hasMetadataChangesAtom = atom((get) => {
    return get(testsetNameChangedAtom) || get(descriptionChangedAtom)
})

// ============================================================================
// FULL METADATA OBJECT
// Combines all metadata into a single object for consumers
// ============================================================================

/**
 * Metadata object type (matches TestsetMetadata from types.ts)
 */
export interface TestsetMetadata {
    testsetId: string
    testsetName: string
    revisionVersion?: number
    description?: string
    commitMessage?: string
    author?: string
    createdAt?: string
    updatedAt?: string
}

/**
 * Derived atom: current testset ID from React Query cache
 */
export const currentTestsetIdAtom = atom((get): string | null => {
    const queryClient = get(queryClientAtom)
    const projectId = get(projectIdAtom)
    const revisionId = get(currentRevisionIdAtom)

    if (!projectId || !revisionId) return null

    const revisionQueryKey = ["testset-revision", projectId, revisionId]
    const revisionData = queryClient.getQueryData<{testset_id?: string}>(revisionQueryKey)
    return revisionData?.testset_id || null
})

/**
 * Derived atom: current revision version from React Query cache
 */
export const currentRevisionVersionAtom = atom((get): number | undefined => {
    const queryClient = get(queryClientAtom)
    const projectId = get(projectIdAtom)
    const revisionId = get(currentRevisionIdAtom)

    if (!projectId || !revisionId) return undefined

    const revisionQueryKey = ["testset-revision", projectId, revisionId]
    const revisionData = queryClient.getQueryData<{version?: number}>(revisionQueryKey)
    return revisionData?.version
})

/**
 * Derived atom: full metadata object for the current testset/revision
 * Reads from React Query cache for server data
 */
export const testsetMetadataAtom = atom((get): TestsetMetadata | null => {
    const queryClient = get(queryClientAtom)
    const projectId = get(projectIdAtom)
    const revisionId = get(currentRevisionIdAtom)

    if (!projectId || !revisionId) return null

    // Get revision data from cache
    const revisionQueryKey = ["testset-revision", projectId, revisionId]
    const revisionData = queryClient.getQueryData<{
        testset_id?: string
        version?: number
        description?: string
        message?: string
        author?: string
        created_at?: string
        updated_at?: string
    }>(revisionQueryKey)

    const testsetId = revisionData?.testset_id
    if (!testsetId) return null

    // Get testset name from cache
    const nameQueryKey = ["testset-name", projectId, testsetId]
    const fetchedName = queryClient.getQueryData<string>(nameQueryKey) ?? ""

    return {
        testsetId,
        testsetName: fetchedName,
        revisionVersion: revisionData?.version,
        description: revisionData?.description,
        commitMessage: revisionData?.message,
        author: revisionData?.author,
        createdAt: revisionData?.created_at,
        updatedAt: revisionData?.updated_at,
    }
})
