// @vitest-environment jsdom
import {buildTurnViewModels, createExecutedToolIdentityCache} from "@agenta/chat/model"
import {activeUserIdAtom, playgroundInspectorEnabledAtom} from "@agenta/shared/state"
import type {UIMessage} from "ai"
import {createStore, Provider} from "jotai"
import {flushSync} from "react-dom"
import {createRoot} from "react-dom/client"
import {afterEach, describe, expect, it} from "vitest"

import {TurnRow} from "@/features/chat/TurnRow"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let root: ReturnType<typeof createRoot> | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
    if (root) flushSync(() => root!.unmount())
    root = undefined
    host?.remove()
    host = undefined
    localStorage.clear()
})

const renderAssistantTurn = (inspectorEnabled: boolean) => {
    const message = {
        id: "assistant-1",
        role: "assistant",
        parts: [{type: "text", text: "Done"}],
        metadata: {traceId: "trace-1"},
    } as UIMessage
    const [turn] = buildTurnViewModels([message], {
        busy: false,
        executedFor: createExecutedToolIdentityCache(),
    })
    const store = createStore()
    store.set(activeUserIdAtom, "qa-user")
    store.set(playgroundInspectorEnabledAtom, inspectorEnabled)
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    flushSync(() => {
        root!.render(
            <Provider store={store}>
                <TurnRow turn={turn} sessionId="session-1" />
            </Provider>,
        )
    })
    return host
}

describe("mobile turn inspector control", () => {
    it("shows the trace action without hover when the debug preference is on", () => {
        const toolbar = renderAssistantTurn(true).querySelector(
            '[aria-label="View trace"]',
        )?.parentElement

        expect(toolbar?.className).toContain("opacity-100")
        expect(toolbar?.className).toContain("pointer-events-auto")
    })

    it("keeps the normal hover reveal while the debug preference is off", () => {
        const toolbar = renderAssistantTurn(false).querySelector('[aria-label="View trace"]')

        expect(toolbar).toBeNull()
    })
})
