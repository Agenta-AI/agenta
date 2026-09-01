/**
 * Agent version history: the rows the drawer lists, and the revert that restores one.
 *
 * Revert is not a new kind of write — it is a normal commit whose content happens to be old.
 * History is therefore never rewritten: the selected version's configuration is staged onto the
 * current revision's draft and committed, minting a new head above everything that came before.
 *
 * It commits through {@link flushAgentAutoCommitAtom} rather than calling the commit atom
 * directly. Staging a draft arms the auto-commit debounce; a second, independent commit would
 * race it and could mint two versions from one click. The flush owns that timer and its
 * in-flight guard, so going through it means exactly one new version.
 */
import {
    discardWorkflowDraftAtom,
    updateWorkflowDraftAtom,
    workflowMolecule,
    type Workflow,
} from "@agenta/entities/workflow"
import {atom, getDefaultStore} from "jotai"

import {flushAgentAutoCommitAtom} from "./agentAutoCommit"

/** Prefix of a revert's commit message — also how a row is recognised as one. */
export const REVERT_MESSAGE_PREFIX = "Revert to v"

export interface AgentVersionRow {
    id: string
    version: number
    message: string | null
    createdAt: string | null
    /** The revision the header is on — the side every diff compares against. */
    isCurrent: boolean
    /** Committed by a revert. Derived from the message; no field records it. */
    isReverted: boolean
}

/**
 * Rows for the version list, newest first.
 *
 * Drops the `version: 0` seed every workflow carries: it holds no configuration, so it can be
 * neither compared nor restored. The revision pickers filter it the same way.
 */
export const buildVersionRows = (
    revisions: Workflow[],
    currentRevisionId: string | null,
): AgentVersionRow[] =>
    revisions
        .filter((revision) => (revision.version as number | null | undefined) !== 0)
        // Sorted here rather than trusted from the caller: not every revisions atom is
        // recency-ordered, and the list's whole shape assumes newest first.
        .slice()
        .sort((a, b) => {
            const at = Date.parse(a.created_at ?? "")
            const bt = Date.parse(b.created_at ?? "")
            const byTime = (Number.isNaN(bt) ? 0 : bt) - (Number.isNaN(at) ? 0 : at)
            if (byTime !== 0) return byTime
            return (((b.version as number) ?? 0) - ((a.version as number) ?? 0)) as number
        })
        .map((revision) => {
            const message = revision.message?.trim() || null
            return {
                id: revision.id,
                version: (revision.version as number | null | undefined) ?? 0,
                message,
                createdAt: revision.created_at ?? null,
                isCurrent: revision.id === currentRevisionId,
                isReverted: !!message?.startsWith(REVERT_MESSAGE_PREFIX),
            }
        })

/** `Revert to v3 — "Switch to Opus"`, or just `Revert to v3` when that version had no message. */
export const buildRevertMessage = (row: Pick<AgentVersionRow, "version" | "message">): string =>
    row.message
        ? `${REVERT_MESSAGE_PREFIX}${row.version} — "${row.message}"`
        : `${REVERT_MESSAGE_PREFIX}${row.version}`

export interface RevertAgentRevisionParams {
    /** The revision under edit — the one the new version is committed from. */
    revisionId: string
    /** The historical revision whose configuration is being restored. */
    targetRevisionId: string
}

/**
 * Stage a historical revision's configuration onto the current one and commit it.
 *
 * Reads the target through `serverConfiguration`, NOT `configuration`: the latter overlays that
 * revision's local draft, so an older revision someone once edited would restore content that
 * was never committed. Schemas ride along — the commit sends `data.schemas`, so leaving them
 * behind would restore a configuration the old version never had.
 *
 * All-or-nothing: if the commit does not land, the staged draft is rolled back, so "no version
 * was created" also means the agent on screen is the one the user started with. The rollback is
 * skipped when the revision was ALREADY dirty — discarding then would throw away edits this
 * revert never owned, and a stranded draft is recoverable where a discarded one is not.
 *
 * Resolves to whether a new version landed.
 */
export const revertAgentRevisionAtom = atom(
    null,
    async (get, set, {revisionId, targetRevisionId}: RevertAgentRevisionParams) => {
        if (!revisionId || !targetRevisionId || revisionId === targetRevisionId) return false

        const parameters = get(workflowMolecule.selectors.serverConfiguration(targetRevisionId))
        if (!parameters) return false
        const schemas = get(workflowMolecule.selectors.serverData(targetRevisionId))?.data?.schemas

        const wasDirty = get(workflowMolecule.selectors.isDirty(revisionId))
        set(updateWorkflowDraftAtom, revisionId, {
            data: {parameters, ...(schemas ? {schemas} : {})},
        } as Partial<Workflow>)

        // Nothing staged means the target already matches the current configuration.
        if (!get(workflowMolecule.selectors.isDirty(revisionId))) return false

        const target = get(workflowMolecule.selectors.data(targetRevisionId)) as Workflow | null
        const commitMessage = buildRevertMessage({
            version: (target?.version as number | null | undefined) ?? 0,
            message: target?.message?.trim() || null,
        })

        const landed = await set(flushAgentAutoCommitAtom, {revisionId, commitMessage})
        if (!landed && !wasDirty) set(discardWorkflowDraftAtom, revisionId)
        return landed
    },
)

/** Imperative form, for hosts outside a Jotai render tree. */
export const revertAgentRevision = (params: RevertAgentRevisionParams) =>
    getDefaultStore().set(revertAgentRevisionAtom, params)
