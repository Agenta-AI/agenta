/** The Add your key action appears only for starter-credit failures the user can clear. */
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

    it("offers Try again for a transient credential-delivery failure", () => {
        const rendered = text(
            <RunErrorBody
                text="A temporary issue kept this run's credentials from reaching the model."
                stateKey="turn-3"
                code="credential_delivery_failed"
                onRetry={() => undefined}
            />,
        )

        expect(rendered).toContain("Try again")
        expect(rendered).not.toContain("Add your key")
    })

    it("hides Try again when no retry handler is wired (not the last turn, or busy)", () => {
        const rendered = text(
            <RunErrorBody
                text="A temporary issue."
                stateKey="turn-4"
                code="credential_delivery_failed"
            />,
        )

        expect(rendered).not.toContain("Try again")
    })

    it("does not offer Try again for a non-transient failure", () => {
        const rendered = text(
            <RunErrorBody
                text="model authentication failed"
                stateKey="turn-5"
                code="runner_error"
                onRetry={() => undefined}
            />,
        )

        expect(rendered).not.toContain("Try again")
    })
})
