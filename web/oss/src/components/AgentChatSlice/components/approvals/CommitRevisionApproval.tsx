/**
 * Friendly body for `commit_revision` approvals: the payload's commit message plus the same
 * "What's changing" sections the commit modal renders. The delta is resolved against the
 * revision's committed (server) parameters — the same base the backend applies it to — so the
 * preview shows exactly what the new version would contain.
 */
import {useMemo, useState} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {classifyRevisionDeltaChanges} from "@agenta/entities/workflow/commitDiff"
import {AgentChangesSummary} from "@agenta/entity-ui/modals"
import {useAtomValue} from "jotai"

import type {ApprovalBodyProps} from "./registry"

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === "object" && !Array.isArray(value))

// Clamp threshold: beyond this (or any explicit paragraph break) the quote collapses to 4 lines.
const MESSAGE_CLAMP_CHARS = 220

const CommitRevisionApproval = ({input, entityId, fallback}: ApprovalBodyProps) => {
    const [messageExpanded, setMessageExpanded] = useState(false)
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

    // No committed base yet or an unpreviewable delta — the exact payload is still the truth.
    if (!preview) return <>{fallback}</>

    // Two-pane echo of the commit modal: context (what + message) left, changes right.
    return (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-0">
            <div className="flex min-w-0 flex-col md:pr-6">
                {/* Pane header — same size/weight as the "What's changing" header opposite. The
                    agent's own commit message is the description; no connective copy needed. */}
                <div className="pb-3 text-xs font-semibold text-colorText">
                    Save a new version of this agent
                </div>
                {message ? (
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
                ) : null}
            </div>
            <div className="min-w-0 md:border-0 md:border-l md:border-solid md:border-colorBorderSecondary md:pl-6">
                <AgentChangesSummary compact size="small" sections={preview.sections} />
            </div>
        </div>
    )
}

export default CommitRevisionApproval
