/**
 * Save as template sends one chat request through the playground's run-this-turn seam, in the
 * current session. The active conversation consumes each request nonce once, so one request is
 * one visible user message, and the composer's unsent draft is never touched.
 */
import {act, createElement} from "react"

import {composerDraftBySession} from "@agenta/chat/state"
import {SAVE_AS_TEMPLATE_MESSAGE} from "@agenta/entities/workflow"
import {
    projectIdAtom,
    simulatedAgentRunAtomFamily,
    type SimulatedAgentRunRequest,
} from "@agenta/shared/state"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it} from "vitest"

import {AgentChatScopeProvider} from "@/oss/components/AgentChatSlice/state/scope"
import {setActiveSessionAtomFamily} from "@/oss/components/AgentChatSlice/state/sessions"

import SaveAsTemplateButton from "./SaveAsTemplateButton"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const SCOPE = "app-save-as-template"
const ENTITY = "revision-1"
const SESSION = "session-with-draft"

let store: ReturnType<typeof createStore>
let root: Root | null = null
let host: HTMLDivElement | null = null
/** Requests the chat panel would consume, de-duplicated by nonce as the real consumer does. */
let sent: SimulatedAgentRunRequest[] = []

const mount = () => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    act(() => {
        root?.render(
            createElement(
                Provider,
                {store},
                createElement(
                    AgentChatScopeProvider,
                    {scopeKey: SCOPE},
                    createElement(SaveAsTemplateButton, {entityId: ENTITY}),
                ),
            ),
        )
    })
}

const button = () =>
    host?.querySelector<HTMLButtonElement>('[data-testid="save-as-template-button"]') ?? null

beforeEach(() => {
    store = createStore()
    store.set(projectIdAtom, "proj-test")
    store.set(setActiveSessionAtomFamily(SCOPE), SESSION)
    sent = []
    const seen = new Set<number>()
    store.sub(simulatedAgentRunAtomFamily(ENTITY), () => {
        const request = store.get(simulatedAgentRunAtomFamily(ENTITY))
        if (request && !seen.has(request.nonce)) {
            seen.add(request.nonce)
            sent.push(request)
        }
    })
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

describe("SaveAsTemplateButton", () => {
    it("sends exactly one chat message with the export request on one click", () => {
        mount()
        act(() => button()?.click())

        expect(sent).toHaveLength(1)
        expect(sent[0].text).toBe(SAVE_AS_TEMPLATE_MESSAGE)
        // The current session: switching to a new one would leave the unsent draft behind.
        expect(sent[0].newSession).toBeFalsy()
        expect(button()?.disabled).toBe(true)
    })

    it("sends one message when a double click lands before the re-render", () => {
        mount()
        act(() => {
            button()?.click()
            button()?.click()
        })
        act(() => button()?.click())

        expect(sent).toHaveLength(1)
    })

    it("sends in the current session and leaves its unsent composer draft unchanged", () => {
        composerDraftBySession.set(SESSION, "half-written question")
        mount()
        act(() => button()?.click())

        expect(sent).toHaveLength(1)
        expect(sent[0].newSession).toBeFalsy()
        expect(composerDraftBySession.get(SESSION)).toBe("half-written question")
    })

    it("is available again once the chat consumed the request and the run settled", () => {
        mount()
        act(() => button()?.click())
        act(() => store.set(simulatedAgentRunAtomFamily(ENTITY), null))

        expect(button()?.disabled).toBe(false)
        act(() => button()?.click())
        expect(sent).toHaveLength(2)
    })
})
