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
 *
 * The sentence speaks product language, never the wire identifiers (#6349): the action reads as the
 * permission drawer labels it, and the integration reads as the catalog names it. The `Action` row
 * keeps the raw `slug · ACTION_KEY` pair — that is the one place the precise identifier belongs.
 */
import {humanizeActionKey} from "@agenta/shared/utils"

import type {ApprovalDescriber, ApprovalPreview} from "../../skin/types"

import {asSentence, readableFieldRows} from "./approvalText"

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === "object" && !Array.isArray(value))

const squash = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, "")

/**
 * Whether the action already says the app ("Convert text to PDF" on "Text to PDF").
 *
 * Matches the whole app name against a run of WHOLE action words, so neither loose test misfires:
 * `registry.ts`'s word-level `echoesApp` would echo "Text to PDF" on the stopword "to" alone, while
 * plain containment would echo "Box" inside "sandbox". Dropping the app from a trust decision is
 * the strict case, and a run keeps the spelling difference between "OneDrive" and "one drive".
 */
const namesApp = (action: string, appName: string): boolean => {
    const app = squash(appName)
    if (!app) return false
    const words = action.split(/\s+/).filter(Boolean)
    return words.some((_, start) => {
        let run = ""
        for (let end = start; end < words.length && run.length < app.length; end++) {
            run += squash(words[end])
            if (run === app) return true
        }
        return false
    })
}

export const describeRunTool: ApprovalDescriber = (
    input,
    _manifest,
    appName,
): ApprovalPreview | null => {
    if (!isRecord(input)) return null
    const integration = typeof input.integration === "string" ? input.integration.trim() : ""
    const tool = typeof input.tool === "string" ? input.tool.trim() : ""
    if (!integration || !tool) return null

    // Until the catalog answers, the humanized slug already reads as the real name ("text_to_pdf"
    // → "Text to PDF"), so the sentence never flickers through the raw identifier.
    const app = appName || humanizeActionKey(integration)
    const action = humanizeActionKey(tool, integration)
    const source = namesApp(action, app) ? "" : ` on ${app}`

    const rows = readableFieldRows(input.arguments)
    return {
        sentence: asSentence(`The agent wants your approval to run ${action}${source}`),
        // The identity stays on every row list even when the call takes no readable argument, so
        // the toggle never reads "(0)" for a gate that is really about one named action.
        items: [{title: "Action", detail: `${integration} · ${tool}`}, ...rows],
        sourceKey: integration,
    }
}
