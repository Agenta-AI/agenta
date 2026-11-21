import type {PendingApproval} from "@agenta/chat/model"

/**
 * The phone builder screens M04 to M06. The chats and the page session are the panel's
 * (`builder-panel.ts`); M05 adds the instructions change of "Urgency of the Safari ticket".
 */
export {BUILDER_CHATS, BUILDER_PANEL_AGENT, PAGE_SESSION} from "./builder-panel"

/** The 14 line diff of M05: one rule of AGENTS.md changes. */
const URGENCY_DIFF = [
    "--- a/AGENTS.md",
    "+++ b/AGENTS.md",
    "@@ -1,14 +1,15 @@",
    " ## Urgency",
    "-A bug is medium unless money is involved.",
    "+A bug is medium unless money is involved or 3 or more customers report it in a week.",
    "+Then it is high.",
    " Billing problems are always high.",
    " A question about a feature is low.",
    " ",
    " ## Category",
    " Use billing, bug, account or feature.",
    " A login problem is an account problem.",
    " ",
    " ## Reply",
    " Thank the customer and say what happens next.",
    " Never promise a date.",
].join("\n")

export const URGENCY_CHANGE: PendingApproval = {
    approvalId: "perm-urgency",
    toolName: "edit_agent_config",
    input: {agent: "Support triage", base_revision_id: "rev-4", operations: []},
    changePreview: {
        applies: true,
        base: {id: "rev-4", version: "4"},
        operations: [{index: 0, applies: true}],
        changes: [
            {
                path: ["parameters", "agent", "instructions", "agents_md"],
                operation_indexes: [0],
                kind: "changed",
                diff: URGENCY_DIFF,
            },
        ],
    },
}
