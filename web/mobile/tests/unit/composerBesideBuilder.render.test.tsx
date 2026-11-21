// @vitest-environment jsdom
//
// With the builder panel open beside a session, the two composers draw at the same height: the
// session composer takes the 36 px of the builder context chip row as extra text area height.
// It goes back to the normal height when the panel closes, and the builder composer keeps its own.
import {act} from "react"

import {useComposerAttachments} from "@agenta/chat/hooks"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeAll, describe, expect, it} from "vitest"

import {AgentPanelContext, type AgentPanelApi} from "@/features/agent-layout/agentPanelContext"
import type {PanelContent} from "@/features/agent-layout/agentPanelState"
import {BuilderChatContext} from "@/features/chat/builderChat"
import {Composer} from "@/features/chat/Composer"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

beforeAll(() => {
    // Lexical measures Range geometry, which jsdom does not implement.
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
        configurable: true,
        value: () => new DOMRect(),
    })
    Object.defineProperty(Range.prototype, "getClientRects", {
        configurable: true,
        value: () => [],
    })
})

let root: Root | undefined

afterEach(() => {
    if (root) act(() => root!.unmount())
    root = undefined
    document.body.innerHTML = ""
})

const panel = (content: PanelContent | null, phone = false): AgentPanelApi => ({
    content,
    toggle: async () => true,
    close: async () => true,
    configTab: "agent",
    setConfigTab: () => undefined,
    wide: false,
    setWide: () => undefined,
    phone,
    available: {files: true, configuration: true, builder: true},
})

const Harness = () => {
    const attachments = useComposerAttachments({sessionId: "session-1"})
    return (
        <Composer
            entityId="revision-1"
            sessionId="session-1"
            attachments={attachments}
            onSend={() => undefined}
        />
    )
}

const mount = async (api: AgentPanelApi, builderChat = false) => {
    if (!root) {
        const host = document.createElement("div")
        document.body.appendChild(host)
        root = createRoot(host)
    }
    await act(async () => {
        root!.render(
            <Provider store={createStore()}>
                <AgentPanelContext.Provider value={api}>
                    <BuilderChatContext.Provider value={builderChat}>
                        <Harness />
                    </BuilderChatContext.Provider>
                </AgentPanelContext.Provider>
            </Provider>,
        )
    })
}

const tall = () => document.querySelectorAll(".min-h-\\[70px\\]").length

describe("the session composer beside the builder panel", () => {
    it("grows by the chip row while the builder panel is open, and goes back when it closes", async () => {
        await mount(panel("builder"))
        expect(tall()).toBe(1)
        await mount(panel(null))
        expect(tall()).toBe(0)
    })

    it("keeps its height beside Files or Configuration, and on a phone", async () => {
        await mount(panel("configuration"))
        expect(tall()).toBe(0)
        await mount(panel("builder", true))
        expect(tall()).toBe(0)
    })

    it("leaves the builder composer at its own height", async () => {
        await mount(panel("builder"), true)
        expect(tall()).toBe(0)
    })
})
