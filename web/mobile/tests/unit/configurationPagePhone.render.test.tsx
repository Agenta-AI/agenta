// @vitest-environment jsdom
/**
 * The Configuration page on a phone (M07): the version status at the end of the tab row, the
 * Agent tab's rows, and a section opened from its row as its own screen.
 */
import {act, useContext, type ReactNode} from "react"

import {PhoneSectionsContext} from "@agenta/entity-ui/drill-in"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const state = vi.hoisted(() => ({
    phone: true,
    statusProps: [] as Record<string, unknown>[],
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
vi.mock("@/features/agent-pages/ConfigurationAgentTab", () => ({
    ConfigurationAgentTab: () => {
        const phone = useContext(PhoneSectionsContext)
        if (!phone) return <div data-testid="accordion" />
        return phone.openKey ? (
            <div data-testid="open-section">{phone.openKey}</div>
        ) : (
            <button type="button" onClick={() => phone.open("tools", "Integrations")}>
                Integrations row
            </button>
        )
    },
}))
vi.mock("@/features/agent-layout/AccessTab", () => ({AccessTab: () => null}))
vi.mock("@agenta/ui/phone", async (original) => ({
    ...(await original<typeof import("@agenta/ui/phone")>()),
    useIsPhone: () => state.phone,
}))
vi.mock("@/features/agent-layout/AutomationsTab", () => ({AutomationsTab: () => null}))
vi.mock("@agenta/playground-ui/agent-page-header", () => ({
    AgentRevisionStatus: (props: Record<string, unknown>) => {
        state.statusProps.push(props)
        return <span data-testid="revision-status" />
    },
}))

const {AgentConfigurationScreen} = await import("@/features/agent-pages/AgentConfigurationScreen")

let host: HTMLDivElement
let root: Root
beforeEach(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    state.phone = true
    state.statusProps = []
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
                    tab="agent"
                />
            </Provider>,
        ),
    )

const button = (text: string) =>
    [...host.querySelectorAll("button")].find((node) => node.textContent === text)

describe("Configuration page on a phone", () => {
    it("puts the version status at the end of the tab row", async () => {
        await mount()
        const status = host.querySelector('[data-testid="revision-status"]')!
        expect(status.previousElementSibling?.getAttribute("role")).toBe("tablist")
        expect(state.statusProps.at(-1)).toMatchObject({
            revisionId: "rev-4",
            historyWorkflowId: "support",
            phone: {backTitle: "Configuration"},
        })
    })

    it("opens a section from its row as its own screen, with a way back", async () => {
        await mount()
        await act(async () => button("Integrations row")!.click())
        expect(host.querySelector('[data-testid="open-section"]')?.textContent).toBe("tools")
        expect(host.querySelector("h1")?.textContent).toBe("Integrations")
        expect(host.querySelector('[role="tablist"]')).toBeNull()
        await act(async () => button("Configuration")!.click())
        expect(host.querySelector('[data-testid="open-section"]')).toBeNull()
        expect(host.querySelector('[role="tablist"]')).not.toBeNull()
    })

    it("keeps the desktop page on a wide window", async () => {
        state.phone = false
        await mount()
        expect(host.querySelector('[data-testid="accordion"]')).not.toBeNull()
        expect(state.statusProps.at(-1)?.phone).toBeUndefined()
    })
})
