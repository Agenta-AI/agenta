/**
 * The phone cases are the load-bearing ones. On a phone the pane replaces the conversation, so
 * every rule that turns the pane on also takes the composer off the screen. Both defects this
 * file guards did exactly that: the config pane opened by default, and the maximized flag the
 * desktop stores under the same origin put the sessions rail where the chat belongs.
 */
import {describe, expect, it} from "vitest"

import {endPaneToClose, resolveSessionPanes} from "@/features/chat/sessionPanes"

const phone = {
    twoPane: false,
    hasEntity: true,
    chatMaximized: false,
    configCollapsed: true,
    endPaneOpen: false,
}

describe("resolveSessionPanes on a phone", () => {
    it("shows the conversation when the config pane is collapsed", () => {
        expect(resolveSessionPanes(phone)).toEqual({
            showConfig: false,
            showPane: false,
            showEndPane: false,
        })
    })

    it("shows the configuration once the reader asks for it", () => {
        expect(resolveSessionPanes({...phone, configCollapsed: false})).toEqual({
            showConfig: true,
            showPane: true,
            showEndPane: false,
        })
    })

    it("keeps the conversation in maximized mode instead of the sessions rail", () => {
        expect(resolveSessionPanes({...phone, chatMaximized: true})).toEqual({
            showConfig: false,
            showPane: false,
            showEndPane: false,
        })
    })

    it("shows the conversation when there is no revision to configure yet", () => {
        expect(resolveSessionPanes({...phone, configCollapsed: false, hasEntity: false})).toEqual({
            showConfig: false,
            showPane: false,
            showEndPane: false,
        })
    })
})

describe("resolveSessionPanes on a phone with the Files pane open", () => {
    it("gives Files the screen in place of the conversation", () => {
        expect(resolveSessionPanes({...phone, endPaneOpen: true})).toEqual({
            showConfig: false,
            showPane: false,
            showEndPane: true,
        })
    })

    it("outranks the configuration, which comes back once Files closes", () => {
        const withConfig = {...phone, configCollapsed: false}
        expect(resolveSessionPanes({...withConfig, endPaneOpen: true})).toEqual({
            showConfig: false,
            showPane: false,
            showEndPane: true,
        })
        expect(resolveSessionPanes(withConfig).showConfig).toBe(true)
    })
})

describe("resolveSessionPanes with the Files pane expanded", () => {
    it("covers Settings and the sessions rail only while files are open", () => {
        for (const chatMaximized of [true, false]) {
            expect(
                resolveSessionPanes({
                    ...phone,
                    twoPane: true,
                    configCollapsed: false,
                    endPaneOpen: true,
                    filesExpanded: true,
                    chatMaximized,
                }),
            ).toEqual({showConfig: false, showPane: false, showEndPane: true})
        }
        expect(
            resolveSessionPanes({
                ...phone,
                twoPane: true,
                configCollapsed: false,
                filesExpanded: true,
            }),
        ).toEqual({showConfig: true, showPane: true, showEndPane: false})
    })
    it("brings Settings back beside Files when the expansion ends", () => {
        expect(
            resolveSessionPanes({
                ...phone,
                twoPane: true,
                configCollapsed: false,
                endPaneOpen: true,
                filesExpanded: false,
            }),
        ).toEqual({showConfig: true, showPane: true, showEndPane: true})
    })
    it("restores at the current breakpoint, keeping a collapsed Settings pane collapsed", () => {
        expect(resolveSessionPanes({...phone, endPaneOpen: true, filesExpanded: false})).toEqual({
            showConfig: false,
            showPane: false,
            showEndPane: true,
        })
        expect(
            resolveSessionPanes({...phone, twoPane: true, endPaneOpen: true, filesExpanded: false}),
        ).toEqual({showConfig: false, showPane: false, showEndPane: true})
    })
})

describe("resolveSessionPanes with two panes", () => {
    it("shows Files beside the configuration, not instead of it", () => {
        expect(
            resolveSessionPanes({
                ...phone,
                twoPane: true,
                configCollapsed: false,
                endPaneOpen: true,
            }),
        ).toEqual({showConfig: true, showPane: true, showEndPane: true})
    })

    it("keeps the desktop swap: the sessions rail stands in for the config panel", () => {
        expect(resolveSessionPanes({...phone, twoPane: true, chatMaximized: true})).toEqual({
            showConfig: false,
            showPane: true,
            showEndPane: false,
        })
    })

    it("shows the configuration beside the conversation by default", () => {
        expect(resolveSessionPanes({...phone, twoPane: true, configCollapsed: false})).toEqual({
            showConfig: true,
            showPane: true,
            showEndPane: false,
        })
    })
})

describe("endPaneToClose", () => {
    const both = {files: true, browser: true}

    it("keeps the pane opened last when both end up open", () => {
        expect(endPaneToClose({files: true, browser: false}, both)).toBe("files")
        expect(endPaneToClose({files: false, browser: true}, both)).toBe("browser")
    })

    it("lets the browser win when both open at once", () => {
        expect(endPaneToClose({files: false, browser: false}, both)).toBe("files")
    })

    it("closes nothing while one pane or none is open", () => {
        expect(endPaneToClose(both, {files: true, browser: false})).toBeNull()
        expect(endPaneToClose(both, {files: false, browser: false})).toBeNull()
    })
})
