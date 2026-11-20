/** @vitest-environment jsdom */
import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {RichChatInput} from "../../src/RichChatInput"

afterEach(cleanup)

describe("composer slot before Send", () => {
    it("renders the slot directly before the Send button, after the prefix", () => {
        render(
            <RichChatInput
                onSubmit={vi.fn()}
                prefix={<button type="button">Attach</button>}
                beforeSend={<button type="button">Model</button>}
                trailing={<button type="button">After</button>}
            />,
        )
        const model = screen.getByRole("button", {name: "Model"})
        const send = screen.getByRole("button", {name: "Send"})
        expect(model.parentElement).toBe(send.parentElement)
        const row = Array.from(send.parentElement!.children)
        expect(row.indexOf(model)).toBe(row.indexOf(send) - 1)
        expect(row.indexOf(screen.getByRole("button", {name: "After"}))).toBeGreaterThan(
            row.indexOf(send),
        )
        // The prefix stays in its own group on the left.
        expect(screen.getByRole("button", {name: "Attach"}).parentElement).not.toBe(
            send.parentElement,
        )
    })
})
