// @vitest-environment jsdom
/**
 * The Configuration page on a phone (M07): PageLayout with the Agent / Automations / Access
 * switch, a section opened from its row as its own screen, and the open views kept across a
 * section and a resize across the phone width.
 */
import {act, useContext, useState, type ReactNode} from "react"

import {PhoneSectionsContext} from "@agenta/entity-ui/drill-in"
import {defineView, useViewStack, useViewTitle} from "@agenta/ui/view-stack"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const state = vi.hoisted(() => ({phone: true}))
const router = vi.hoisted(() => ({replace: vi.fn(async () => true)}))
const Pass = ({children}: {children?: ReactNode}) => <>{children}</>

vi.mock("next/router", () => ({
    useRouter: () => ({
        query: {},
        replace: router.replace,
        events: {on: () => undefined, off: () => undefined, emit: () => undefined},
    }),
}))
vi.mock("@/components/PageTitle", () => ({PageTitle: () => null}))
vi.mock("@/components/ScreenScaffold", () => ({
    ScreenScaffold: ({header, children}: {header: ReactNode; children: ReactNode}) => (
        <div>
            {header}
            {children}
        </div>
    ),
}))
vi.mock("@/features/nav/AppShell", () => ({AppShell: Pass}))
vi.mock("@/features/nav/NavDrawer", () => ({NavDrawer: () => null}))
vi.mock("@/features/chat/DrillInBridgeProvider", () => ({DrillInBridgeProvider: Pass}))
vi.mock("@/features/chat/SessionWorkspaceDrawers", () => ({SessionWorkspaceDrawers: () => null}))
vi.mock("@/features/chat/useTriggerTestRun", () => ({useTriggerTestRun: () => undefined}))
vi.mock("@/features/chat/useStartBlankSession", () => ({startBlankSession: vi.fn()}))
vi.mock("@/features/builder/pageContext", () => ({usePublishPageContext: () => undefined}))
vi.mock("@/features/agent-pages/AgentBuilderButton", () => ({AgentBuilderButton: () => null}))
vi.mock("@/features/agent-layout/AgentChannelPresence", () => ({default: () => null}))
vi.mock("@/features/context/useBindProjectContext", () => ({
    useBindProjectContext: () => undefined,
}))
vi.mock("@/features/context/useProjectPermission", () => ({
    useProjectPermissionState: () => ({pending: false, allowed: true}),
}))
vi.mock("@/features/agent-pages/useConfigurationRevision", () => ({
    useConfigurationRevision: () => ({
        revisionId: "rev-4",
        pin: vi.fn(),
        failed: false,
        retry: vi.fn(),
    }),
}))
vi.mock("@/features/agent-layout/AccessTab", () => ({AccessTab: () => null}))
vi.mock("@/features/agent-layout/AutomationsTab", () => ({AutomationsTab: () => null}))
vi.mock("@agenta/ui/phone", async (original) => ({
    ...(await original<typeof import("@agenta/ui/phone")>()),
    useIsPhone: () => state.phone,
}))

/** A view with local state: it is lost if the view mounts again. */
const NoteBody = () => {
    const [count, setCount] = useState(0)
    useViewTitle("Note")
    return (
        <button type="button" onClick={() => setCount(count + 1)}>
            {`Bumped ${count}`}
        </button>
    )
}
const noteView = defineView<Record<string, never>>({
    id: "test.note",
    apply: "immediate",
    Component: NoteBody,
})

vi.mock("@/features/chat/ConfigPane", () => ({
    ConfigPane: ({page}: {page?: boolean}) => {
        const phone = useContext(PhoneSectionsContext)
        const stack = useViewStack()
        return (
            <div data-testid={page ? "config-page" : "config-section"}>
                {phone && !phone.shownKey ? (
                    <button type="button" onClick={() => phone.show("tools", "Integrations")}>
                        Integrations row
                    </button>
                ) : null}
                {phone?.shownKey ? <span data-testid="open-section">{phone.shownKey}</span> : null}
                <button
                    type="button"
                    onClick={() => void stack.open(noteView, {}, {kind: "project"})}
                >
                    Open note
                </button>
            </div>
        )
    },
}))

const {AgentConfigurationScreen} = await import("@/features/agent-pages/AgentConfigurationScreen")

let host: HTMLDivElement
let root: Root
let store: ReturnType<typeof createStore>
beforeEach(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    state.phone = true
    store = createStore()
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

const mount = () =>
    act(async () =>
        root.render(
            <Provider store={store}>
                <AgentConfigurationScreen
                    workspaceId="w1"
                    projectId="p1"
                    agentId="support"
                    tab="agent"
                />
            </Provider>,
        ),
    )

const button = (text: string) =>
    [...host.querySelectorAll("button")].find((node) => node.textContent === text)
const click = (text: string) => act(async () => button(text)!.click())

describe("Configuration page on a phone", () => {
    it("shows the title and the Agent / Automations / Access switch", async () => {
        await mount()
        expect(host.querySelector("h1")?.textContent).toBe("Configuration")
        const options = [...host.querySelectorAll('[role="radio"]')].map((node) => node.textContent)
        expect(options).toEqual(["Agent", "Automations", "Access"])
        expect(host.querySelector('[data-testid="config-page"]')).not.toBeNull()
    })

    it("opens a section from its row as its own screen, with a way back", async () => {
        await mount()
        await click("Integrations row")
        expect(host.querySelector('[data-testid="open-section"]')?.textContent).toBe("tools")
        expect(host.querySelector("h1")?.textContent).toBe("Integrations")
        expect(host.querySelector('[role="radiogroup"]')).toBeNull()
        await click("Configuration")
        expect(host.querySelector('[data-testid="open-section"]')).toBeNull()
        expect(host.querySelector('[role="radiogroup"]')).not.toBeNull()
    })

    it("an open view covers the page: no page title and no switch while it is open", async () => {
        await mount()
        await click("Open note")
        expect(button("Bumped 0")).toBeTruthy()
        expect(host.querySelector('[role="radiogroup"]')).toBeNull()
    })

    it("keeps an open view and its state across the phone width, both ways", async () => {
        state.phone = false
        await mount()
        await click("Open note")
        await click("Bumped 0")
        state.phone = true
        await mount()
        expect(button("Bumped 1")).toBeTruthy()
        state.phone = false
        await mount()
        expect(button("Bumped 1")).toBeTruthy()
        expect(host.querySelector('[role="radiogroup"]')).not.toBeNull()
    })

    it("keeps the page on a wide window: the title row and the switch stay over a view", async () => {
        state.phone = false
        await mount()
        expect(host.querySelector('[data-testid="config-page"]')).not.toBeNull()
        await click("Open note")
        expect(host.querySelector("h1")?.textContent).toBe("Configuration")
        expect(host.querySelector('[role="radiogroup"]')).not.toBeNull()
    })
})
