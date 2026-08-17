/**
 * The startup label's rendered output (#6047).
 *
 * The point of the whole change is that the cold-start slot uses WORDS — the wordless three dots
 * were what made a 15s sandbox boot read as a stalled session. So the assertions are that the
 * label reaches the DOM and that it is announced.
 *
 * Rendered with `renderToStaticMarkup` rather than a testing library: the repo has no
 * `@testing-library/react`, and `StartupActivity` is deliberately presentational (its label is
 * chosen by `useStartupPhase`, tested separately) so a static render covers it.
 */
import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it} from "vitest"

import {StartupActivity} from "./TurnActivity"

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

    it("keeps the shimmer behind motion-safe so reduced motion gets plain text", () => {
        const html = renderToStaticMarkup(<StartupActivity label="Working" />)
        expect(html).toContain("motion-safe:animate-text-shimmer")
        // The transparent fill rides the same guard — without it, reduced motion would render a
        // frozen gradient clip and the label could come out invisible.
        expect(html).toContain("motion-safe:text-transparent")
    })
})
