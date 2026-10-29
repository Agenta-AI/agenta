/**
 * @vitest-environment jsdom
 *
 * Enter on a touch-only device inserts a newline; only a device with a hardware keyboard — the
 * one place Shift/⌘ can be held for a newline — sends on Enter.
 */
import {createRef} from "react"

import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {act, cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {DEFAULT_ATTACHMENT_LIMITS} from "../../src/assets/attachmentRules"
import {ChatComposer} from "../../src/components/ChatComposer"
import type {useComposerAttachments} from "../../src/hooks/useComposerAttachments"

afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
})

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

/** `(hover: none) and (pointer: coarse)` answers `matches` — what a phone reports. */
const stubTouchOnly = (matches: boolean) => {
    vi.stubGlobal("matchMedia", (query: string) => ({
        matches: query.includes("hover: none") ? matches : false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
    }))
}

const typeAndEnter = async (onSubmit: ReturnType<typeof vi.fn>) => {
    const ref = createRef<RichChatInputHandle>()
    render(
        <ChatComposer
            onSubmit={onSubmit}
            attachments={attachments}
            streaming={false}
            inputRef={ref}
        />,
    )
    const editor = await screen.findByRole("textbox", {}, {timeout: 5_000})
    await act(async () => {
        ref.current?.focus()
        ref.current?.insertText("hello")
    })
    await act(async () => {
        editor.dispatchEvent(
            new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}),
        )
    })
    return ref
}

describe("ChatComposer: Enter on a touch-only device", () => {
    it("adds a newline instead of sending", async () => {
        stubTouchOnly(true)
        const onSubmit = vi.fn()
        const ref = await typeAndEnter(onSubmit)
        expect(onSubmit).not.toHaveBeenCalled()
        expect(ref.current?.getMarkdown()).toBe("hello\n")
    })

    it("still sends where a hardware keyboard is present", async () => {
        stubTouchOnly(false)
        const onSubmit = vi.fn()
        await typeAndEnter(onSubmit)
        expect(onSubmit).toHaveBeenCalledTimes(1)
    })
})
