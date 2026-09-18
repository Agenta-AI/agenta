// @vitest-environment jsdom
import * as React from "react"

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react"
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

    it("announces the consequence on insertion", () => {
        // It used to be an `aria-live` region mounted with its text already in it, which
        // announces nothing: a live region announces CHANGES to a region already in the tree.
        // An alert is announced when it is inserted, which is the only moment there is here.
        setup()
        const alert = screen.getByRole("alert")
        expect(alert.textContent).toBe(
            "Remove linear from this agent? The connection stays in the project.",
        )
    })

    it("describes both buttons with the consequence, so focus reads it out", () => {
        // Focus opens on Cancel, so without this a screen reader user hears "Cancel, button" and
        // is one Tab and one Enter from a destructive action whose consequence was never read.
        setup()
        const alert = screen.getByRole("alert")
        expect(alert.id).toBeTruthy()
        for (const name of ["Remove", "Cancel"]) {
            expect(screen.getByRole("button", {name}).getAttribute("aria-describedby"), name).toBe(
                alert.id,
            )
        }
    })
})

describe("InlineConfirm's focus on close", () => {
    /** The call site's arrangement: a trigger that swaps ITSELF for the confirm and back. */
    const Swapping = () => {
        const [confirming, setConfirming] = React.useState(false)
        return (
            <div>
                {confirming ? (
                    <InlineConfirm
                        message="Remove linear from this agent? The connection stays in the project."
                        confirmLabel="Remove"
                        onConfirm={() => setConfirming(false)}
                        onCancel={() => setConfirming(false)}
                    />
                ) : (
                    <button type="button" onClick={() => setConfirming(true)}>
                        Remove from agent
                    </button>
                )}
            </div>
        )
    }

    it("returns focus to the control that opened it, which is a new node by then", async () => {
        // Cancelling used to leave focus on `body`, so a keyboard user had to tab back through
        // the whole drawer. The trigger element that had focus is gone by the time this closes,
        // which is why the slot it occupied is what gets asked for a control.
        render(<Swapping />)
        const trigger = screen.getByRole("button", {name: "Remove from agent"})
        act(() => trigger.focus())
        fireEvent.click(trigger)
        expect(document.activeElement).toBe(screen.getByRole("button", {name: "Cancel"}))

        await act(async () => {
            fireEvent.click(screen.getByRole("button", {name: "Cancel"}))
        })

        expect(document.activeElement).toBe(screen.getByRole("button", {name: "Remove from agent"}))
    })

    it("returns focus to a trigger that stayed mounted", async () => {
        // The other arrangement, and the one the Storybook story draws: the trigger stays and the
        // confirm opens beneath it. Then the element that had focus is still there to give it to.
        const Beside = () => {
            const [confirming, setConfirming] = React.useState(false)
            return (
                <div>
                    <button type="button" onClick={() => setConfirming(true)}>
                        Remove from agent
                    </button>
                    {confirming ? (
                        <InlineConfirm
                            message="Remove linear from this agent? The connection stays in the project."
                            confirmLabel="Remove"
                            onConfirm={() => setConfirming(false)}
                            onCancel={() => setConfirming(false)}
                        />
                    ) : null}
                </div>
            )
        }
        render(<Beside />)
        const trigger = screen.getByRole("button", {name: "Remove from agent"})
        act(() => trigger.focus())
        fireEvent.click(trigger)

        await act(async () => {
            fireEvent.click(screen.getByRole("button", {name: "Cancel"}))
        })

        expect(document.activeElement).toBe(trigger)
    })

    it("leaves focus alone when the reader has already moved it elsewhere", async () => {
        // Pulling focus back from wherever someone chose to put it is worse than dropping it.
        render(<Swapping />)
        const outside = document.createElement("button")
        document.body.appendChild(outside)

        fireEvent.click(screen.getByRole("button", {name: "Remove from agent"}))
        act(() => outside.focus())
        await act(async () => {
            fireEvent.keyDown(screen.getByRole("group"), {key: "Escape"})
        })

        expect(document.activeElement).toBe(outside)
        outside.remove()
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
