/**
 * Friendly body for `commit_revision` approvals: the agent's stated intent and the commit message
 * from the payload, plus the same "What's changing" sections the commit modal renders. The delta
 * is resolved against the revision's committed (server) parameters — the same base the backend
 * applies it to — so the preview shows exactly what the new version would contain.
 */
import {useMemo, useState} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {classifyRevisionDeltaChanges} from "@agenta/entities/workflow/commitDiff"
import {AgentChangesSummary} from "@agenta/entity-ui/modals"
import {useAtomValue} from "jotai"

import {type CallDescription, extractCallDescription} from "../../assets/toolDisplay"

import ApprovedContentManifest, {parseApprovedContentManifest} from "./ApprovedContentManifest"
import type {ApprovalBodyProps} from "./registry"

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === "object" && !Array.isArray(value))

// Clamp threshold: beyond this (or any explicit paragraph break) the quote collapses to 4 lines.
const MESSAGE_CLAMP_CHARS = 220

const FieldLabel = ({children}: {children: string}) => (
    <div className="text-[11px] font-medium text-colorTextTertiary">{children}</div>
)

/**
 * The agent's own note about this call (R12), labelled so it reads as a claim and not as a fact
 * about what the commit does. The real diff sits beside it (read-config.md section 12.2, rule 5).
 */
const StatedIntent = ({intent}: {intent: CallDescription}) => (
    <div className="flex min-w-0 flex-col gap-1">
        <FieldLabel>What the agent says it is doing</FieldLabel>
        <div className="text-xs leading-relaxed text-colorTextSecondary">
            {intent.text}
            {intent.truncated ? "… (shortened)" : ""}
        </div>
    </div>
)

const CommitRevisionApproval = ({input, entityId, manifest, fallback}: ApprovalBodyProps) => {
    const [messageExpanded, setMessageExpanded] = useState(false)
    const imported = useMemo(() => parseApprovedContentManifest(manifest), [manifest])
    // Rides at the TOP level of the input, beside `workflow_revision`: it describes the call, not
    // the commit. The runner strips it at dispatch, so the card still has it.
    const intent = useMemo(() => extractCallDescription(input), [input])
    const serverParams = useAtomValue(
        useMemo(() => workflowMolecule.selectors.serverConfiguration(entityId), [entityId]),
    )

    const commit =
        isRecord(input) && isRecord(input.workflow_revision) ? input.workflow_revision : null
    const message = typeof commit?.message === "string" && commit.message ? commit.message : null
    const messageLong =
        !!message && (message.length > MESSAGE_CLAMP_CHARS || message.includes("\n"))

    const preview = useMemo(() => {
        if (!commit || !serverParams) return null
        return classifyRevisionDeltaChanges(serverParams, commit.delta)
    }, [commit, serverParams])

    // No committed base yet or an unpreviewable delta — the exact payload is still the truth. The
    // imported content still renders: it is what the approval binds.
    if (!preview) {
        return (
            <>
                {intent ? (
                    <div className="mb-3">
                        <StatedIntent intent={intent} />
                    </div>
                ) : null}
                {fallback}
                {imported ? (
                    <div className="mt-3">
                        <ApprovedContentManifest manifest={imported} />
                    </div>
                ) : null}
            </>
        )
    }

    // Two-pane echo of the commit modal: context (what + message) left, changes right.
    return (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-0">
            <div className="flex min-w-0 flex-col gap-3 md:pr-6">
                {/* Pane header — same size/weight as the "What's changing" header opposite. The two
                    texts below are different things, so each is labelled: the intent describes the
                    call and is never persisted, the message is saved on the revision. */}
                <div className="text-xs font-semibold text-colorText">
                    Save a new version of this agent
                </div>
                {intent ? <StatedIntent intent={intent} /> : null}
                {message ? (
                    <div className="flex min-w-0 flex-col gap-1">
                        <FieldLabel>Commit message</FieldLabel>
                        <div className="border-0 border-l-2 border-solid border-colorBorderSecondary pl-2.5">
                            <div
                                className={`whitespace-pre-line text-xs leading-relaxed text-colorTextSecondary ${
                                    messageLong && !messageExpanded ? "line-clamp-4" : ""
                                }`}
                            >
                                {message}
                            </div>
                            {messageLong ? (
                                <button
                                    type="button"
                                    onClick={() => setMessageExpanded((s) => !s)}
                                    className="mt-1 cursor-pointer border-0 bg-transparent p-0 text-[11px] text-colorTextTertiary transition-colors hover:text-colorText"
                                >
                                    {messageExpanded ? "Show less" : "Show more"}
                                </button>
                            ) : null}
                        </div>
                    </div>
                ) : null}
            </div>
            <div className="flex min-w-0 flex-col gap-3 md:border-0 md:border-l md:border-solid md:border-colorBorderSecondary md:pl-6">
                <AgentChangesSummary compact size="small" sections={preview.sections} />
                {imported ? <ApprovedContentManifest manifest={imported} /> : null}
            </div>
        </div>
    )
}

export default CommitRevisionApproval
