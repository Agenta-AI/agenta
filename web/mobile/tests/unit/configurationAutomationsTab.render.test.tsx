// @vitest-environment jsdom
/**
 * The Automations tab of the Configuration page is the panel's AutomationsTab, without its Files
 * part, inside a view stack of the page (its automation views open there).
 */
import {act, type ReactNode} from "react"

import {useOptionalViewStack} from "@agenta/ui/view-stack"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const automations = vi.hoisted(() => ({
    props: null as Record<string, unknown> | null,
    stack: false,
}))
const Pass = ({children}: {children?: ReactNode}) => <>{children}</>

vi.mock("next/router", () => ({useRouter: () => ({query: {}, replace: vi.fn()})}))
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
        automations.stack = useOptionalViewStack() !== null
        return <div data-testid="automations-tab" />
    },
}))
vi.mock("@agenta/playground-ui/agent-page-header", () => ({AgentRevisionStatus: () => null}))

const {AgentConfigurationScreen} = await import("@/features/agent-pages/AgentConfigurationScreen")

let host: HTMLDivElement
let root: Root
beforeEach(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    automations.props = null
    automations.stack = false
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

describe("Configuration page, Automations tab", () => {
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
