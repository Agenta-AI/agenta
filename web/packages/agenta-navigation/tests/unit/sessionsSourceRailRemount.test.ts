/**
 * A session switch remounts the rail. A rail read aborted with its last observer started again
 * for the next observer, so one switch sent the same rail read two or three times. The rail reads
 * carry no abort signal, so a remount joins the read in flight.
 */
import {QueryClient} from "@tanstack/react-query"
import {createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

const querySessions = vi.fn()
const querySessionsFlatPage = vi.fn()
const queryInteractions = vi.fn()

vi.mock("@agenta/entities/session", () => ({
    querySessions: (...args: unknown[]) => querySessions(...args),
    querySessionsFlatPage: (...args: unknown[]) => querySessionsFlatPage(...args),
    queryInteractions: (...args: unknown[]) => queryInteractions(...args),
    livenessPollInterval: () => false,
}))

vi.mock("@agenta/entities/workflow", async () => {
    const {atom} = await import("jotai")
    return {
        agentWorkflowsListQueryStateAtom: atom({data: [], isPending: false}),
        appWorkflowsListQueryAtom: atom({data: {refs: []}}),
        workflowMolecule: {selectors: {artifactName: () => atom(null)}},
    }
})

vi.mock("@agenta/sessions/row", () => ({
    isAutomationSession: () => false,
    sessionOpenTarget: (row: {session_id: string}) => ({appId: `app-${row.session_id}`}),
}))

vi.mock("@agenta/sessions/state", async () => {
    const {atom} = await import("jotai")
    return {
        pinnedSessionIdsAtom: atom([] as string[]),
        // The source reads through the shared flight, so the stub is its options over `queryInteractions`.
        actionableInteractionsQueryOptions: (projectId: string) => ({
            queryKey: ["sessions-page", "actionable-interactions", projectId],
            queryFn: () => queryInteractions({projectId, actionableOnly: true}),
            staleTime: 10_000,
        }),
    }
})

vi.mock("@agenta/shared/state", async () => {
    const {atom} = await import("jotai")
    return {idleReadyAtom: atom(true), projectIdAtom: atom("project-1" as string | null)}
})

// The real filters atom is storage-backed, which does not round-trip under `node`.
vi.mock("../../src/dynamic/sessionFilters", async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>
    const {atom} = await import("jotai")
    const {atomFamily} = await import("jotai-family")
    const filters = {agentIds: [], status: "all", activity: "7d", type: "chat", groupBy: "date"}
    return {
        ...actual,
        sidebarSessionFiltersAtomFamily: atomFamily((_scopeId: string) => atom(filters)),
    }
})

const memory = new Map<string, string>()
;(globalThis as unknown as {localStorage: unknown}).localStorage = {
    getItem: (key: string) => (memory.has(key) ? memory.get(key)! : null),
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
    clear: () => memory.clear(),
    key: (index: number) => [...memory.keys()][index] ?? null,
    get length() {
        return memory.size
    },
}

const settle = async (ticks = 12) => {
    for (let index = 0; index < ticks; index++)
        await new Promise((resolve) => setTimeout(resolve, 0))
}

describe("the rail across a remount", () => {
    beforeEach(() => {
        querySessions.mockReset()
        querySessionsFlatPage.mockReset()
        queryInteractions.mockReset()
    })

    it("joins the read in flight instead of aborting it and reading again", async () => {
        const {MAIN_SIDEBAR_SCOPE_ID} = await import("../../src/constants")
        const {sidebarSessionsListAtomFamily} = await import("../../src/dynamic/sessionsSource")
        let answer!: (rows: unknown[]) => void
        querySessions.mockImplementation(
            () => new Promise<unknown[]>((resolve) => (answer = resolve)),
        )
        queryInteractions.mockResolvedValue([])
        const store = createStore()
        store.set(
            queryClientAtom,
            new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 60_000}}}),
        )
        const list = sidebarSessionsListAtomFamily(MAIN_SIDEBAR_SCOPE_ID)

        // The rail mounts and starts its read; the switch unmounts it and mounts it again.
        const first = store.sub(list, () => {})
        store.get(list)
        await settle()
        expect(querySessions).toHaveBeenCalledTimes(1)
        first()
        await settle()
        const second = store.sub(list, () => {})
        store.get(list)
        await settle()

        expect(querySessions).toHaveBeenCalledTimes(1)
        expect(querySessions.mock.calls[0][0].abortSignal).toBeUndefined()
        answer([])
        await settle()
        second()
    })
})
