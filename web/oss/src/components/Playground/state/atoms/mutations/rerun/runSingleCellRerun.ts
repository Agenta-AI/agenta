import {atom} from "jotai"

import {logicalTurnIndexAtom as normLogicalTurnIndexAtom} from "@/oss/state/generation/entities"

import {triggerWebWorkerTestAtom} from "../../index"
import {expectedRoundByLogicalAtom} from "../../orchestration/expected"

import {optionsAtom} from "./optionsAtom"

/**
 * Rerun a single cell (specific revision) for a given logical turn.
 * - Does NOT prune next turns
 * - Temporarily sets options[logicalId].noAppend to prevent empty-turn append during rerun
 */
export const runSingleCellRerunMutationAtom = atom(
    null,
    (
        get,
        set,
        payload: {
            logicalId: string
            revisionId: string
        },
    ) => {
        const {logicalId, revisionId} = payload || ({} as any)
        if (!logicalId || !revisionId) return

        // Prevent appending empty turns during this rerun
        set(optionsAtom(logicalId), {noAppend: true})

        // Locate the session turn id for this logicalId + revisionId
        const index = (get(normLogicalTurnIndexAtom) || {}) as Record<
            string,
            Record<string, string>
        >
        const map = (index || {})[logicalId] || {}
        const sid = map[revisionId]
        if (!sid) return

        // Record expected round for orchestrator: only this single revision for the logicalId
        const roundId = `${logicalId}:${revisionId}:${Date.now()}`
        set(expectedRoundByLogicalAtom, (prev) => ({
            ...prev,
            [logicalId]: {expectedRevIds: [revisionId], roundId},
        }))

        // Trigger worker-based execution for this single turn + revision
        set(triggerWebWorkerTestAtom, {rowId: sid, variantId: revisionId} as any)
    },
)
