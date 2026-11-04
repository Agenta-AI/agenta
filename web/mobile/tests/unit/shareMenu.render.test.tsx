// @vitest-environment jsdom
/**
 * The session header's share actions on /m. Publish opens the channels panel. The Share panel's
 * template rows send the same requests as the /w playground header, as the CURRENT session's pending
 * task. The conversation sends a pending task once, like a typed message, and never through the
 * composer, so one tap is one visible user message and the unsent draft stays.
 */
import {act, createElement} from "react"

import {composerDraftBySession} from "@agenta/chat/state"
import {
    SAVE_AS_TEMPLATE_MESSAGE,
    SHARE_TEMPLATE_IN_MARKETPLACE_MESSAGE,
} from "@agenta/entities/workflow"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {ShareMenu} from "../../src/features/chat/ShareMenu"
import {pendingTasksAtom, takePendingTaskAtom} from "../../src/features/home/pendingTask"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const openHub = vi.fn()

// The factory is hoisted above the imports, so it loads jotai itself.
vi.mock("@agenta/entities/workflow", async (importOriginal) => {
    const {atom: mockAtom} = await import("jotai")
    return {
        ...(await importOriginal<typeof import("@agenta/entities/workflow")>()),
        agentWorkflowsListQueryStateAtom: mockAtom({data: []}),
    }
})

// Privacy and session sharing have their own suites; this one is about the templates and Publish.
vi.mock("@agenta/entity-ui/sharing", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entity-ui/sharing")>()),
    AgentPrivacyDialog: () => null,
}))

vi.mock("../../src/features/chat/useAgentPrivacyProps", () => ({
    useAgentPrivacyProps: () => ({agentName: "Agent", projectName: "Acme support"}),
}))

vi.mock("../../src/features/chat/useSessionSharing", () => ({
    useSessionSharing: () => ({sharing: undefined, owner: undefined}),
}))

vi.mock("../../src/features/agents/useAgentPublishPanel", () => ({
    useAgentPublishPanel: () => ({openHub, reload: vi.fn(), panel: null}),
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
                    sessionName: "Refund question",
                    showSession: true,
                    canRequestTemplate,
                    workspaceId: "workspace-1",
                    projectId: "project-1",
                    phone: false,
                }),
            ),
        )
    })
}

const shareButton = () =>
    document.querySelector<HTMLButtonElement>('[data-testid="share-menu-share"]')
const publishButton = () =>
    document.querySelector<HTMLButtonElement>('[data-testid="share-menu-publish"]')
const templateRow = (key: "save-zip" | "share-marketplace") =>
    document.querySelector<HTMLButtonElement>(`[data-testid="share-menu-${key}"]`)

const openShare = async () => {
    await act(async () => shareButton()?.click())
}

/** Open Share and pick a row, so the panel's own close runs. */
const choose = async (key: "save-zip" | "share-marketplace") => {
    await openShare()
    await act(async () => templateRow(key)?.click())
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
    it("is a Publish button beside a Share panel that holds the two template rows", async () => {
        mount()
        expect(publishButton()?.textContent).toBe("Publish")
        expect(shareButton()?.textContent).toBe("Share")
        expect(templateRow("save-zip")).toBeNull()
        await openShare()
        expect(templateRow("save-zip")?.textContent).toContain("Save as template")
        expect(templateRow("share-marketplace")?.textContent).toContain("Share in the marketplace")
    })

    it("opens the channels panel from Publish", async () => {
        mount()
        await act(async () => publishButton()?.click())
        expect(openHub).toHaveBeenCalledTimes(1)
    })

    it("leaves the template rows out of Share without a live conversation", async () => {
        mount({canRequestTemplate: false})
        await openShare()
        expect(document.body.textContent).toContain("Who can see this agent")
        expect(templateRow("save-zip")).toBeNull()
        expect(templateRow("share-marketplace")).toBeNull()
        expect(publishButton()).not.toBeNull()
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
            expect(templateRow(key)).toBeNull()
        },
    )

    it("disables the template rows, not Publish, while a request is unsent", async () => {
        mount()
        await choose("save-zip")
        await openShare()

        expect(templateRow("save-zip")?.disabled).toBe(true)
        expect(templateRow("share-marketplace")?.disabled).toBe(true)
        expect(publishButton()?.disabled).toBe(false)
    })

    it("parks nothing more on a double tap that lands before the re-render", async () => {
        mount()
        await openShare()
        const first = templateRow("save-zip")!
        const second = templateRow("share-marketplace")!
        act(() => {
            first.click()
            // Still enabled: only the store read can stop this tap.
            expect(second.disabled).toBe(false)
            second.click()
        })

        expect(store.get(pendingTasksAtom)).toEqual({
            [SESSION]: {agentId: AGENT, text: SAVE_AS_TEMPLATE_MESSAGE},
        })
    })

    it("enables the template rows again once the conversation took the request", async () => {
        mount()
        await choose("save-zip")
        act(() => {
            store.set(takePendingTaskAtom, SESSION)
        })
        await openShare()

        expect(templateRow("save-zip")?.disabled).toBe(false)
    })
})
