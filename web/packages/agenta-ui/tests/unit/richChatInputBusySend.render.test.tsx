/** @vitest-environment jsdom */
import {createRef} from "react"

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {RichChatInput, type RichChatInputHandle} from "../../src/RichChatInput"

afterEach(cleanup)

describe("busy composer standard Send", () => {
    it("keeps Stop when empty and sends a draft through the normal callback", async () => {
        const onSubmit = vi.fn()
        const onStop = vi.fn()
        const ref = createRef<RichChatInputHandle>()
        render(<RichChatInput ref={ref} streaming onStop={onStop} onSubmit={onSubmit} />)
        expect(screen.getByRole("button", {name: "Stop"})).toBeTruthy()
        expect(screen.queryByRole("button", {name: "Send"})).toBeNull()
        await act(async () => ref.current?.setMarkdown("next message"))
        fireEvent.click(screen.getByRole("button", {name: "Send"}))
        expect(onSubmit).toHaveBeenCalledWith("next message")
        expect(screen.queryByRole("button", {name: "Queue"})).toBeNull()
        expect(screen.queryByRole("button", {name: "Steer"})).toBeNull()
        fireEvent.click(screen.getByRole("button", {name: "Stop"}))
        expect(onStop).toHaveBeenCalledOnce()
    })

    it("shows standard Send for attachment-only drafts and respects upload blocking", () => {
        const onSubmit = vi.fn()
        const view = render(
            <RichChatInput
                streaming
                onStop={vi.fn()}
                onSubmit={onSubmit}
                sendForceEnabled
                sendDisabled
            />,
        )
        const send = screen.getByRole("button", {name: "Send"}) as HTMLButtonElement
        expect(send.disabled).toBe(true)
        fireEvent.click(send)
        expect(onSubmit).not.toHaveBeenCalled()
        view.rerender(
            <RichChatInput streaming onStop={vi.fn()} onSubmit={onSubmit} sendForceEnabled />,
        )
        fireEvent.click(screen.getByRole("button", {name: "Send"}))
        expect(onSubmit).toHaveBeenCalledWith("")
    })
})
