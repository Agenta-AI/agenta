/**
 * The golden replay set: real sessions pulled read-only from the rel112 deployment.
 *
 *   `<name>.json`              — `agenta_ee_tracing.records`, ordered exactly as the API serves
 *                                them (api/oss/src/dbs/postgres/sessions/records/dao.py:119-123)
 *                                and mapped to the consumer shape of `sessionRecordSchema`
 *                                (web/packages/agenta-entities/src/session/core/schema.ts:39-49).
 *   `<name>.interactions.json` — `agenta_ee_core.session_interactions`, in the wire shape
 *                                `sessionInteractionSchema` validates (schema.ts:52-70).
 *   `<name>.liveChunks.json`   — the LIVE builder's output over the same records; see
 *                                `transcriptLiveReplayParity.test.ts`.
 *
 * Long strings are elided (`… <N chars elided>`); structure is never touched. Regenerate the
 * first two with `generate/pull_session_fixtures.py`, the third with `generate/build_live_chunks.py`.
 *
 * Between them these four sessions cover an approved commit, a discover/search call with a
 * result, a form answered and a form abandoned, a connect completed and a connect declined, a
 * schedule approval both resolved and still pending, and both the legacy and current interaction
 * row contracts.
 */
import type {
    SessionInteraction,
    SessionInteractionRowState,
    SessionInteractionRowStates,
    SessionRecord,
} from "@agenta/entities/session"

import abandonedFormRecords from "./abandonedFormSession.json"
import arabicPoetryInteractions from "./arabicPoetrySession.interactions.json"
import arabicPoetryRecords from "./arabicPoetrySession.json"
import connectAndFormsInteractions from "./connectAndFormsSession.interactions.json"
import connectAndFormsRecords from "./connectAndFormsSession.json"
import testRunApprovalsInteractions from "./testRunApprovalsSession.interactions.json"
import testRunApprovalsRecords from "./testRunApprovalsSession.json"

/**
 * Mirrors `interactionStatesFromRows`
 * (web/packages/agenta-entities/src/session/state/interactionStatus.ts:39-53), which is module
 * private. The fixtures hold the raw API rows so they stay honest captures; this is the same join.
 */
export const rowStatesFromInteractions = (
    rows: SessionInteraction[],
): SessionInteractionRowStates => {
    const states = new Map<string, SessionInteractionRowState>()
    for (const row of rows) {
        if (typeof row.token !== "string" || !row.token) continue
        const toolCallId = row.data?.request?.tool_call_id
        states.set(row.token, {
            token: row.token,
            status: row.status as SessionInteractionRowState["status"],
            kind: row.kind as SessionInteractionRowState["kind"],
            ...(row.data?.resolution ? {resolution: row.data.resolution} : {}),
            ...(typeof toolCallId === "string" && toolCallId ? {toolCallId} : {}),
        })
    }
    return states
}

export interface GoldenSession {
    name: string
    records: SessionRecord[]
    /** The session's interaction rows, in the API wire shape. */
    interactions: SessionInteraction[]
    /** Those rows joined for replay — omitted for the record-only golden. */
    rows?: SessionInteractionRowStates
}

const golden = (name: string, records: unknown, interactions: unknown[] = []): GoldenSession => ({
    name,
    records: records as SessionRecord[],
    interactions: interactions as SessionInteraction[],
    ...(interactions.length > 0
        ? {rows: rowStatesFromInteractions(interactions as SessionInteraction[])}
        : {}),
})

export const GOLDEN_SESSIONS: GoldenSession[] = [
    // The record-only golden: a form left unanswered, with no interaction rows joined.
    golden("abandonedFormSession", abandonedFormRecords),
    // Commits (approved), discover_tools with a result, a schedule approval, an answered form,
    // and a completed connect. MCP-routed harness.
    golden("arabicPoetrySession", arabicPoetryRecords, arabicPoetryInteractions),
    // Two commit approvals, two test_run approvals, an answered form, and a schedule approval
    // still pending. MCP-routed harness.
    golden("testRunApprovalsSession", testRunApprovalsRecords, testRunApprovalsInteractions),
    // Forms answered and abandoned, a connect completed and one declined, and a mix of legacy
    // rows (no `data.request.tool_call_id`) with new-contract rows that carry it.
    golden("connectAndFormsSession", connectAndFormsRecords, connectAndFormsInteractions),
]

export const goldenSession = (name: string): GoldenSession => {
    const found = GOLDEN_SESSIONS.find((g) => g.name === name)
    if (!found) throw new Error(`unknown golden session ${name}`)
    return found
}
