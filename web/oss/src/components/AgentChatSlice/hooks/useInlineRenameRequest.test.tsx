/**
 * The inline-rename request consumer.
 *
 * Two rules that read like accidents but aren't. (1) Only the surface currently on screen opens its
 * editor — the strip and the rail are both mounted once the rail has been opened, and two
 * `autoFocus` inputs would race. (2) The hidden surface still CLAIMS the nonce, so maximizing later
 * can't replay a stale request into an editor the user never asked for.
 */
import {act, createElement, useRef, type ReactNode} from "react"

import {getDefaultStore} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

import type {SessionTabLabelHandle} from "../components/SessionTabLabel"
import {chatPanelMaximizedAtom} from "../state/panelLayout"
import {AgentChatScopeProvider} from "../state/scope"
import {renameSessionRequestAtom} from "../state/uiRequests"

import {useInlineRenameRequest} from "./useInlineRenameRequest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const SCOPE = "app-1"
const SESSION = "session-1"
const store = getDefaultStore()

let root: Root | null = null

const startEditing = vi.fn()

const mount = (surface: "strip" | "rail", scopeKey = SCOPE, sessionId = SESSION) => {
    const Probe = () => {
        const ref = useRef<SessionTabLabelHandle | null>({startEditing})
        useInlineRenameRequest(sessionId, ref, surface)
        return null
    }
    const tree: ReactNode = createElement(AgentChatScopeProvider, {scopeKey}, createElement(Probe))
    const host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    act(() => {
        root?.render(tree)
    })
}

const request = (nonce: number, scope = SCOPE, sessionId = SESSION) =>
    act(() => {
        store.set(renameSessionRequestAtom, {scope, sessionId, nonce})
    })

afterEach(() => {
    act(() => root?.unmount())
    root = null
    store.set(renameSessionRequestAtom, null)
    store.set(chatPanelMaximizedAtom, false)
    startEditing.mockClear()
    document.body.innerHTML = ""
})

describe("useInlineRenameRequest", () => {
    it("opens the editor on the strip while the chat is not maximized", () => {
        mount("strip")
        request(1)
        expect(startEditing).toHaveBeenCalledTimes(1)
    })

    it("opens it on the rail instead once the chat is maximized", () => {
        store.set(chatPanelMaximizedAtom, true)
        mount("rail")
        request(1)
        expect(startEditing).toHaveBeenCalledTimes(1)
    })

    it("stays shut on the surface that is off screen", () => {
        mount("rail") // rail is off screen while not maximized
        request(1)
        expect(startEditing).not.toHaveBeenCalled()
    })

    it("does not replay a request the hidden surface already consumed", () => {
        mount("rail")
        request(1)
        expect(startEditing).not.toHaveBeenCalled()
        // Maximizing makes this surface visible; the old request must not spring open now.
        act(() => {
            store.set(chatPanelMaximizedAtom, true)
        })
        expect(startEditing).not.toHaveBeenCalled()
    })

    it("ignores requests for another session or another scope", () => {
        mount("strip")
        request(1, SCOPE, "other-session")
        request(2, "drawer:app-1", SESSION)
        expect(startEditing).not.toHaveBeenCalled()
    })

    it("opens again on a fresh nonce but not on a repeated one", () => {
        mount("strip")
        request(1)
        request(1)
        expect(startEditing).toHaveBeenCalledTimes(1)
        request(2)
        expect(startEditing).toHaveBeenCalledTimes(2)
    })
})
