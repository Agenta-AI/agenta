// @vitest-environment jsdom
// A role without `view_spans` gets no trace action in a chat. That the trace atoms themselves
// read nothing is covered in `@agenta/entities` (tests/unit/trace-access-gate.test.ts).
import {buildTurnViewModels, createExecutedToolIdentityCache} from "@agenta/chat/model"
import {activeUserIdAtom, playgroundInspectorEnabledAtom} from "@agenta/shared/state"
import type {UIMessage} from "ai"
import {createStore, Provider} from "jotai"
import {flushSync} from "react-dom"
import {createRoot} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

import {TurnRow} from "@/features/chat/TurnRow"

import {WithQueryClient} from "../support/queryClient"

const gate = vi.hoisted(() => ({allowed: false}))

vi.mock("next/router", () => import("../support/nextRouter").then((m) => m.nextRouterModule))
vi.mock("@agenta/entities/access", async (original) => {
    const {atom} = await import("jotai")
    return {...(await original<object>()), canViewSpansAtom: atom(() => gate.allowed)}
})

;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let root: ReturnType<typeof createRoot> | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
    if (root) flushSync(() => root!.unmount())
    root = undefined
    host?.remove()
    host = undefined
})

const renderSettledTurn = () => {
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
    store.set(playgroundInspectorEnabledAtom, true)
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    flushSync(() => {
        root!.render(
            <WithQueryClient>
                <Provider store={store}>
                    <TurnRow turn={turn} sessionId="session-1" />
                </Provider>
            </WithQueryClient>,
        )
    })
    return host
}

describe("a chat turn for a reader without trace access", () => {
    it("offers no trace action, with the debug preference on as well", () => {
        gate.allowed = false
        const shown = renderSettledTurn()

        expect(shown.querySelector('[aria-label="View trace"]')).toBeNull()
    })

    it("offers the action to a reader who may read traces", () => {
        gate.allowed = true
        const shown = renderSettledTurn()

        expect(shown.querySelector('[aria-label="View trace"]')).not.toBeNull()
    })
})
