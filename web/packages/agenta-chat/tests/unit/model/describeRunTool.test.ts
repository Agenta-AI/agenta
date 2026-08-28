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

        expect(preview?.sentence).toContain("gmail")
        expect(preview?.items[0]).toEqual({title: "Action", detail: "gmail · CREATE_EMAIL_DRAFT"})
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
