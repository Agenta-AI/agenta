import type {PendingApproval} from "@agenta/chat/model"

import {AGENTS_MD} from "./index"

/**
 * One `edit_agent_config` gate of the builder on "Support triage", base v4: a shorter instructions
 * line and a model change. The preview has the shape of the change-set engine's dry run
 * (`data-approval-preview`).
 */
const NEW_AGENTS_MD = AGENTS_MD.replace("in plain words", "in two short sentences")

const input = {
    agent: "support-triage",
    base_revision_id: "rev-4",
    operations: [
        {
            operation: "edit_text",
            target: ["parameters", "agent", "instructions", "agents_md"],
            edits: [{old_text: "in plain words", new_text: "in two short sentences"}],
        },
        {
            operation: "set",
            target: ["parameters", "agent", "llm", "model"],
            value: "claude-opus-5-5",
        },
    ],
}

const changePreview = {
    applies: true,
    base: {id: "rev-4", version: "4"},
    operations: [
        {index: 0, applies: true},
        {index: 1, applies: true},
    ],
    changes: [
        {
            path: ["parameters", "agent", "instructions", "agents_md"],
            operation_indexes: [0],
            kind: "changed",
            old: AGENTS_MD,
            new: NEW_AGENTS_MD,
        },
        {
            path: ["parameters", "agent", "llm", "model"],
            operation_indexes: [1],
            kind: "changed",
            old: "claude-sonnet-5-5",
            new: "claude-opus-5-5",
        },
    ],
}

export const BUILDER_EDIT_WITH_PREVIEW: PendingApproval = {
    approvalId: "perm-1",
    toolName: "edit_agent_config",
    input,
    changePreview,
}

/** The same gate after a reload: the preview rides the live stream only. */
export const BUILDER_EDIT_NO_PREVIEW: PendingApproval = {
    approvalId: "perm-1",
    toolName: "edit_agent_config",
    input,
}
