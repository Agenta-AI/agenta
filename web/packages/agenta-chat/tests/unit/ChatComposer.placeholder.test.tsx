/**
 * @vitest-environment jsdom
 *
 * The agent's own composer names the agent ("Message Support triage", M01 and S03); a quote or a
 * parked question still takes the placeholder.
 */
import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {DEFAULT_ATTACHMENT_LIMITS} from "../../src/assets/attachmentRules"
import {ChatComposer} from "../../src/components/ChatComposer"
import type {useComposerAttachments} from "../../src/hooks/useComposerAttachments"

afterEach(cleanup)

const attachments = {
    uploadsEnabled: false,
    files: [],
    rejections: [],
    limits: DEFAULT_ATTACHMENT_LIMITS,
    atMax: false,
    attachmentsSettled: true,
    uploadBlockReason: undefined,
    addFiles: vi.fn(),
    removeFile: vi.fn(),
    dismissRejection: vi.fn(),
    uploads: {retry: vi.fn(), canRetry: vi.fn()},
} as unknown as ReturnType<typeof useComposerAttachments>

const placeholder = async (props: {agentName?: string; waitingOnUser?: boolean}) => {
    render(<ChatComposer onSubmit={vi.fn()} attachments={attachments} hasTurns {...props} />)
    const editor = await screen.findByRole("textbox", {}, {timeout: 5_000})
    return editor.getAttribute("aria-placeholder")
}

describe("the composer placeholder", () => {
    it("names the agent", async () => {
        expect(await placeholder({agentName: "Support triage"})).toBe("Message Support triage")
    })

    it("still points at a parked question", async () => {
        expect(await placeholder({agentName: "Support triage", waitingOnUser: true})).toBe(
            "Answer above, or type a message instead",
        )
    })

    it("keeps the generic text without an agent", async () => {
        expect(await placeholder({})).toMatch(/^Ask the agent…/)
    })
})
