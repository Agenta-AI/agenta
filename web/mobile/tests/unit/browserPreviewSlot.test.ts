import {describe, expect, it} from "vitest"

import {showBrowserPreview} from "@/features/chat/BrowserPreviewSlot"

const working = {working: true, running: true, waiting: "", paneOpen: false}

describe("showBrowserPreview", () => {
    it("shows while the agent works in a running browser", () => {
        expect(showBrowserPreview(working)).toBe(true)
    })

    it("goes away when the answer arrives", () => {
        expect(showBrowserPreview({...working, working: false})).toBe(false)
    })

    it("gives way to the pane and to the agent's ask", () => {
        expect(showBrowserPreview({...working, paneOpen: true})).toBe(false)
        expect(showBrowserPreview({...working, waiting: "Sign in"})).toBe(false)
    })

    it("needs a running browser", () => {
        expect(showBrowserPreview({...working, running: false})).toBe(false)
    })
})
