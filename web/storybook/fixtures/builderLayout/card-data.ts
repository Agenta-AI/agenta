import type {PendingApproval} from "@agenta/chat/model"

import {AGENTS_MD} from "./index"

/**
 * The change cards of canvas C01 (edits, items and permissions) for the agent "Support triage"
 * on base v4: each an `edit_agent_config` gate with the server preview the change-set engine
 * returns (`data-approval-preview`), in the contract's shape.
 */

const AGENT = "support-triage"
export const BASE_REVISION_ID = "rev-support-triage-4"
export const AGENT_WORKFLOW_ID = "wf-support-triage"
const BASE = {id: BASE_REVISION_ID, version: "4"}
const T = ["parameters", "agent"]

const gate = (
    approvalId: string,
    operations: unknown[],
    changes: unknown[] | null,
): PendingApproval => ({
    approvalId,
    toolName: "edit_agent_config",
    input: {agent: AGENT, base_revision_id: BASE_REVISION_ID, operations},
    ...(changes
        ? {
              changePreview: {
                  applies: true,
                  base: BASE,
                  operations: operations.map((_, index) => ({index, applies: true})),
                  changes,
              },
          }
        : {}),
})

// Edit the instructions: a longer AGENTS.md, so the diff folds and offers the full diff.
const URGENCY_OLD = [
    AGENTS_MD,
    "",
    "## Urgency",
    "A bug is medium unless money is involved.",
    "Billing problems are always high.",
    "",
    "## Categories",
    "Use one category per ticket: billing, bug, account, how-to or other.",
    "If a ticket fits two categories, pick the one that needs the faster answer.",
    "",
    "## Replies",
    "Draft a first reply in two short sentences.",
    "Never promise a refund.",
].join("\n")
const URGENCY_NEW = URGENCY_OLD.replace(
    "A bug is medium unless money is involved.",
    "A bug is medium unless money is involved or 3 or more\ncustomers report it in a week. Then it is high.",
).replace("Never promise a refund.", "Never promise a refund or a date.")
const INSTRUCTIONS = [...T, "instructions", "agents_md"]

export const EDIT_INSTRUCTIONS = gate(
    "card-instructions",
    [
        {
            operation: "edit_text",
            target: INSTRUCTIONS,
            edits: [
                {
                    old_text: "A bug is medium unless money is involved.",
                    new_text:
                        "A bug is medium unless money is involved or 3 or more\ncustomers report it in a week. Then it is high.",
                },
            ],
        },
    ],
    [
        {
            path: INSTRUCTIONS,
            operation_indexes: [0],
            kind: "changed",
            old: URGENCY_OLD,
            new: URGENCY_NEW,
        },
    ],
)

// Edit a skill file.
const SKILL_FILE = [
    ...T,
    {list: "skills", key: "ticket-triage"},
    {list: "files", key: "references/urgency-rules.md"},
    "content",
]
export const EDIT_SKILL_FILE = gate(
    "card-skill-file",
    [
        {
            operation: "edit_text",
            target: SKILL_FILE,
            edits: [
                {old_text: "| bug | medium |", new_text: "| bug | medium, high from 3 reports |"},
            ],
        },
    ],
    [
        {
            path: SKILL_FILE,
            operation_indexes: [0],
            kind: "changed",
            old: "| Category | Default |\n| bug | medium |",
            new: "| Category | Default |\n| bug | medium, high from 3 reports |",
        },
    ],
)

// Change the model: the model and the reasoning, under one header.
export const CHANGE_MODEL = gate(
    "card-model",
    [
        {
            operation: "merge",
            target: [...T, "llm"],
            value: {model: "claude-opus-5-5", reasoning: "medium"},
        },
    ],
    // The server keeps the merge's target: one change at `llm` with the old and new objects.
    [
        {
            path: [...T, "llm"],
            operation_indexes: [0],
            kind: "changed",
            old: {provider: "anthropic", model: "claude-sonnet-5-5", reasoning: "low"},
            new: {provider: "anthropic", model: "claude-opus-5-5", reasoning: "medium"},
        },
    ],
)

// Add a skill, with its files; one can run as a program.
const REFUND_CHECK = {
    name: "refund-check",
    description: "Checks if a charge can be refunded",
    body: "# Refund check\nLook up the charge, then check the refund policy.",
    files: [
        {path: "references/refund-policy.md", content: "Refunds within 30 days."},
        {path: "scripts/lookup_charge.py", content: "print('charge')", executable: true},
    ],
}
export const ADD_SKILL = gate(
    "card-add-skill",
    [{operation: "add_item", target: [...T, "skills"], value: REFUND_CHECK}],
    [
        {
            path: [...T, {list: "skills", key: "refund-check"}],
            operation_indexes: [0],
            kind: "added",
            new: REFUND_CHECK,
        },
    ],
)

// Add an MCP server: data leaves Agenta.
const LINEAR = {name: "linear", connection: {type: "http", url: "https://mcp.linear.app/sse"}}
export const ADD_MCP_SERVER = gate(
    "card-add-mcp",
    [{operation: "add_item", target: [...T, "mcps"], value: LINEAR}],
    [
        {
            path: [...T, {list: "mcps", key: "linear"}],
            operation_indexes: [0],
            kind: "added",
            new: LINEAR,
        },
    ],
)

// Change a tool permission: "Close ticket" to Allow asks the person less.
const ZENDESK = {list: "tools", key: "gateway_connection:composio:zendesk"}
const permission = (tool: string) => [...T, ZENDESK, "policy", "permissions", "tools", tool]
export const CHANGE_PERMISSION = gate(
    "card-permission",
    [
        {operation: "set", target: permission("ZENDESK_CLOSE_TICKET"), value: "allow"},
        {operation: "set", target: permission("ZENDESK_DELETE_TICKET"), value: "deny"},
    ],
    [
        {
            path: permission("ZENDESK_CLOSE_TICKET"),
            operation_indexes: [0],
            kind: "changed",
            old: "ask",
            new: "allow",
        },
        {
            path: permission("ZENDESK_DELETE_TICKET"),
            operation_indexes: [1],
            kind: "changed",
            old: "ask",
            new: "deny",
        },
    ],
)

// Remove an integration: the main button reads "Remove".
const GMAIL = {list: "tools", key: "gateway_connection:composio:gmail"}
export const REMOVE_INTEGRATION = gate(
    "card-remove-integration",
    [{operation: "remove_item", target: [...T, GMAIL]}],
    [
        {
            path: [...T, GMAIL],
            operation_indexes: [0],
            kind: "removed",
            old: {type: "gateway_connection", provider: "composio", integration: "gmail"},
        },
    ],
)

// The same instructions edit with no server preview: the proposed fragments, with the label.
export const EDIT_INSTRUCTIONS_NO_PREVIEW = gate(
    "card-no-preview",
    (EDIT_INSTRUCTIONS.input as {operations: unknown[]}).operations,
    null,
)

// One call with three operations: one card, one header per change.
export const SEVERAL_CHANGES = gate(
    "card-several",
    [
        ...(EDIT_SKILL_FILE.input as {operations: unknown[]}).operations,
        ...(CHANGE_MODEL.input as {operations: unknown[]}).operations,
        ...(ADD_MCP_SERVER.input as {operations: unknown[]}).operations,
    ],
    [
        {
            ...(EDIT_SKILL_FILE.changePreview as {changes: object[]}).changes[0],
            operation_indexes: [0],
        },
        ...(CHANGE_MODEL.changePreview as {changes: object[]}).changes.map((change) => ({
            ...change,
            operation_indexes: [1],
        })),
        {
            ...(ADD_MCP_SERVER.changePreview as {changes: object[]}).changes[0],
            operation_indexes: [2],
        },
    ],
)

/**
 * The base revision and the agent's latest revision, as the query cache holds them: v5 landed
 * after the builder read v4, so the card shows the conflict before a click.
 */
export const conflictQueries = (projectId: string): [unknown[], unknown][] => [
    [
        ["workflows", "revision", BASE_REVISION_ID, projectId],
        {id: BASE_REVISION_ID, version: 4, workflow_id: AGENT_WORKFLOW_ID},
    ],
    [
        ["workflows", "latestRevision", AGENT_WORKFLOW_ID, projectId],
        {id: "rev-support-triage-5", version: 5, workflow_id: AGENT_WORKFLOW_ID},
    ],
]
