// @vitest-environment jsdom
/**
 * Save as template on /m sends the same request as the /w playground header, as the CURRENT
 * session's pending task. The conversation sends a pending task once, like a typed message, and
 * never through the composer, so one tap is one visible user message and the unsent draft stays.
 */
import {act, createElement} from "react"

import {composerDraftBySession, setSessionStatusAtom} from "@agenta/chat/state"
import {SAVE_AS_TEMPLATE_MESSAGE} from "@agenta/entities/workflow"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it} from "vitest"

import {SaveAsTemplateButton} from "../../src/features/chat/SaveAsTemplateButton"
import {pendingTasksAtom, takePendingTaskAtom} from "../../src/features/home/pendingTask"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const AGENT = "agent-1"
const SESSION = "session-with-draft"

let store: ReturnType<typeof createStore>
let root: Root | null = null
let host: HTMLDivElement | null = null

const mount = () => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    act(() => {
        root?.render(
            createElement(
                Provider,
                {store},
                createElement(SaveAsTemplateButton, {agentId: AGENT, sessionId: SESSION}),
            ),
        )
    })
}

const button = () =>
    host?.querySelector<HTMLButtonElement>('[data-testid="save-as-template-button"]') ?? null

beforeEach(() => {
    store = createStore()
})

afterEach(() => {
    act(() => {
        root?.unmount()
        host?.remove()
    })
    root = null
    host = null
    composerDraftBySession.delete(SESSION)
})

describe("SaveAsTemplateButton (/m)", () => {
    it("parks the shared export request as the current session's one pending task", () => {
        mount()
        act(() => button()?.click())

        expect(store.get(pendingTasksAtom)).toEqual({
            [SESSION]: {agentId: AGENT, text: SAVE_AS_TEMPLATE_MESSAGE},
        })
        expect(button()?.disabled).toBe(true)
    })

    it("parks one request when a double tap lands before the re-render", () => {
        mount()
        act(() => {
            button()?.click()
            button()?.click()
        })

        expect(Object.keys(store.get(pendingTasksAtom))).toEqual([SESSION])
    })

    it("leaves the unsent composer draft unchanged", () => {
        composerDraftBySession.set(SESSION, "half-written question")
        mount()
        act(() => button()?.click())

        expect(composerDraftBySession.get(SESSION)).toBe("half-written question")
    })

    it("sends nothing while the agent is running", () => {
        store.set(setSessionStatusAtom, {id: SESSION, status: "running"})
        mount()
        expect(button()?.disabled).toBe(true)
        act(() => button()?.click())

        expect(store.get(pendingTasksAtom)).toEqual({})
    })

    it("is available again once the conversation took the request", () => {
        mount()
        act(() => button()?.click())
        act(() => {
            store.set(takePendingTaskAtom, SESSION)
        })

        expect(button()?.disabled).toBe(false)
    })
})
