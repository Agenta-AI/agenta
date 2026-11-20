// @vitest-environment jsdom
/**
 * The Automations tab of the Configuration page is the panel's AutomationsTab, without its Files
 * part, inside a view stack of the page (its automation views open there).
 */
import {act, useEffect, type ReactNode} from "react"

import {defineView, useOptionalViewStack, useViewForm, useViewTitle} from "@agenta/ui/view-stack"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const automations = vi.hoisted(() => ({
    props: null as Record<string, unknown> | null,
    stack: false,
    openDirty: false,
}))
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
vi.mock("@/features/agent-pages/ConfigurationEditorProvider", () => ({
    ConfigurationEditorProvider: Pass,
}))
vi.mock("@/features/agent-pages/ConfigurationAgentTab", () => ({ConfigurationAgentTab: () => null}))
vi.mock("@/features/agent-layout/AccessTab", () => ({AccessTab: () => null}))
vi.mock("@/features/agent-layout/AutomationsTab", () => ({
    AutomationsTab: (props: Record<string, unknown>) => {
        automations.props = props
        const stack = useOptionalViewStack()
        automations.stack = stack !== null
        useEffect(() => {
            if (!automations.openDirty) return
            // Open once, like a click.
            automations.openDirty = false
            void stack?.open(dirtyView, {}, {kind: "project"})
        }, [stack])
        return <div data-testid="automations-tab" />
    },
}))
vi.mock("@agenta/playground-ui/agent-page-header", () => ({AgentRevisionStatus: () => null}))

/** An automation form with edits. */
const DirtyBody = () => {
    useViewTitle("Morning check")
    useViewForm({dirty: true, valid: true, save: async () => true, leaveDescription: "Leave?"})
    return <span>form</span>
}
const dirtyView = defineView<Record<string, never>>({
    id: "test.automation",
    apply: "on_save",
    Component: DirtyBody,
})

const {AgentConfigurationScreen} = await import("@/features/agent-pages/AgentConfigurationScreen")

let host: HTMLDivElement
let root: Root
beforeEach(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    automations.props = null
    automations.stack = false
    automations.openDirty = false
    router.replace.mockClear()
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
            <Provider store={createStore()}>
                <AgentConfigurationScreen
                    workspaceId="w1"
                    projectId="p1"
                    agentId="support"
                    tab="automations"
                />
            </Provider>,
        ),
    )

const button = (text: string) =>
    [...document.querySelectorAll("button")].find((node) => node.textContent === text)

describe("Configuration page, Automations tab", () => {
    it("asks before a tab switch drops an automation form with edits", async () => {
        automations.openDirty = true
        await mount()
        const agentTab = [...document.querySelectorAll('[role="tab"]')].find(
            (node) => node.textContent === "Agent",
        ) as HTMLElement
        // Radix tabs select on pointer down.
        await act(async () => {
            agentTab.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, button: 0}))
        })
        expect(button("Keep editing")).toBeTruthy()
        expect(router.replace).not.toHaveBeenCalled()
        await act(async () => button("Discard")!.click())
        await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
        expect(router.replace).toHaveBeenCalledTimes(1)
        expect(button("Save")).toBeUndefined()
    })

    it("mounts the panel's AutomationsTab in a view stack, with no Files part", async () => {
        await act(async () =>
            root.render(
                <Provider store={createStore()}>
                    <AgentConfigurationScreen
                        workspaceId="w1"
                        projectId="p1"
                        agentId="support"
                        tab="automations"
                    />
                </Provider>,
            ),
        )
        expect(host.querySelector('[data-testid="automations-tab"]')).not.toBeNull()
        expect(automations.stack).toBe(true)
        expect(automations.props).toEqual({revisionId: "rev-4", workspaceId: "w1", projectId: "p1"})
    })
})
