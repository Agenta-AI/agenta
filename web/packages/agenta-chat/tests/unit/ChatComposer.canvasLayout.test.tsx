/**
 * @vitest-environment jsdom
 *
 * The canvas composer (S07, M04): the builder's context chip sits inside the box padding, not on
 * its corner.
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

const renderCanvas = () =>
    render(
        <ChatComposer
            onSubmit={vi.fn()}
            attachments={attachments}
            surface="canvas"
            headerExtra={<span data-testid="chip">Support triage</span>}
        />,
    )

describe("the canvas composer", () => {
    it("pads the header slot like the editor", async () => {
        renderCanvas()
        await screen.findByRole("textbox", {}, {timeout: 5_000})
        const slot = screen.getByTestId("chip").parentElement as HTMLElement
        expect(slot.className).toContain("pl-3.5")
        expect(slot.className).toContain("pt-3")
    })
})
