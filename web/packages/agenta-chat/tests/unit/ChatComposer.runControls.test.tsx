/**
 * @vitest-environment jsdom
 */
import {cleanup, fireEvent, render, screen} from "@testing-library/react"
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

const renderComposer = async (busyActions?: {label: string; onSubmit: (text: string) => void}[]) => {
    const onStop = vi.fn()
    render(
        <ChatComposer
            onSubmit={vi.fn()}
            attachments={attachments}
            streaming
            onStop={onStop}
            busyActions={busyActions}
        />,
    )
    await screen.findByRole("button", {name: "Stop"})
    return onStop
}

describe("ChatComposer running controls", () => {
    it("keeps Stop and Escape on a fresh session's first running turn", async () => {
        const onStop = await renderComposer()

        expect(screen.getByRole("button", {name: "Stop"}).getAttribute("aria-keyshortcuts")).toBe(
            "Escape",
        )
        fireEvent.keyDown(document, {key: "Escape"})
        expect(onStop).toHaveBeenCalledOnce()
    })

    it("keeps Stop and Escape beside Queue and Steer for a durable queued turn", async () => {
        const onStop = await renderComposer([
            {label: "Queue", onSubmit: vi.fn()},
            {label: "Steer", onSubmit: vi.fn()},
        ])

        expect(screen.getByRole("button", {name: "Queue"})).toBeTruthy()
        expect(screen.getByRole("button", {name: "Steer"})).toBeTruthy()
        expect(screen.getByRole("button", {name: "Stop"})).toBeTruthy()
        fireEvent.keyDown(document, {key: "Escape"})
        expect(onStop).toHaveBeenCalledOnce()
    })
})
