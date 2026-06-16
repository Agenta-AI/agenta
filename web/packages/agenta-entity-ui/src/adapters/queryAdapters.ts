/**
 * Query Modal Adapter
 *
 * Registers the query entity for the unified commit modal, so query edits use the
 * same EntityCommitModal as other git-style entities — version transition (vN →
 * vN+1), a filtering/windowing JSON diff, and a commit message.
 *
 * Name editing and the save-mode / new-variant flow are NOT wired here: the
 * registry drawer already owns the name field, and simple queries are
 * single-variant, so the consuming modal omits those props.
 */

import {
    archiveSimpleQuery,
    invalidateQueryCache,
    queryMolecule,
    saveQueryHeadAtom,
    type QueryRevision,
} from "@agenta/entities/query"
import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"

import {createAndRegisterEntityAdapter, type CommitContext, type CommitParams} from "../modals"

// Archive (soft-delete). Required by the adapter contract; the registry archives
// through its own confirm flow, so this is a fallback, not the primary path.
const queryDeleteAtom = atom(null, async (get, _set, ids: string[]): Promise<void> => {
    const projectId = get(projectIdAtom)
    if (!projectId) throw new Error("No project id for query archive")
    await Promise.all(ids.map((queryId) => archiveSimpleQuery({projectId, queryId})))
    invalidateQueryCache()
})

// Commit a new head revision with the modal's message (via the molecule).
const queryCommitAtom = atom(null, async (get, set, params: CommitParams): Promise<void> => {
    const projectId = get(projectIdAtom)
    if (!projectId) throw new Error("No project id for query commit")
    await set(saveQueryHeadAtom, {projectId, queryId: params.id, message: params.message})
})

// What the diff preview compares — the committed fields only.
const diffShape = (rev: QueryRevision | null) => ({
    name: rev?.name ?? null,
    filtering: rev?.data?.filtering ?? null,
    windowing: rev?.data?.windowing ?? null,
})

const queryCommitContextAtom = (id: string) =>
    atom((get): CommitContext | null => {
        const serverData = get(queryMolecule.atoms.serverData(id)) ?? null
        const merged = get(queryMolecule.atoms.data(id)) ?? null
        const currentVersion = Number(serverData?.version ?? 0) || 0
        const original = JSON.stringify(diffShape(serverData), null, 2)
        const modified = JSON.stringify(diffShape(merged), null, 2)
        return {
            versionInfo: {
                currentVersion,
                targetVersion: currentVersion + 1,
                latestVersion: currentVersion,
            },
            diffData: {original, modified, language: "json"},
            ...(original !== modified
                ? {changesSummary: {description: "Filter / sampling updated"}}
                : {}),
        }
    })

export const queryModalAdapter = createAndRegisterEntityAdapter<QueryRevision>({
    type: "query",
    getDisplayName: (q) => q?.name ?? "Untitled query",
    getDisplayLabel: (count) => (count === 1 ? "Query" : "Queries"),
    deleteAtom: queryDeleteAtom,
    commitAtom: queryCommitAtom,
    dataAtom: (id) => queryMolecule.atoms.data(id),
    commitContextAtom: queryCommitContextAtom,
})
