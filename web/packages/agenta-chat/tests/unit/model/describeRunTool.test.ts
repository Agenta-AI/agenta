/**
 * What a `run_tool` gate SAYS on the card (qa.md R16).
 *
 * Live QA on 2026-08-27 caught the card showing "Integration · gmail" and "Tool ·
 * CREATE_EMAIL_DRAFT" and nothing else: the generic preview walks the payload's top-level fields,
 * and for `run_tool` the call's real arguments sit one level down under `arguments`, where an
 * object is skipped rather than rendered. The person approving could not see the recipient, the
 * subject, or the body of the mail they were approving.
 *
 * The first test is the regression. It fails against the generic preview.
 */
import {describe, expect, it} from "vitest"

import {describeRunTool} from "../../../src/model/approvalDescribers/describeRunTool"
import {describeApproval} from "../../../src/model/approvalPreview"

const gate = (input: unknown) =>
    ({
        toolName: "run_tool",
        input,
        manifest: undefined,
    }) as never

const draftCall = {
    integration: "gmail",
    tool: "CREATE_EMAIL_DRAFT",
    arguments: {
        recipient_email: "qa-target@example.com",
        subject: "Hello",
        body: "Testing.",
        is_html: false,
        user_id: "me",
    },
}

describe("describeRunTool", () => {
    it("shows the arguments of the call, not only its routing fields", () => {
        const preview = describeRunTool(draftCall, undefined)

        const details = preview?.items.map((item) => item.detail).join(" ")
        expect(details).toContain("qa-target@example.com")
        expect(details).toContain("Hello")
        expect(details).toContain("Testing.")
    })

    it("names the integration and the tool key, never just run_tool", () => {
        const preview = describeRunTool(draftCall, undefined)

        expect(preview?.sentence).toContain("Gmail")
        expect(preview?.items[0]).toEqual({title: "Action", detail: "gmail · CREATE_EMAIL_DRAFT"})
    })

    it("speaks product language in the sentence and keeps the raw pair on the row (#6349)", () => {
        const preview = describeRunTool(
            {integration: "text_to_pdf", tool: "CONVERT_TEXT_TO_PDF", arguments: {text: "Hi"}},
            undefined,
            "Text to PDF",
        )

        expect(preview?.sentence).toBe("The agent wants your approval to run Convert text to PDF.")
        expect(preview?.sentence).not.toContain("text_to_pdf")
        expect(preview?.items[0]).toEqual({
            title: "Action",
            detail: "text_to_pdf · CONVERT_TEXT_TO_PDF",
        })
    })

    it("prefers the catalog name over the slug once it answers", () => {
        const call = {integration: "googlecalendar", tool: "CREATE_EVENT", arguments: {}}

        expect(describeRunTool(call, undefined, "Google Calendar")?.sentence).toBe(
            "The agent wants your approval to run Create event on Google Calendar.",
        )
    })

    it("humanizes the slug while the catalog is still answering", () => {
        const preview = describeRunTool(
            {integration: "text_to_pdf", tool: "CONVERT_TEXT_TO_PDF", arguments: {}},
            undefined,
        )

        expect(preview?.sentence).toBe("The agent wants your approval to run Convert text to PDF.")
    })

    it("keeps the app in the sentence unless the action already says it", () => {
        const preview = describeRunTool(
            {integration: "text_to_pdf", tool: "ADD_WATERMARK_TO_FILE", arguments: {}},
            undefined,
            "Text to PDF",
        )

        // `to` is shared, but only the WHOLE name counts as an echo.
        expect(preview?.sentence).toBe(
            "The agent wants your approval to run Add watermark to file on Text to PDF.",
        )
    })

    it("keeps the app when its name only hides inside a longer action word", () => {
        const preview = describeRunTool(
            {integration: "box", tool: "CREATE_SANDBOX_FOLDER", arguments: {}},
            undefined,
            "Box",
        )

        // "sandbox" contains "box"; only a whole word counts as the app naming itself.
        expect(preview?.sentence).toBe(
            "The agent wants your approval to run Create sandbox folder on Box.",
        )
    })

    it("reads a spelling difference between the app name and the action as an echo", () => {
        const preview = describeRunTool(
            {integration: "one_drive", tool: "LIST_ONE_DRIVE_ITEMS", arguments: {}},
            undefined,
            "OneDrive",
        )

        expect(preview?.sentence).toBe("The agent wants your approval to run List one drive items.")
    })

    it("drops an action key that repeats its integration", () => {
        const preview = describeRunTool(
            {integration: "github", tool: "GITHUB_ADD_ASSIGNEES_TO_AN_ISSUE", arguments: {}},
            undefined,
            "GitHub",
        )

        expect(preview?.sentence).toBe(
            "The agent wants your approval to run Add assignees to an issue on GitHub.",
        )
    })

    it("reports the integration slug so the card can look its catalog name up", () => {
        expect(describeRunTool(draftCall, undefined)?.sourceKey).toBe("gmail")
    })

    it("is the describer the registry resolves for a run_tool gate", () => {
        const preview = describeApproval(gate(draftCall))

        expect(preview.items.map((item) => item.detail)).toContain("gmail · CREATE_EMAIL_DRAFT")
        expect(preview.items.map((item) => item.detail)).toContain("qa-target@example.com")
    })

    it("keeps the action row when the call takes no readable argument", () => {
        const preview = describeRunTool(
            {integration: "gmail", tool: "GET_PROFILE", arguments: {}},
            undefined,
        )

        expect(preview?.items).toEqual([{title: "Action", detail: "gmail · GET_PROFILE"}])
    })

    it("falls back rather than guessing when the payload names no integration or tool", () => {
        expect(describeRunTool({arguments: {subject: "Hello"}}, undefined)).toBeNull()
        expect(describeRunTool("not an object", undefined)).toBeNull()
    })
})
