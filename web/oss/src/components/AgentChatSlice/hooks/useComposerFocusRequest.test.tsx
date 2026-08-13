/**
 * The composer-focus request consumer.
 *
 * The rule under test is the one that isn't obvious from reading the hook: the nonce is claimed
 * INSIDE the animation frame. Claiming it in the effect body — the shorter, more natural-looking
 * form, and what this code did originally — makes StrictMode's mount replay swallow the focus, so
 * a first-visit Alt+N never lands the caret. That regression is dev-only and silent.
 */
import {act, StrictMode, createElement, useRef, type ReactNode} from "react"

import {type RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {getDefaultStore} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

import {AgentChatScopeProvider} from "../state/scope"
import {focusComposerRequestAtom} from "../state/uiRequests"

import {useComposerFocusRequest} from "./useComposerFocusRequest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const SCOPE = "app-1"
const SESSION = "session-1"
const store = getDefaultStore()

let root: Root | null = null

const focus = vi.fn()

/** Mounts a probe holding a stub composer handle, under `scopeKey`. */
const mount = (sessionId: string, scopeKey: string, strict: boolean) => {
    const Probe = () => {
        const ref = useRef<RichChatInputHandle | null>({focus} as RichChatInputHandle)
        useComposerFocusRequest(sessionId, ref)
        return null
    }
    const tree: ReactNode = createElement(AgentChatScopeProvider, {scopeKey}, createElement(Probe))
    const host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    act(() => {
        root?.render(strict ? createElement(StrictMode, null, tree) : tree)
    })
}

/** Resolves after the frame our hook queued has run. */
const nextFrame = () => act(() => new Promise((resolve) => requestAnimationFrame(() => resolve())))

afterEach(() => {
    act(() => root?.unmount())
    root = null
    store.set(focusComposerRequestAtom, null)
    focus.mockClear()
    document.body.innerHTML = ""
})

describe("useComposerFocusRequest", () => {
    it("focuses the composer once for a request that names this session", async () => {
        store.set(focusComposerRequestAtom, {scope: SCOPE, sessionId: SESSION, nonce: 1})
        mount(SESSION, SCOPE, false)
        await nextFrame()
        expect(focus).toHaveBeenCalledTimes(1)
    })

    it("focuses exactly once under StrictMode's mount replay", async () => {
        store.set(focusComposerRequestAtom, {scope: SCOPE, sessionId: SESSION, nonce: 1})
        mount(SESSION, SCOPE, true)
        await nextFrame()
        // Zero here is the regression: the replay's cleanup/re-run must not eat the only frame.
        expect(focus).toHaveBeenCalledTimes(1)
    })

    it("ignores a request for another session", async () => {
        store.set(focusComposerRequestAtom, {scope: SCOPE, sessionId: "other", nonce: 1})
        mount(SESSION, SCOPE, false)
        await nextFrame()
        expect(focus).not.toHaveBeenCalled()
    })

    it("ignores a request from another scope, even for the same session id", async () => {
        store.set(focusComposerRequestAtom, {
            scope: "drawer:app-1",
            sessionId: SESSION,
            nonce: 1,
        })
        mount(SESSION, SCOPE, false)
        await nextFrame()
        expect(focus).not.toHaveBeenCalled()
    })

    it("re-focuses on a fresh nonce but not on a repeated one", async () => {
        store.set(focusComposerRequestAtom, {scope: SCOPE, sessionId: SESSION, nonce: 1})
        mount(SESSION, SCOPE, false)
        await nextFrame()

        act(() => {
            store.set(focusComposerRequestAtom, {scope: SCOPE, sessionId: SESSION, nonce: 1})
        })
        await nextFrame()
        expect(focus).toHaveBeenCalledTimes(1)

        act(() => {
            store.set(focusComposerRequestAtom, {scope: SCOPE, sessionId: SESSION, nonce: 2})
        })
        await nextFrame()
        expect(focus).toHaveBeenCalledTimes(2)
    })
})
