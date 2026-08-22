/**
 * The failed-run callout's one conditional affordance: the "Add your key" button.
 *
 * It appears only for the starter-credit failure classes the user can clear themselves. Every
 * other failure (including a run that carried no code at all) shows the message and nothing more,
 * so a plain crash never nags the user to go buy a provider key.
 *
 * Rendered with `renderToStaticMarkup` rather than a testing library: the repo has no
 * `@testing-library/react`, and these are static presentational assertions that do not need one.
 */
import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it} from "vitest"

import {RunErrorBody} from "./AgentMessage"

const text = (node: Parameters<typeof renderToStaticMarkup>[0]): string => {
    const host = document.createElement("div")
    host.innerHTML = renderToStaticMarkup(node)
    return (host.textContent ?? "").replace(/\s+/g, " ").trim()
}

describe("RunErrorBody", () => {
    it("offers the own-key escape hatch when the run ran out of starter credits", () => {
        const rendered = text(
            <RunErrorBody
                text="Out of starter credits."
                stateKey="turn-1"
                code="starter_credits_exhausted"
            />,
        )

        expect(rendered).toContain("Out of starter credits.")
        expect(rendered).toContain("Add your key")
    })

    it("shows only the message when the failure carried no code", () => {
        const rendered = text(<RunErrorBody text="Something broke." stateKey="turn-2" />)

        expect(rendered).toContain("Something broke.")
        expect(rendered).not.toContain("Add your key")
    })
})
