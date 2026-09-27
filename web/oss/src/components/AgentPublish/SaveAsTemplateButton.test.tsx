/**
 * The template menu's items each send one chat request through the playground's run-this-turn
 * seam, in the current session. The active conversation consumes each request nonce once, so one request is
 * one visible user message, and the composer's unsent draft is never touched.
 */
import {act, createElement} from "react"

import {composerDraftBySession} from "@agenta/chat/state"
import {
    SAVE_AS_TEMPLATE_MESSAGE,
    SHARE_TEMPLATE_IN_MARKETPLACE_MESSAGE,
} from "@agenta/entities/workflow"
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

const trigger = () =>
    document.querySelector<HTMLButtonElement>('[data-testid="template-options-button"]')
const menuItem = (key: "save-zip" | "share-marketplace") =>
    document.querySelector<HTMLElement>(`[data-testid="template-options-${key}"]`)

/** Open the real menu the way a mouse does (pointerdown on the trigger). */
const openMenu = async () => {
    await act(async () => {
        trigger()?.dispatchEvent(
            new MouseEvent("pointerdown", {bubbles: true, cancelable: true, button: 0}),
        )
    })
}

/** Open the menu and pick an item with a click, so the menu's own close-on-select runs. */
const choose = async (key: "save-zip" | "share-marketplace") => {
    await openMenu()
    await act(async () => menuItem(key)?.click())
}

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
    it("is an icon menu labelled Template options with the two template items", async () => {
        mount()
        expect(trigger()?.getAttribute("aria-label")).toBe("Template options")
        expect(menuItem("save-zip")).toBeNull()
        await openMenu()
        expect(menuItem("save-zip")?.textContent).toBe("Save as template (.zip)")
        expect(menuItem("share-marketplace")?.textContent).toBe(
            "Share as template in the marketplace",
        )
    })

    it.each([
        ["save-zip", SAVE_AS_TEMPLATE_MESSAGE],
        ["share-marketplace", SHARE_TEMPLATE_IN_MARKETPLACE_MESSAGE],
    ] as const)(
        "%s sends its message once in the current session and keeps the draft",
        async (key, message) => {
            composerDraftBySession.set(SESSION, "half-written question")
            mount()
            await choose(key)

            expect(sent).toHaveLength(1)
            expect(sent[0].text).toBe(message)
            // The current session: switching to a new one would leave the unsent draft behind.
            expect(sent[0].newSession).toBeFalsy()
            expect(composerDraftBySession.get(SESSION)).toBe("half-written question")
            expect(trigger()?.disabled).toBe(true)
        },
    )

    it("sends nothing more while a request is still unsent", async () => {
        mount()
        await choose("save-zip")
        await choose("share-marketplace")

        expect(sent).toHaveLength(1)
    })

    it("is available again once the chat consumed the request", async () => {
        mount()
        await choose("save-zip")
        act(() => store.set(simulatedAgentRunAtomFamily(ENTITY), null))

        expect(trigger()?.disabled).toBe(false)
        await choose("share-marketplace")
        expect(sent.map((request) => request.text)).toEqual([
            SAVE_AS_TEMPLATE_MESSAGE,
            SHARE_TEMPLATE_IN_MARKETPLACE_MESSAGE,
        ])
    })
})
