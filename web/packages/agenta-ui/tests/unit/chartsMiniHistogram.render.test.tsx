// @vitest-environment jsdom
import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {MiniHistogram} from "../../src/components/presentational/charts"

afterEach(cleanup)

const heightOf = (container: HTMLElement, key: string) =>
    container.querySelector<HTMLElement>(`[data-bar="${key}"] > div`)?.style.height

describe("MiniHistogram", () => {
    it("Mini histogram draws the bars it gets, with the two axis ends and the tooltips", () => {
        const {container} = render(
            <MiniHistogram
                label="score"
                start="0"
                end="1"
                bars={[
                    {key: "0", share: 0},
                    {key: "4", share: 0.5, title: "0.4 to 0.5: 1 of 2 test cases"},
                    {key: "9", share: 0.5},
                ]}
            />,
        )

        const chart = screen.getByRole("img", {name: "score"})
        expect(chart.textContent).toBe("01")
        expect(container.querySelectorAll("[data-bar]")).toHaveLength(3)
        expect(heightOf(container, "0")).toBe("0%")
        expect(heightOf(container, "4")).toBe("50%")
        expect(container.querySelector('[data-bar="4"]')?.getAttribute("title")).toBe(
            "0.4 to 0.5: 1 of 2 test cases",
        )
    })

    it("Mini histogram keeps a small count visible and never draws over the top", () => {
        const {container} = render(
            <MiniHistogram
                label="score"
                start="1"
                end="5"
                bars={[
                    {key: "a", share: 0.01},
                    {key: "b", share: 1.2},
                ]}
            />,
        )

        expect(heightOf(container, "a")).toBe("6%")
        expect(heightOf(container, "b")).toBe("100%")
    })
})
