// @vitest-environment jsdom
import {act, type ReactNode} from "react"

import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const api = vi.hoisted(() => ({queryRegistrySkills: vi.fn()}))

vi.mock("@agenta/sdk/resources", async (original) => ({
    ...(await original<object>()),
    getSkillsClient: () => ({queryRegistrySkills: api.queryRegistrySkills}),
}))
vi.mock("next/router", () => import("../support/nextRouter").then((m) => m.nextRouterModule))
vi.mock("@/features/nav/AppShell", () => ({
    AppShell: ({children}: {children: ReactNode}) => <>{children}</>,
}))
vi.mock("@/features/nav/NavDrawer", () => ({NavDrawer: () => null}))
vi.mock("@/features/education/HowThisWorksButton", () => ({HowThisWorksButton: () => null}))
vi.mock("@/features/context/useBindProjectContext", () => ({useBindProjectContext: vi.fn()}))
vi.mock("@/features/agents/useAgentOwners", () => ({
    useAgentOwners: () => ({ownerNames: new Map()}),
}))
vi.mock("@/features/skills/SkillListTable", () => ({SkillListTable: () => null}))
vi.mock("@agenta/skills-ui", async (original) => ({
    ...(await original<object>()),
    NewSkillMenuButton: () => null,
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

import {SkillListScreen} from "@/features/skills/SkillListScreen"

const store = getDefaultStore()
let queryClient: QueryClient

let root: Root | undefined
let host: HTMLDivElement | undefined

const typeInto = (input: HTMLInputElement, value: string) => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    setValue.call(input, value)
    input.dispatchEvent(new Event("input", {bubbles: true}))
}

beforeEach(() => {
    vi.useFakeTimers()
    queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
    store.set(queryClientAtom, queryClient)
    store.set(projectIdAtom, "proj-1")
    store.set(sessionAtom, true)
    api.queryRegistrySkills.mockResolvedValue({
        count: 1,
        skills: [{id: "rev-1", workflow_id: "wf-1", name: "Summarize", skill_name: "summarize"}],
        builtin: [],
    })
})
afterEach(() => {
    if (root) act(() => root!.unmount())
    root = undefined
    host = undefined
    api.queryRegistrySkills.mockReset()
    vi.useRealTimers()
})

describe("SkillListScreen search", () => {
    it("sends one query for five fast keystrokes", async () => {
        host = document.createElement("div")
        document.body.appendChild(host)
        root = createRoot(host)
        await act(async () => {
            // The row and bulk actions read the query client from the provider.
            root!.render(
                <QueryClientProvider client={queryClient}>
                    <SkillListScreen workspaceId="ws-1" projectId="proj-1" />
                </QueryClientProvider>,
            )
        })
        await act(async () => {
            await vi.advanceTimersByTimeAsync(10)
        })

        const input = host.querySelector<HTMLInputElement>(
            'input[placeholder="Search skills by name…"]',
        )!
        for (const value of ["s", "su", "sum", "summ", "summa"]) {
            await act(async () => {
                typeInto(input, value)
                await vi.advanceTimersByTimeAsync(50)
            })
        }
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000)
        })

        expect(input.value).toBe("summa")
        expect(api.queryRegistrySkills.mock.calls.map(([body]) => body)).toEqual([
            {},
            {search: "summa"},
        ])
        host.remove()
    })
})
