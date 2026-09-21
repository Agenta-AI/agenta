/**
 * The phone cases are the load-bearing ones. On a phone the pane replaces the conversation, so
 * every rule that turns the pane on also takes the composer off the screen. Both defects this
 * file guards did exactly that: the config pane opened by default, and the maximized flag the
 * desktop stores under the same origin put the sessions rail where the chat belongs.
 */
import {describe, expect, it} from "vitest"

import {resolveSessionPanes} from "@/features/chat/sessionPanes"

const phone = {
    twoPane: false,
    hasEntity: true,
    chatMaximized: false,
    configCollapsed: true,
    filesOpen: false,
}

describe("resolveSessionPanes on a phone", () => {
    it("shows the conversation when the config pane is collapsed", () => {
        expect(resolveSessionPanes(phone)).toEqual({
            showConfig: false,
            showPane: false,
            showFiles: false,
        })
    })

    it("shows the configuration once the reader asks for it", () => {
        expect(resolveSessionPanes({...phone, configCollapsed: false})).toEqual({
            showConfig: true,
            showPane: true,
            showFiles: false,
        })
    })

    it("keeps the conversation in maximized mode instead of the sessions rail", () => {
        expect(resolveSessionPanes({...phone, chatMaximized: true})).toEqual({
            showConfig: false,
            showPane: false,
            showFiles: false,
        })
    })

    it("shows the conversation when there is no revision to configure yet", () => {
        expect(resolveSessionPanes({...phone, configCollapsed: false, hasEntity: false})).toEqual({
            showConfig: false,
            showPane: false,
            showFiles: false,
        })
    })
})

describe("resolveSessionPanes on a phone with the Files pane open", () => {
    it("gives Files the screen in place of the conversation", () => {
        expect(resolveSessionPanes({...phone, filesOpen: true})).toEqual({
            showConfig: false,
            showPane: false,
            showFiles: true,
        })
    })

    it("outranks the configuration, which comes back once Files closes", () => {
        const withConfig = {...phone, configCollapsed: false}
        expect(resolveSessionPanes({...withConfig, filesOpen: true})).toEqual({
            showConfig: false,
            showPane: false,
            showFiles: true,
        })
        expect(resolveSessionPanes(withConfig).showConfig).toBe(true)
    })
})

describe("resolveSessionPanes with two panes", () => {
    it("shows Files beside the configuration, not instead of it", () => {
        expect(
            resolveSessionPanes({...phone, twoPane: true, configCollapsed: false, filesOpen: true}),
        ).toEqual({showConfig: true, showPane: true, showFiles: true})
    })

    it("keeps the desktop swap: the sessions rail stands in for the config panel", () => {
        expect(resolveSessionPanes({...phone, twoPane: true, chatMaximized: true})).toEqual({
            showConfig: false,
            showPane: true,
            showFiles: false,
        })
    })

    it("shows the configuration beside the conversation by default", () => {
        expect(resolveSessionPanes({...phone, twoPane: true, configCollapsed: false})).toEqual({
            showConfig: true,
            showPane: true,
            showFiles: false,
        })
    })
})
