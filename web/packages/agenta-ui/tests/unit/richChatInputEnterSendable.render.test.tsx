/** @vitest-environment jsdom */
import {act, cleanup, fireEvent, render} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {RichChatInput} from "../../src/RichChatInput"

afterEach(cleanup)

const pressEnter = async (container: HTMLElement) => {
    const editable = container.querySelector("[contenteditable='true']") as HTMLElement
    expect(editable).toBeTruthy()
    await act(async () => {
        fireEvent.keyDown(editable, {key: "Enter", code: "Enter", keyCode: 13})
    })
}

describe("Enter follows the send button's sendable rule", () => {
    it("sends an empty message when something else is staged (quotes, attachments)", async () => {
        const onSubmit = vi.fn()
        const {container} = render(<RichChatInput onSubmit={onSubmit} sendForceEnabled />)
        await pressEnter(container)
        expect(onSubmit).toHaveBeenCalledWith("")
    })

    it("does nothing on an empty composer with nothing staged", async () => {
        const onSubmit = vi.fn()
        const {container} = render(<RichChatInput onSubmit={onSubmit} />)
        await pressEnter(container)
        expect(onSubmit).not.toHaveBeenCalled()
    })

    it("does nothing while sending is blocked, even with something staged", async () => {
        const onSubmit = vi.fn()
        const {container} = render(
            <RichChatInput onSubmit={onSubmit} sendForceEnabled sendDisabled />,
        )
        await pressEnter(container)
        expect(onSubmit).not.toHaveBeenCalled()
    })
})
