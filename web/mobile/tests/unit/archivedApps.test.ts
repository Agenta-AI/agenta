// @vitest-environment jsdom
import {act, createElement} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const api = vi.hoisted(() => ({queryWorkflows: vi.fn(), ensureAgentFlags: vi.fn()}))
vi.mock("@agenta/entities/workflow", async (original) => ({
    ...(await original<object>()),
    queryWorkflows: (...args: unknown[]) => api.queryWorkflows(...args),
    ensureAgentFlags: (...args: unknown[]) => api.ensureAgentFlags(...args),
}))

import {ARCHIVED_APPS_QUERY_KEY, useArchivedApps} from "@/features/archived-apps/useArchivedApps"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const workflow = (id: string, deletedAt: string | null) => ({
    id,
    name: id,
    deleted_at: deletedAt,
})

let host: HTMLDivElement
let root: Root
let client: QueryClient
let seen: ReturnType<typeof useArchivedApps>

const Probe = ({search}: {search: string}) => {
    seen = useArchivedApps({projectId: "p1", search})
    return null
}

const render = async (search = "") => {
    await act(async () => {
        root.render(createElement(QueryClientProvider, {client}, createElement(Probe, {search})))
    })
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
    })
}

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    api.queryWorkflows.mockReset()
    api.ensureAgentFlags.mockReset()
    api.ensureAgentFlags.mockResolvedValue(new Map([["agent-1", true]]))
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

describe("archived apps query", () => {
    it("Archived apps list keeps archived non-agent workflows only", async () => {
        api.queryWorkflows.mockResolvedValue({
            workflows: [
                workflow("app-1", "2026-10-01T00:00:00Z"),
                workflow("agent-1", "2026-10-02T00:00:00Z"),
                workflow("live-1", null),
            ],
        })
        await render()
        expect(seen.apps.map((app) => app.id)).toEqual(["app-1"])
    })

    it("Archived apps list is sorted by archive date, newest first", async () => {
        api.queryWorkflows.mockResolvedValue({
            workflows: [
                workflow("old", "2026-09-01T00:00:00Z"),
                workflow("new", "2026-10-05T00:00:00Z"),
                workflow("mid", "2026-09-20T00:00:00Z"),
            ],
        })
        await render()
        expect(seen.apps.map((app) => app.id)).toEqual(["new", "mid", "old"])
    })

    it("Archived apps search term is sent as the name filter", async () => {
        api.queryWorkflows.mockResolvedValue({workflows: []})
        await render("bot")
        expect(api.queryWorkflows).toHaveBeenCalledWith(
            expect.objectContaining({
                projectId: "p1",
                name: "bot",
                includeArchived: true,
                flags: {is_evaluator: false},
            }),
        )
    })

    it("Archived apps query key sits under workflows so a restore refreshes it", async () => {
        api.queryWorkflows.mockResolvedValue({workflows: []})
        await render("bot")
        expect(ARCHIVED_APPS_QUERY_KEY("p1", "bot").slice(0, 2)).toEqual([
            "workflows",
            "archived-apps",
        ])
        await act(async () => {
            await client.invalidateQueries({queryKey: ["workflows"]})
        })
        expect(api.queryWorkflows).toHaveBeenCalledTimes(2)
    })
})
