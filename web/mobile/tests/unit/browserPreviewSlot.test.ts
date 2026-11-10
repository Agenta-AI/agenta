import {describe, expect, it} from "vitest"

import {showBrowserPreview} from "@/features/chat/BrowserPreviewSlot"
import {browserPollMs} from "@/features/chat/useBrowserStatusPoll"

const working = {working: true, running: true, waitReason: "", paneOpen: false}

describe("showBrowserPreview", () => {
    it("shows while the agent works in a running browser", () => {
        expect(showBrowserPreview(working)).toBe(true)
    })

    it("goes away when the answer arrives", () => {
        expect(showBrowserPreview({...working, working: false})).toBe(false)
    })

    it("gives way to the pane and to the agent's ask", () => {
        expect(showBrowserPreview({...working, paneOpen: true})).toBe(false)
        expect(showBrowserPreview({...working, waitReason: "Sign in"})).toBe(false)
    })

    it("needs a running browser", () => {
        expect(showBrowserPreview({...working, running: false})).toBe(false)
    })
})

describe("browserPollMs", () => {
    it("polls while this conversation's turn runs, even before a browser starts", () => {
        expect(browserPollMs(true, false)).toBe(10_000)
        expect(browserPollMs(true, true)).toBe(4_000)
    })

    it("polls slowly for a browser left running, and not at all when idle", () => {
        expect(browserPollMs(false, true)).toBe(30_000)
        expect(browserPollMs(false, false)).toBeNull()
    })
})
