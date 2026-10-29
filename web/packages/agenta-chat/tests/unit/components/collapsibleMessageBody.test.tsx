/**
 * @vitest-environment jsdom
 *
 * The long-message clamp: a long body clamps and reopens, a short one is left alone (a "Show more"
 * on a two-line message is a bug), and an expanded message survives the windowed transcript
 * unmounting its row.
 */
import {cleanup, fireEvent, render, screen} from "@testing-library/react"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {
    COLLAPSED_MESSAGE_MAX_PX,
    CollapsibleMessageBody,
} from "../../../src/components/CollapsibleMessageBody"

/** jsdom lays nothing out, so drive the measured height directly. */
const stubHeight = (px: number) => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
        height: px,
    } as DOMRect)
}

const region = (container: HTMLElement) =>
    container.querySelector(".overflow-hidden") as HTMLElement

beforeEach(() => {
    vi.stubGlobal(
        "ResizeObserver",
        class {
            observe() {}
            disconnect() {}
        },
    )
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    cleanup()
})

describe("CollapsibleMessageBody", () => {
    it("clamps a long body and reveals it on Show more", () => {
        stubHeight(COLLAPSED_MESSAGE_MAX_PX * 4)
        const {container} = render(
            <CollapsibleMessageBody stateKey="m1::body">
                <p>a very long pasted message</p>
            </CollapsibleMessageBody>,
        )

        expect(region(container).style.maxHeight).toBe(`${COLLAPSED_MESSAGE_MAX_PX}px`)
        const toggle = screen.getByRole("button", {name: "Show more"})
        expect(toggle.getAttribute("aria-expanded")).toBe("false")

        fireEvent.click(toggle)

        expect(region(container).style.maxHeight).toBe(`${COLLAPSED_MESSAGE_MAX_PX * 4}px`)
        expect(screen.getByRole("button", {name: "Show less"}).getAttribute("aria-expanded")).toBe(
            "true",
        )
    })

    it("leaves a short body alone — no clamp, no toggle", () => {
        stubHeight(40)
        const {container} = render(
            <CollapsibleMessageBody stateKey="m2::body">
                <p>hi</p>
            </CollapsibleMessageBody>,
        )

        expect(region(container).style.maxHeight).toBe("40px")
        expect(screen.queryByRole("button")).toBeNull()
    })

    it("keeps an expanded message expanded when its row remounts", () => {
        stubHeight(COLLAPSED_MESSAGE_MAX_PX * 4)
        const body = (
            <CollapsibleMessageBody stateKey="m3::body">
                <p>a very long pasted message</p>
            </CollapsibleMessageBody>
        )
        const first = render(body)
        fireEvent.click(screen.getByRole("button", {name: "Show more"}))
        // The windowed transcript unmounts a row that scrolls out of view; the expand state is
        // keyed and persisted precisely so scrolling back does not re-collapse it.
        first.unmount()

        const {container} = render(body)

        expect(region(container).style.maxHeight).toBe(`${COLLAPSED_MESSAGE_MAX_PX * 4}px`)
        expect(screen.getByRole("button", {name: "Show less"})).toBeTruthy()
    })
})
