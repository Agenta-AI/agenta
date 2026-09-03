/** The parked first turn states why it hasn't run and offers the way out. */
import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it} from "vitest"

import ConnectModelCallout from "./ConnectModelCallout"

const text = (node: Parameters<typeof renderToStaticMarkup>[0]): string => {
    const host = document.createElement("div")
    host.innerHTML = renderToStaticMarkup(node)
    return (host.textContent ?? "").replace(/\s+/g, " ").trim()
}

describe("ConnectModelCallout", () => {
    it("names the missing key as the reason and offers the provider drawer", () => {
        const rendered = text(<ConnectModelCallout />)

        expect(rendered).toContain("This agent needs a model provider key")
        expect(rendered).toContain("Set up model providers")
    })

    it("says the message is held, not lost", () => {
        expect(text(<ConnectModelCallout />)).toContain("Your message is waiting")
    })
})
