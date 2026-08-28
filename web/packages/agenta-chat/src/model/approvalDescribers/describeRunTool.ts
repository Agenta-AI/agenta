/**
 * The card for a `run_tool` gate — one integration tool, run through the agent's connection.
 *
 * Without a describer this gate falls to the generic preview, which walks the payload's TOP-LEVEL
 * fields. For `run_tool` those are `integration` and `tool`, both strings, while the call's real
 * payload sits one level down in `arguments` and is skipped for being an object. The card then
 * shows the two routing values and hides the recipient, the subject and the body — the inverse of
 * what an approval is for (qa.md R16).
 *
 * So this describer names the integration and the action in the sentence, where they are always
 * visible, and gives the rows to `arguments`.
 */
import type {ApprovalDescriber, ApprovalPreview} from "../../skin/types"

import {asSentence, readableFieldRows} from "./approvalText"

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === "object" && !Array.isArray(value))

/** `CREATE_EMAIL_DRAFT` → `create email draft`, so the sentence reads as English. */
const spokenTool = (tool: string): string => tool.replace(/[_-]+/g, " ").trim().toLowerCase()

export const describeRunTool: ApprovalDescriber = (input): ApprovalPreview | null => {
    if (!isRecord(input)) return null
    const integration = typeof input.integration === "string" ? input.integration.trim() : ""
    const tool = typeof input.tool === "string" ? input.tool.trim() : ""
    if (!integration || !tool) return null

    const rows = readableFieldRows(input.arguments)
    return {
        sentence: asSentence(
            `The agent wants your approval to run ${spokenTool(tool)} on ${integration}`,
        ),
        // The identity stays on every row list even when the call takes no readable argument, so
        // the toggle never reads "(0)" for a gate that is really about one named action.
        items: [{title: "Action", detail: `${integration} · ${tool}`}, ...rows],
    }
}
