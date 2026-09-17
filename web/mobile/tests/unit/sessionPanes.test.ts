/**
 * The phone cases are the load-bearing ones. On a phone the pane replaces the conversation, so
 * every rule that turns the pane on also takes the composer off the screen. Both defects this
 * file guards did exactly that: the config pane opened by default, and the maximized flag the
 * desktop stores under the same origin put the sessions rail where the chat belongs.
 */
import {describe, expect, it} from "vitest"

import {conversationHidden, resolveSessionPanes} from "@/features/chat/sessionPanes"

const phone = {twoPane: false, hasEntity: true, chatMaximized: false, configCollapsed: true}

describe("resolveSessionPanes on a phone", () => {
    it("shows the conversation when the config pane is collapsed", () => {
        expect(resolveSessionPanes(phone)).toEqual({showConfig: false, showPane: false})
    })

    it("shows the configuration once the reader asks for it", () => {
        expect(resolveSessionPanes({...phone, configCollapsed: false})).toEqual({
            showConfig: true,
            showPane: true,
        })
    })

    it("keeps the conversation in maximized mode instead of the sessions rail", () => {
        expect(resolveSessionPanes({...phone, chatMaximized: true})).toEqual({
            showConfig: false,
            showPane: false,
        })
    })

    it("shows the conversation when there is no revision to configure yet", () => {
        expect(resolveSessionPanes({...phone, configCollapsed: false, hasEntity: false})).toEqual({
            showConfig: false,
            showPane: false,
        })
    })
})

describe("conversationHidden", () => {
    it("takes the conversation off a phone only when the pane has the screen", () => {
        expect(conversationHidden({twoPane: false, showPane: true})).toBe(true)
        expect(conversationHidden({twoPane: false, showPane: false})).toBe(false)
    })

    it("never takes it off a window wide enough for both", () => {
        // The pane sits BESIDE the conversation above the breakpoint, so an open pane is not a
        // hidden chat there. Dropping the width half of the rule hides it at every width.
        expect(conversationHidden({twoPane: true, showPane: true})).toBe(false)
        expect(conversationHidden({twoPane: true, showPane: false})).toBe(false)
    })
})

describe("resolveSessionPanes with two panes", () => {
    it("keeps the desktop swap: the sessions rail stands in for the config panel", () => {
        expect(resolveSessionPanes({...phone, twoPane: true, chatMaximized: true})).toEqual({
            showConfig: false,
            showPane: true,
        })
    })

    it("shows the configuration beside the conversation by default", () => {
        expect(resolveSessionPanes({...phone, twoPane: true, configCollapsed: false})).toEqual({
            showConfig: true,
            showPane: true,
        })
    })
})
