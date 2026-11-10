/**
 * @vitest-environment jsdom
 *
 * The form-view node fold toggle is a named button that keyboard users can reach and operate.
 */
import {cleanup, fireEvent, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import NodeHeader from "../../src/Editor/form/shared/NodeHeader"

afterEach(cleanup)

describe("NodeHeader fold toggle", () => {
    it("is a button named for what it does, with the expanded state", () => {
        const {rerender} = render(
            <NodeHeader depth={0} folded onToggle={() => {}}>
                <span>config</span>
            </NodeHeader>,
        )
        const toggle = screen.getByRole("button", {name: "Expand"})
        expect(toggle.getAttribute("type")).toBe("button")
        expect(toggle.getAttribute("aria-expanded")).toBe("false")

        rerender(
            <NodeHeader depth={0} folded={false} onToggle={() => {}}>
                <span>config</span>
            </NodeHeader>,
        )
        expect(
            screen.getByRole("button", {name: "Collapse"}).getAttribute("aria-expanded"),
        ).toBe("true")
    })

    it("calls onToggle on click and is focusable", () => {
        const onToggle = vi.fn()
        render(
            <NodeHeader depth={0} folded onToggle={onToggle}>
                <span>config</span>
            </NodeHeader>,
        )
        const toggle = screen.getByRole("button", {name: "Expand"})
        toggle.focus()
        expect(document.activeElement).toBe(toggle)
        fireEvent.click(toggle)
        expect(onToggle).toHaveBeenCalledTimes(1)
    })
})
