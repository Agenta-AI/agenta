// @vitest-environment jsdom
import {cleanup, render} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {Progress} from "../../src/components/ui/progress"

/**
 * The status glyphs come from Phosphor, not @ant-design/icons, so the presentational barrel does
 * not drag antd icons into the mobile trace drawer chunk. Each status keeps one svg glyph sized
 * to the info font (1em), and the circle ring keeps its 1.2em glyph.
 */
afterEach(cleanup)

const glyph = (container: HTMLElement, slot: string) =>
    container.querySelector(`[data-slot="${slot}"] svg`)

describe("Progress status glyphs", () => {
    it.each([
        ["success", 100],
        ["exception", 70],
    ] as const)("line %s renders one svg glyph and no antd icon", (status, percent) => {
        const {container} = render(<Progress percent={percent} status={status} />)
        expect(container.querySelectorAll('[data-slot="progress-text"] svg')).toHaveLength(1)
        expect(container.querySelector(".anticon")).toBeNull()
        expect(glyph(container, "progress-text")?.getAttribute("width")).toBe("1em")
    })

    it.each([
        ["success", 100],
        ["exception", 70],
    ] as const)("circle %s renders one svg glyph and no antd icon", (status, percent) => {
        const {container} = render(
            <Progress type="circle" size={60} percent={percent} status={status} />,
        )
        expect(container.querySelectorAll('[data-slot="progress-circle-text"] svg')).toHaveLength(1)
        expect(container.querySelector(".anticon")).toBeNull()
    })

    it("centres the circle glyph at 1.2em whether or not the page resets svg display", () => {
        const {container} = render(<Progress type="circle" size={60} percent={100} />)
        const className = container.querySelector('[data-slot="progress-circle-text"]')?.className
        expect(className).toContain("[&_svg]:mx-auto")
        expect(className).toContain("[&_svg]:block")
        expect(className).toContain("[&_svg]:size-[1.2em]")
    })

    it("shows the percent text when no status icon applies", () => {
        const {container} = render(<Progress percent={30} />)
        expect(container.querySelector('[data-slot="progress-text"]')?.textContent).toBe("30%")
        expect(glyph(container, "progress-text")).toBeNull()
    })
})
