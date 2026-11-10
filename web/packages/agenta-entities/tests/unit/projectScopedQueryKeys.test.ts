import {projectIdAtom, sessionAtom, setProjectIdAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore, type Atom} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

// Each fake answers for the project in the store at request time, as the real helpers do.
const rowsForCurrentProject = () => {
    const projectId = getDefaultStore().get(projectIdAtom)
    return {count: 1, connections: [{id: projectId}], schedules: [{id: projectId}]}
}

vi.mock("../../src/gatewayTool/api", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../src/gatewayTool/api")>()),
    queryToolConnections: vi.fn(async () => rowsForCurrentProject()),
}))

vi.mock("../../src/gatewayTrigger/api", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../src/gatewayTrigger/api")>()),
    queryTriggerConnections: vi.fn(async () => rowsForCurrentProject()),
    queryTriggerSchedules: vi.fn(async () => rowsForCurrentProject()),
    queryTriggerSubscriptions: vi.fn(async () => ({
        count: 1,
        subscriptions: [{id: getDefaultStore().get(projectIdAtom)}],
    })),
}))

vi.mock("../../src/simpleQueue/api", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../src/simpleQueue/api")>()),
    querySimpleQueues: vi.fn(async ({projectId}: {projectId: string}) => ({
        count: 1,
        queues: [{id: projectId}],
    })),
}))

import {toolIntegrationConnectionsAtomFamily} from "../../src/gatewayTool/hooks/useToolIntegrationConnections"
import {
    triggerConnectionsQueryAtom,
    triggerIntegrationConnectionsAtomFamily,
} from "../../src/gatewayTrigger/hooks/useTriggerConnections"
import {triggerSchedulesQueryAtom} from "../../src/gatewayTrigger/hooks/useTriggerSchedules"
import {triggerSubscriptionsQueryAtom} from "../../src/gatewayTrigger/hooks/useTriggerSubscriptions"
import {simpleQueuesListQueryAtom} from "../../src/simpleQueue/state/molecule"

type QueryAtom = Atom<{data?: unknown}>

const store = getDefaultStore()

const firstId = (data: unknown): unknown => {
    const body = data as Record<string, {id?: unknown}[] | undefined> | undefined
    const rows = body?.connections ?? body?.schedules ?? body?.subscriptions ?? body?.queues ?? []
    return rows[0]?.id
}

const readAfterSwitch = async (queryAtom: QueryAtom) => {
    store.set(setProjectIdAtom, "project-a")
    const unsubscribe = store.sub(queryAtom, () => {})
    try {
        await vi.waitFor(() => expect(firstId(store.get(queryAtom).data)).toBe("project-a"))
        store.set(setProjectIdAtom, "project-b")
        await vi.waitFor(() => expect(firstId(store.get(queryAtom).data)).toBe("project-b"))
    } finally {
        unsubscribe()
    }
}

beforeEach(() => {
    store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
    store.set(sessionAtom, true)
})

describe("project-scoped queries after a project switch", () => {
    it.each([
        ["one integration's tool connections", toolIntegrationConnectionsAtomFamily("github")],
        ["trigger connections", triggerConnectionsQueryAtom],
        [
            "one integration's trigger connections",
            triggerIntegrationConnectionsAtomFamily("github"),
        ],
        ["trigger schedules", triggerSchedulesQueryAtom],
        ["trigger subscriptions", triggerSubscriptionsQueryAtom],
        ["simple queues", simpleQueuesListQueryAtom],
    ] as [string, QueryAtom][])("%s show the new project's rows", async (_name, queryAtom) => {
        await readAfterSwitch(queryAtom)
    })
})
