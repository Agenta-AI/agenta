/**
 * The startup label's rendered output (#6047): the point of the change is that the slot uses WORDS,
 * so the assertions are that the label reaches the DOM and is announced.
 *
 * `renderToStaticMarkup` rather than a testing library — the repo has no `@testing-library/react`,
 * and `StartupActivity` is presentational so a static render covers it.
 */
import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it} from "vitest"

import {StartupActivity} from "../../src/components/TurnActivity"

const render = (node: Parameters<typeof renderToStaticMarkup>[0]) => {
    const host = document.createElement("div")
    host.innerHTML = renderToStaticMarkup(node)
    return host
}

describe("StartupActivity", () => {
    it("shows the phase label as text", () => {
        const host = render(<StartupActivity label="Working" />)
        expect((host.textContent ?? "").trim()).toBe("Working")
    })

    it("announces phase changes to assistive tech", () => {
        const status = render(<StartupActivity label="Starting the agent" />).querySelector(
            "[role='status']",
        )
        expect(status).not.toBeNull()
        expect(status?.getAttribute("aria-live")).toBe("polite")
    })

    it("never renders an elapsed count — the issue rules that treatment out", () => {
        const host = render(<StartupActivity label="Almost ready" />)
        expect(host.textContent ?? "").not.toMatch(/\d/)
    })

    it("hides the decorative dots from the announcement", () => {
        const dots = render(<StartupActivity label="Working" />).querySelector("[aria-hidden]")
        expect(dots).not.toBeNull()
    })
})
