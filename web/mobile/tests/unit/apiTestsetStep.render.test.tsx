// @vitest-environment jsdom
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it} from "vitest"

import {ApiTestsetStep} from "@/features/testsets/create/ApiTestsetStep"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

describe("API step of the create dialog", () => {
    let root: Root
    let host: HTMLDivElement

    beforeEach(() => {
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
        act(() => root.render(<ApiTestsetStep onClose={() => undefined} />))
    })
    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    const snippet = () => host.querySelector('[data-testid="testset-api-snippet"]')!.textContent
    const click = (label: string) =>
        act(async () =>
            Array.from(host.querySelectorAll("button, [role='radio']"))
                .find((item) => item.textContent === label)
                ?.dispatchEvent(new MouseEvent("click", {bubbles: true})),
        )

    it("Starts with the CSV upload request in Python", () => {
        expect(snippet()).toContain("/simple/testsets/upload")
        expect(snippet()).toContain("ApiKey YOUR_API_KEY")
        expect(snippet()).toContain("import requests")
    })

    it("JSON shows the create request, and cURL changes the language", async () => {
        await click("JSON")
        expect(snippet()).toContain("your-testset-slug")
        await click("cURL")
        expect(snippet()).toContain("curl -X POST")
        expect(host.querySelector('a[href*="create-programatically"]')).not.toBeNull()
    })
})
