// @vitest-environment jsdom
/**
 * The template menu on /m sends the same requests as the /w playground header, as the CURRENT
 * session's pending task. The conversation sends a pending task once, like a typed message, and
 * never through the composer, so one tap is one visible user message and the unsent draft stays.
 */
import {act, createElement} from "react"

import {composerDraftBySession} from "@agenta/chat/state"
import {
    SAVE_AS_TEMPLATE_MESSAGE,
    SHARE_TEMPLATE_IN_MARKETPLACE_MESSAGE,
} from "@agenta/entities/workflow"
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

const trigger = () =>
    document.querySelector<HTMLButtonElement>('[data-testid="template-options-button"]')
const menuItem = (key: "save-zip" | "share-marketplace") =>
    document.querySelector<HTMLElement>(`[data-testid="template-options-${key}"]`)

/** Open the real menu the way a finger or mouse does (pointerdown on the trigger). */
const openMenu = async () => {
    await act(async () => {
        trigger()?.dispatchEvent(
            new MouseEvent("pointerdown", {bubbles: true, cancelable: true, button: 0}),
        )
    })
}

/** Open the menu and pick an item, so the menu's own close-on-select runs. */
const choose = async (key: "save-zip" | "share-marketplace") => {
    await openMenu()
    await act(async () => menuItem(key)?.click())
}

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
        "%s parks its message as the current session's one pending task and keeps the draft",
        async (key, message) => {
            composerDraftBySession.set(SESSION, "half-written question")
            mount()
            await choose(key)

            expect(store.get(pendingTasksAtom)).toEqual({
                [SESSION]: {agentId: AGENT, text: message},
            })
            expect(composerDraftBySession.get(SESSION)).toBe("half-written question")
            expect(trigger()?.disabled).toBe(true)
        },
    )

    it("parks nothing more while a request is still unsent", async () => {
        mount()
        await choose("save-zip")
        await choose("share-marketplace")

        expect(store.get(pendingTasksAtom)).toEqual({
            [SESSION]: {agentId: AGENT, text: SAVE_AS_TEMPLATE_MESSAGE},
        })
    })

    it("is available again once the conversation took the request", async () => {
        mount()
        await choose("save-zip")
        act(() => {
            store.set(takePendingTaskAtom, SESSION)
        })

        expect(trigger()?.disabled).toBe(false)
    })
})
