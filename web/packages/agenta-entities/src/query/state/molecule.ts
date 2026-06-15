/**
 * Query molecule — committed-vs-draft state for a single query's head revision.
 *
 * Queries are git-style entities (Query → QueryVariant → QueryRevision), so this
 * mirrors the testset/workflow molecule pattern: server data is the head
 * revision, edits accumulate in a draft, and commit creates a new head revision
 * via `editSimpleQuery`.
 *
 * `isDirty` is a SEMANTIC, order-insensitive diff of the committed fields (name +
 * filtering + windowing) — not a `draft !== null` check — so changing a value and
 * reverting it reads as clean, matching how the workflow entity tracks dirtiness.
 */

import deepEqual from "fast-deep-equal"
import {atom} from "jotai"

import {createMolecule, type AtomFamily, type QueryState} from "../../shared"
import {editSimpleQuery} from "../api"
import type {QueryRevision, SimpleQueryEdit} from "../core"

import {invalidateQueryCache, queryHeadDraftAtomFamily, queryHeadQueryAtomFamily} from "./store"

/** The fields a commit persists — what dirtiness is measured against. */
const dirtySignature = (rev: Partial<QueryRevision> | null | undefined) => ({
    name: rev?.name ?? null,
    filtering: rev?.data?.filtering ?? null,
    windowing: rev?.data?.windowing ?? null,
})

/**
 * Semantic, order-insensitive dirty check for a query head revision: true only
 * when the committed fields (name + filtering + windowing) of the draft-merged
 * view actually differ from the server. A change-then-revert reads as clean.
 */
export function isQueryHeadDirty(
    serverData: QueryRevision | null,
    draft: Partial<QueryRevision> | null,
): boolean {
    if (!draft) return false
    const merged = {...serverData, ...draft} as Partial<QueryRevision>
    return !deepEqual(dirtySignature(merged), dirtySignature(serverData))
}

export const queryMolecule = createMolecule<QueryRevision, Partial<QueryRevision>>({
    name: "query",
    // jotai-family's atomFamily is structurally compatible but needs the cast.
    queryAtomFamily: queryHeadQueryAtomFamily as unknown as AtomFamily<QueryState<QueryRevision>>,
    draftAtomFamily: queryHeadDraftAtomFamily,
    isDirty: isQueryHeadDirty,
})

export interface SaveQueryHeadParams {
    projectId: string
    queryId: string
}

/**
 * Commit the draft as a new head revision (`editSimpleQuery`), clear the draft,
 * and refresh caches. No-op when there are no unsaved changes. The draft carries
 * the full {name, data}, so it wins over (possibly stale) server data on merge.
 */
export const saveQueryHeadAtom = atom(
    null,
    async (get, set, {projectId, queryId}: SaveQueryHeadParams): Promise<void> => {
        const draft = get(queryHeadDraftAtomFamily(queryId))
        if (!draft) return
        const serverData = get(queryMolecule.atoms.serverData(queryId))
        const merged = {...serverData, ...draft} as Partial<QueryRevision>
        const data = {
            filtering: merged.data?.filtering ?? null,
            windowing: merged.data?.windowing ?? null,
        } as NonNullable<SimpleQueryEdit["data"]>
        await editSimpleQuery({
            projectId,
            queryId,
            query: {
                ...(merged.name != null ? {name: merged.name} : {}),
                data,
            },
        })
        set(queryHeadDraftAtomFamily(queryId), null)
        invalidateQueryCache()
    },
)
