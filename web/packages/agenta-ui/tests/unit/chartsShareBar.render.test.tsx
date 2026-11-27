// @vitest-environment jsdom
import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {ShareBar} from "../../src/components/presentational/charts"

afterEach(cleanup)

const segment = (container: HTMLElement, key: string) =>
    container.querySelector<HTMLElement>(`[data-segment="${key}"]`)

describe("ShareBar", () => {
    it("Share bar draws one segment per share with its width, color and tooltip", () => {
        const {container} = render(
            <ShareBar
                title="63 passed, 5 failed"
                segments={[
                    {key: "passed", share: 63 / 68, color: "var(--success)"},
                    {key: "failed", share: 5 / 68, color: "var(--destructive)", title: "5 failed"},
                ]}
            />,
        )

        expect(screen.getByRole("img", {name: "63 passed, 5 failed"}).getAttribute("title")).toBe(
            "63 passed, 5 failed",
        )
        expect(segment(container, "passed")?.style.width).toBe(`${(63 / 68) * 100}%`)
        expect(segment(container, "passed")?.style.background).toBe("var(--success)")
        expect(segment(container, "failed")?.getAttribute("title")).toBe("5 failed")
    })

    it("Share bar leaves out empty segments and caps a share at the full width", () => {
        const {container} = render(
            <ShareBar
                label="Tone"
                segments={[
                    {key: "a", share: 1.5, color: "var(--data-1)"},
                    {key: "b", share: 0, color: "var(--data-2)"},
                ]}
            />,
        )

        expect(segment(container, "a")?.style.width).toBe("100%")
        expect(segment(container, "b")).toBeNull()
    })
    it("Share bar draws a striped segment for a part with no value", () => {
        const {container} = render(
            <ShareBar
                label="success"
                segments={[{key: "none", share: 0.2, color: "var(--border-strong)", striped: true}]}
            />,
        )

        expect(segment(container, "none")?.style.background).toContain("repeating-linear-gradient")
    })
})
