// @vitest-environment jsdom
/**
 * The session header's share actions on /m. Publish opens the channels panel. The Templates menu's
 * items send the same requests as the /w playground header, as the CURRENT session's pending
 * task. The conversation sends a pending task once, like a typed message, and never through the
 * composer, so one tap is one visible user message and the unsent draft stays.
 */
import {act, createElement} from "react"

import {composerDraftBySession} from "@agenta/chat/state"
import {
    SAVE_AS_TEMPLATE_MESSAGE,
    SHARE_TEMPLATE_IN_MARKETPLACE_MESSAGE,
} from "@agenta/entities/workflow"
import {atom, createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {ShareMenu} from "../../src/features/chat/ShareMenu"
import {pendingTasksAtom, takePendingTaskAtom} from "../../src/features/home/pendingTask"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const openHub = vi.fn()

vi.mock("@agenta/entities/workflow", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/workflow")>()),
    agentWorkflowsListQueryStateAtom: atom({data: []}),
}))

vi.mock("../../src/features/agents/useAgentPublishPanel", () => ({
    useAgentPublishPanel: () => ({openHub, panel: null}),
}))

const AGENT = "agent-1"
const SESSION = "session-with-draft"

let store: ReturnType<typeof createStore>
let root: Root | null = null
let host: HTMLDivElement | null = null

const mount = ({canRequestTemplate = true}: {canRequestTemplate?: boolean} = {}) => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    act(() => {
        root?.render(
            createElement(
                Provider,
                {store},
                createElement(ShareMenu, {
                    agentId: AGENT,
                    sessionId: SESSION,
                    canRequestTemplate,
                    workspaceId: "workspace-1",
                    projectId: "project-1",
                }),
            ),
        )
    })
}

const trigger = () =>
    document.querySelector<HTMLButtonElement>('[data-testid="template-menu-button"]')
const publishButton = () =>
    document.querySelector<HTMLButtonElement>('[data-testid="share-menu-publish"]')
const menuItem = (key: "save-zip" | "share-marketplace") =>
    document.querySelector<HTMLElement>(`[data-testid="share-menu-${key}"]`)

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
    openHub.mockClear()
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

describe("ShareMenu (/m)", () => {
    it("is a Publish button beside a Templates menu that holds the two template items", async () => {
        mount()
        expect(publishButton()?.textContent).toBe("Publish")
        expect(trigger()?.textContent).toBe("Templates")
        expect(menuItem("save-zip")).toBeNull()
        await openMenu()
        expect(menuItem("save-zip")?.textContent).toContain("Save as template")
        expect(menuItem("share-marketplace")?.textContent).toContain("Share in the marketplace")
    })

    it("opens the channels panel from Publish", async () => {
        mount()
        await act(async () => publishButton()?.click())
        expect(openHub).toHaveBeenCalledTimes(1)
    })

    it("shows only Publish without a live conversation", async () => {
        mount({canRequestTemplate: false})
        expect(publishButton()).not.toBeNull()
        expect(trigger()).toBeNull()
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
        },
    )

    it("disables the template items, not Publish, while a request is unsent", async () => {
        mount()
        await choose("save-zip")
        await openMenu()

        expect(menuItem("save-zip")?.hasAttribute("data-disabled")).toBe(true)
        expect(menuItem("share-marketplace")?.hasAttribute("data-disabled")).toBe(true)
        expect(publishButton()?.disabled).toBe(false)
    })

    it("parks nothing more while a request is still unsent", async () => {
        mount()
        await choose("save-zip")
        await choose("share-marketplace")

        expect(store.get(pendingTasksAtom)).toEqual({
            [SESSION]: {agentId: AGENT, text: SAVE_AS_TEMPLATE_MESSAGE},
        })
    })

    it("enables the template items again once the conversation took the request", async () => {
        mount()
        await choose("save-zip")
        act(() => {
            store.set(takePendingTaskAtom, SESSION)
        })
        await openMenu()

        expect(menuItem("save-zip")?.hasAttribute("data-disabled")).toBe(false)
    })
})
