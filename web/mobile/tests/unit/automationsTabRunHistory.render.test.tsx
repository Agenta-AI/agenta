// @vitest-environment jsdom
/**
 * "Run history" in an automation row's menu opens the automation view with its history on top, so
 * the crumb keeps the automation's name and Back returns to it.
 */
import {act, type ReactNode} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const captured = vi.hoisted(() => ({
    onOpenRunHistory: undefined as undefined | ((ref: {id: string; kind: string}) => void),
    open: vi.fn(),
}))

vi.mock("@agenta/automation-ui", () => ({AutomationTriggerDrawers: () => null}))
vi.mock("@agenta/entities/gatewayTrigger", async () => {
    const {atom} = await import("jotai")
    return {triggerScheduleDrawerAtom: atom(null), triggerSubscriptionDrawerAtom: atom(null)}
})
vi.mock("@agenta/entity-ui/drill-in", () => ({
    AgentOperationsSections: (props: {onOpenRunHistory: typeof captured.onOpenRunHistory}) => {
        captured.onOpenRunHistory = props.onOpenRunHistory
        return null
    },
}))
vi.mock("@agenta/entity-ui/drive", () => ({
    StorageFilesHeader: () => null,
    StorageSection: () => null,
}))
vi.mock("@agenta/ui/phone", () => ({useIsPhone: () => false}))
vi.mock("@agenta/ui/view-stack", () => ({useViewStack: () => ({open: captured.open})}))
vi.mock("@/features/chat/DrillInBridgeProvider", () => ({
    DrillInBridgeProvider: ({children}: {children: ReactNode}) => <>{children}</>,
}))
vi.mock("@/features/context/useProjectPermission", () => ({
    useProjectPermissionState: () => ({pending: false, allowed: true}),
}))
vi.mock("@/features/automations/automationView", () => ({
    automationView: {id: "automations.automation"},
    automationNewView: {id: "automations.new"},
}))

const {AutomationsTab} = await import("@/features/agent-layout/AutomationsTab")

let host: HTMLDivElement
let root: Root
beforeEach(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    captured.open.mockClear()
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

describe("AutomationsTab", () => {
    it("opens Run history inside the automation view", () => {
        act(() =>
            root.render(<AutomationsTab revisionId="rev-1" workspaceId="w1" projectId="p1" />),
        )
        act(() => captured.onOpenRunHistory?.({id: "auto-1", kind: "subscription"}))
        expect(captured.open).toHaveBeenCalledWith(
            {id: "automations.automation"},
            {
                automationId: "auto-1",
                kind: "event",
                workspaceId: "w1",
                projectId: "p1",
                openRuns: true,
            },
            {kind: "project"},
        )
    })
})
