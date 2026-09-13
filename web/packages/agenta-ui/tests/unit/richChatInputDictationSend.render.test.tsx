/**
 * @vitest-environment jsdom
 *
 * A send while dictation is still closing.
 *
 * The recogniser flushes a last final result on its way out, and that result arrives after the
 * send has already emptied the editor. The session's nodes are recreated on demand, so unless the
 * send retires the session, the words that just left as a message are written straight back into
 * the composer.
 */
import {act, cleanup, render} from "@testing-library/react"
import {createRef} from "react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {RichChatInput, type RichChatInputHandle} from "../../src/RichChatInput"

afterEach(cleanup)

const setup = () => {
    const onSubmit = vi.fn()
    const ref = createRef<RichChatInputHandle>()
    const view = render(<RichChatInput ref={ref} onSubmit={onSubmit} />)
    return {onSubmit, ref, view}
}

const editorText = (container: HTMLElement) =>
    container.querySelector('[contenteditable="true"]')?.textContent ?? ""

describe("RichChatInput dictation across a send", () => {
    it("drops the session on send, so a trailing result cannot refill the composer", async () => {
        const {onSubmit, ref, view} = setup()

        await act(async () => {
            ref.current?.beginDictation()
            ref.current?.updateDictation("hello world", "")
        })
        expect(editorText(view.container)).toContain("hello world")

        const send = view.container.querySelector<HTMLButtonElement>('button[aria-label="Send"]')
        await act(async () => send?.click())
        expect(onSubmit).toHaveBeenCalledWith("hello world")

        // The recogniser's parting result, arriving after the composer was emptied.
        await act(async () => ref.current?.updateDictation("hello world", ""))
        expect(editorText(view.container)).toBe("")
    })

    it("drops the session on clear too", async () => {
        const {ref, view} = setup()
        await act(async () => {
            ref.current?.beginDictation()
            ref.current?.updateDictation("hello world", "")
        })
        await act(async () => {
            ref.current?.clear()
            ref.current?.updateDictation("hello world", "")
        })
        expect(editorText(view.container)).toBe("")
    })
})
