import type {PendingApproval} from "@agenta/chat/model"

import {
    ADD_SKILL,
    BASE_REVISION_ID,
    CHANGE_MODEL,
    EDIT_INSTRUCTIONS,
    SEVERAL_CHANGES,
} from "./card-data"

/**
 * Change card states and results (task 26) for "Support triage" on base v4. The tool results and
 * the refusal text are in the shapes the API handler and the runner return (recorded tool
 * results: `revision: {id, version}`; a refusal is the reason line, then its envelope as JSON).
 */

const T = ["parameters", "agent"]

/** Three pending calls of one paused turn: one grouped card, one group per call. */
export const GROUPED_CALLS: PendingApproval[] = [EDIT_INSTRUCTIONS, ADD_SKILL, CHANGE_MODEL]

/** The agent's own chat: `commit_revision` edits its own instructions (no server preview). */
export const OWN_COMMIT: PendingApproval = {
    approvalId: "card-own-commit",
    toolName: "commit_revision",
    input: {
        workflow_revision: {
            base_revision_id: BASE_REVISION_ID,
            message: "Shorter replies for billing tickets",
            delta: {
                operations: [
                    {
                        operation: "edit_text",
                        target: [...T, "instructions", "agents_md"],
                        edits: [
                            {
                                old_text: "Draft a first reply in two short sentences.",
                                new_text:
                                    "Draft a first reply in two short sentences.\nFor billing tickets, use one sentence.",
                            },
                        ],
                    },
                ],
            },
        },
    },
}

/** A tool approval in an agent's own chat that is not a configuration change. */
export const CLOSE_TICKET: PendingApproval = {
    approvalId: "card-close-ticket",
    toolName: "tools__gateway__zendesk__CLOSE_TICKET",
    input: {ticket_id: "48213"},
}

const committed = (version: string) => ({
    status: "committed",
    agent: {id: "wf-support-triage", name: "Support triage", slug: "support-triage"},
    revision: {id: `rev-support-triage-${version}`, version},
    base_revision_id: `rev-support-triage-${version}`,
    warnings: [],
})

const refusal = (code: string, message: string) =>
    `tool call tools.agenta.edit_agent_config failed: ${message}\n${JSON.stringify({
        code,
        message,
        retryable: false,
        next_step: "Call read_agent_config again and send the change on the new base.",
    })}`

const toolPart = (
    toolCallId: string,
    approval: PendingApproval,
    fields: Record<string, unknown>,
) => ({
    type: `tool-${approval.toolName}`,
    toolCallId,
    input: approval.input,
    approval: {id: approval.approvalId, approved: true},
    ...fields,
})

/** One message per result row of canvas C01. */
export const RESULT_PARTS = {
    waiting: [toolPart("c-wait", CHANGE_MODEL, {state: "approval-responded"})],
    saved: [toolPart("c-saved", SEVERAL_CHANGES, {state: "output-available", output: committed("5")})],
    denied: [
        toolPart("c-denied", CHANGE_MODEL, {
            state: "output-denied",
            approval: {id: CHANGE_MODEL.approvalId, approved: false},
        }),
    ],
    conflict: [
        toolPart("c-conflict", CHANGE_MODEL, {
            state: "output-error",
            errorText: refusal(
                "revision_conflict",
                "The workflow head changed. No revision was committed.",
            ),
        }),
    ],
    accessDenied: [
        toolPart("c-access", CHANGE_MODEL, {
            state: "output-error",
            errorText: refusal("access_denied", "You may not change 'Support triage'. Nothing was saved."),
        }),
    ],
}

/** Two calls on base v4 approved together: one saves v5, the other conflicts. */
export const TWO_CALLS_ONE_BASE = [
    toolPart("c-first", EDIT_INSTRUCTIONS, {state: "output-available", output: committed("5")}),
    toolPart("c-second", CHANGE_MODEL, {
        state: "output-error",
        errorText: refusal("revision_conflict", "The workflow head changed. No revision was committed."),
    }),
]
