// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {InlineConfirm} from "../../src/components/ui/inline-confirm"
import {SkeletonRows} from "../../src/components/ui/skeleton-rows"

/**
 * The confirm step for a destructive action that is only meaningful next to the thing it acts on:
 * it renders under the control that opened it instead of in a popover, which on a phone would
 * cover that row.
 */
afterEach(cleanup)

const setup = (overrides: Partial<React.ComponentProps<typeof InlineConfirm>> = {}) => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
        <InlineConfirm
            message="Remove linear from this agent? The connection stays in the project."
            confirmLabel="Remove"
            onConfirm={onConfirm}
            onCancel={onCancel}
            {...overrides}
        />,
    )
    return {onConfirm, onCancel}
}

describe("InlineConfirm", () => {
    it("renders the sentence and both buttons", () => {
        setup()
        expect(
            screen.getByText("Remove linear from this agent? The connection stays in the project."),
        ).toBeTruthy()
        expect(screen.getByRole("button", {name: "Remove"})).toBeTruthy()
        expect(screen.getByRole("button", {name: "Cancel"})).toBeTruthy()
    })

    it("the confirm is the danger variant and the cancel is the text one", () => {
        setup()
        expect(screen.getByRole("button", {name: "Remove"}).className).toContain("text-error")
        expect(screen.getByRole("button", {name: "Cancel"}).className).toContain("bg-transparent")
    })

    it("calls back on each button", () => {
        const {onConfirm, onCancel} = setup()
        fireEvent.click(screen.getByRole("button", {name: "Remove"}))
        expect(onConfirm).toHaveBeenCalledTimes(1)
        fireEvent.click(screen.getByRole("button", {name: "Cancel"}))
        expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it("opens focus on Cancel, so a second Enter does not confirm", () => {
        setup()
        expect(document.activeElement).toBe(screen.getByRole("button", {name: "Cancel"}))
    })

    it("Escape cancels", () => {
        const {onCancel, onConfirm} = setup()
        fireEvent.keyDown(screen.getByRole("group"), {key: "Escape"})
        expect(onCancel).toHaveBeenCalledTimes(1)
        expect(onConfirm).not.toHaveBeenCalled()
    })

    it("announces itself, because it appears after a click", () => {
        setup()
        expect(screen.getByRole("group").getAttribute("aria-live")).toBe("polite")
    })
})

describe("SkeletonRows", () => {
    it("draws three rows by default", () => {
        render(<SkeletonRows data-testid="rows" />)
        expect(
            screen.getByTestId("rows").querySelectorAll("[data-slot=skeleton-block]").length,
        ).toBe(3)
    })

    it("takes a count", () => {
        render(<SkeletonRows data-testid="rows" count={5} />)
        expect(
            screen.getByTestId("rows").querySelectorAll("[data-slot=skeleton-block]").length,
        ).toBe(5)
    })

    it("is decorative: the placeholder is hidden from assistive technology", () => {
        render(<SkeletonRows data-testid="rows" />)
        expect(screen.getByTestId("rows").getAttribute("aria-hidden")).toBe("true")
    })

    it("shimmers by default and the row height is overridable", () => {
        render(<SkeletonRows data-testid="rows" rowClassName="h-16" />)
        const first = screen.getByTestId("rows").querySelector("[data-slot=skeleton-block]")
        expect(first?.className).toContain("animate-skeleton")
        expect(first?.className).toContain("h-16")
    })
})
