/**
 * Unit tests for the inline-rename consumer. The shortcut hook itself moved to `@agenta/ui`; what
 * stays here is the app-layer glue that turns its rename request into a focused tab label.
 */
import {act, createElement, useRef} from "react"

import {chatPanelMaximizedAtom} from "@agenta/chat/state"
import {getDefaultStore} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

import type {SessionTabLabelHandle} from "../components/SessionTabLabel"
import {AgentChatScopeProvider} from "../state/scope"
import {renameSessionRequestAtom} from "../state/uiRequests"

import {useInlineRenameRequest} from "./useInlineRenameRequest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
    if (root && host) {
        act(() => {
            root?.unmount()
            host?.remove()
        })
    }
    root = null
    host = null
})

/**
 * The rename request reaches two mounted rows for one session (the strip chip and the rail row),
 * so only the one on screen may open its editor. The hidden one still claims the nonce, or
 * maximizing later would replay a stale request.
 */
describe("useInlineRenameRequest", () => {
    const SCOPE = "app-1"
    const store = getDefaultStore()
    let renameRoot: Root | null = null
    const startEditing = vi.fn()

    const mountRow = (surface: "strip" | "rail") => {
        const Row = () => {
            const ref = useRef<SessionTabLabelHandle | null>({startEditing})
            useInlineRenameRequest("s1", ref, surface)
            return null
        }
        const host = document.createElement("div")
        document.body.append(host)
        renameRoot = createRoot(host)
        act(() => {
            renameRoot?.render(
                createElement(AgentChatScopeProvider, {scopeKey: SCOPE}, createElement(Row)),
            )
        })
    }
    const requestRename = (nonce: number, scope = SCOPE) =>
        act(() => {
            store.set(renameSessionRequestAtom, {scope, sessionId: "s1", nonce})
        })

    afterEach(() => {
        act(() => renameRoot?.unmount())
        renameRoot = null
        store.set(renameSessionRequestAtom, null)
        store.set(chatPanelMaximizedAtom, false)
        startEditing.mockClear()
    })

    it("opens the editor on the surface that is on screen", () => {
        mountRow("strip")
        requestRename(1)
        expect(startEditing).toHaveBeenCalledTimes(1)
    })

    it("stays shut on the off-screen surface, and does not replay when it becomes visible", () => {
        mountRow("rail") // off screen while the chat is not maximized
        requestRename(1)
        act(() => {
            store.set(chatPanelMaximizedAtom, true)
        })
        expect(startEditing).not.toHaveBeenCalled()
    })

    it("ignores another scope's request for the same session id", () => {
        mountRow("strip")
        requestRename(1, "drawer:app-1")
        expect(startEditing).not.toHaveBeenCalled()
    })
})
