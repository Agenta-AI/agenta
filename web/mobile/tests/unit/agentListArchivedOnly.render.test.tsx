// @vitest-environment jsdom
/**
 * A project whose every agent is archived must still reach its archived list: the first-run page
 * carries a way in. A project with no agents at all keeps the first-run page unchanged.
 */
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const state = vi.hoisted(() => ({
    live: [] as {id: string; name: string}[],
    archived: [] as {id: string; name: string; deleted_at: string}[],
    archivedEnabled: [] as boolean[],
}))

vi.mock("@agenta/entities/workflow", () => ({
    agentRosterSearchAtom: {init: "", read: () => "", write: () => undefined},
    agentWorkflowsListQueryStateAtom: {read: () => ({}), init: undefined},
    matchesAgentQuery: () => true,
}))
vi.mock("jotai", async (importOriginal) => {
    const actual = await importOriginal<typeof import("jotai")>()
    return {
        ...actual,
        useAtomValue: () => ({data: state.live, isPending: false, isError: false}),
        useAtom: () => ["", vi.fn()],
    }
})
vi.mock("@agenta/sessions/state", () => ({useWaitingByAgent: () => new Map()}))
vi.mock("@tanstack/react-query", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@tanstack/react-query")>()),
    useQueryClient: () => ({}),
}))
vi.mock("next/router", () => ({useRouter: () => ({push: vi.fn()})}))
vi.mock("@/components/PageTitle", () => ({PageTitle: () => null}))
vi.mock("@/components/ScreenScaffold", () => ({
    ScreenScaffold: ({header, children}: {header: React.ReactNode; children: React.ReactNode}) => (
        <div>
            {header}
            {children}
        </div>
    ),
}))
vi.mock("@/features/context/useBindProjectContext", () => ({
    useBindProjectContext: () => undefined,
}))
vi.mock("@/features/education/FeatureOnboarding", () => ({
    FeatureOnboarding: () => <div data-testid="first-run" />,
}))
vi.mock("@/features/education/HowThisWorksButton", () => ({HowThisWorksButton: () => null}))
vi.mock("@/features/nav/AppShell", () => ({
    AppShell: ({children}: {children: React.ReactNode}) => <div>{children}</div>,
}))
vi.mock("@/features/nav/NavDrawer", () => ({NavDrawer: () => null}))
vi.mock("@/features/agents/NewAgentAction", () => ({NewAgentAction: () => null}))
vi.mock("@/features/agents/AgentFilterMenu", () => ({
    AgentFilterMenu: () => <div data-testid="filter-bar" />,
}))
vi.mock("@/features/agents/AgentListTable", () => ({
    AgentListTable: ({groups}: {groups: unknown[]}) => (
        <div data-testid="list">{groups.length}</div>
    ),
}))
vi.mock("@/features/agents/useAgentOwners", () => ({
    useAgentOwners: () => ({owners: [], ownerNames: new Map()}),
}))
vi.mock("@/features/agents/useAgentRowActions", () => ({useAgentRowActions: () => ({})}))
vi.mock("@/features/agents/useNewAgentAction", () => ({useNewAgentAction: () => ({})}))
vi.mock("@/features/agents/useArchivedAgents", () => ({
    useArchivedAgents: ({enabled}: {enabled: boolean}) => {
        state.archivedEnabled.push(enabled)
        return {
            agents: enabled ? state.archived : [],
            isPending: false,
            isError: false,
            refetch: vi.fn(),
        }
    },
}))
vi.mock("@/features/agents/agentListView", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/features/agents/agentListView")>()
    return {...actual, toAgentListRow: (w: {id: string; name: string}) => w}
})

import {AgentListScreen} from "@/features/agents/AgentListScreen"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let host: HTMLDivElement
let root: Root

const render = async () => {
    await act(async () => root.render(<AgentListScreen workspaceId="w" projectId="p" />))
}

beforeEach(() => {
    state.live = []
    state.archived = []
    state.archivedEnabled = []
    window.localStorage.clear()
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("the agent list when no agent is active", () => {
    it("keeps the first-run page for a project with no agents at all", async () => {
        await render()
        expect(host.querySelector("[data-testid=first-run]")).not.toBeNull()
        expect(host.textContent).not.toContain("archived")
    })

    it("offers the archived list when every agent is archived", async () => {
        state.archived = [{id: "a1", name: "Old", deleted_at: "2026-01-01"}]
        await render()
        const link = [...host.querySelectorAll("button")].find((b) =>
            /archived agents/i.test(b.textContent ?? ""),
        )
        expect(link).toBeDefined()
        await act(async () => link?.click())
        expect(host.querySelector("[data-testid=filter-bar]")).not.toBeNull()
        expect(host.querySelector("[data-testid=first-run]")).toBeNull()
    })
})
