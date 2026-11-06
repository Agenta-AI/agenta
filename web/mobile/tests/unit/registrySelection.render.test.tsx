// @vitest-environment jsdom
import {act} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {http, all} = vi.hoisted(() => ({
    http: {post: vi.fn()},
    all: {rows: [] as AppRevisionRow[]},
}))

// Only the HTTP layer is fake: the real archive calls from the entities package run.
vi.mock("@agenta/shared/api", async (original) => ({
    ...(await original<object>()),
    axios: http,
    getAgentaApiUrl: () => "https://api.test",
}))
vi.mock("@/features/variants/useAppRevisions", async (original) => ({
    ...(await original<object>()),
    useAppRevisions: () => ({
        rows: all.rows,
        hasMore: false,
        isPending: false,
        isError: false,
        refetch: vi.fn(),
    }),
}))
vi.mock("@/features/revisions/useRevisionParam", () => ({
    useRevisionParam: () => [null, vi.fn()],
}))

import {DeleteSelectionDialog} from "@/features/variants/DeleteSelectionDialog"
import {
    singleSelectedRevision,
    toDeletion,
    toRegistryRows,
    variantRowKey,
} from "@/features/variants/registryRows"
import type {AppRevisionRow} from "@/features/variants/useAppRevisions"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const revision = (id: string, variantId: string, variantName: string, version: number) =>
    ({
        revisionId: id,
        workflowId: "app-1",
        variantId,
        variantName,
        variantSlug: null,
        version,
        model: "mistral/mistral-small-latest",
        message: null,
        createdAt: "2026-11-05T19:32:00Z",
        createdById: null,
    }) satisfies AppRevisionRow

// Newest first, as the server sends them.
const REVISIONS = [
    revision("v5", "verbose", "verbose", 5),
    revision("v4", "verbose", "verbose", 4),
    revision("c3", "default", "Capital finder", 3),
    revision("c2", "default", "Capital finder", 2),
]

describe("the Registry rows in Variants mode", () => {
    it("show one row per variant, its latest revision, and expand to the older ones", () => {
        const closed = toRegistryRows(REVISIONS, "variants", new Set())
        expect(closed.map((row) => [row.key, row.revision.revisionId, row.olderCount])).toEqual([
            [variantRowKey("verbose"), "v5", 1],
            [variantRowKey("default"), "c3", 1],
        ])
        const open = toRegistryRows(REVISIONS, "variants", new Set(["verbose"]))
        expect(open.map((row) => [row.key, row.nested])).toEqual([
            [variantRowKey("verbose"), false],
            ["v4", true],
            [variantRowKey("default"), false],
        ])
    })

    it("delete a whole selected variant, and single revisions of the others", () => {
        const rows = toRegistryRows(REVISIONS, "variants", new Set(["verbose", "default"]))
        const plan = toDeletion(rows, new Set([variantRowKey("verbose"), "v4", "c2"]))
        expect(plan.variants).toEqual([{id: "verbose", name: "verbose"}])
        expect(plan.revisions.map((row) => row.revisionId)).toEqual(["c2"])
    })

    it("deploy only one selected row", () => {
        const rows = toRegistryRows(REVISIONS, "revisions", new Set())
        expect(singleSelectedRevision(rows, new Set(["c3"]))?.revisionId).toBe("c3")
        expect(singleSelectedRevision(rows, new Set(["c3", "v5"]))).toBeNull()
    })
})

describe("deleting a Registry selection", () => {
    let root: Root
    let host: HTMLDivElement

    const mount = (plan: ReturnType<typeof toDeletion>) => {
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
        const client = new QueryClient()
        act(() =>
            root.render(
                <QueryClientProvider client={client}>
                    <DeleteSelectionDialog
                        deletion={plan}
                        projectId="proj-1"
                        appId="app-1"
                        onClose={vi.fn()}
                        onDeleted={vi.fn()}
                    />
                </QueryClientProvider>,
            ),
        )
    }
    const button = (name: string) =>
        Array.from(document.querySelectorAll("button")).find(
            (item) => item.textContent?.trim() === name,
        )

    beforeEach(() => {
        http.post.mockReset().mockResolvedValue({data: {count: 1}})
        all.rows = REVISIONS
    })
    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        document.body.innerHTML = ""
    })

    it("archives the variant, then the revision, with the project id", async () => {
        const rows = toRegistryRows(REVISIONS, "variants", new Set(["default"]))
        mount(toDeletion(rows, new Set([variantRowKey("verbose"), "c2"])))
        expect(document.body.textContent).toContain(
            "You are about to delete verbose (all revisions), Capital finder v2.",
        )
        await act(async () => button("Delete")?.click())
        expect(http.post.mock.calls).toEqual([
            [
                "https://api.test/workflows/variants/verbose/archive",
                {},
                {params: {project_id: "proj-1"}},
            ],
            [
                "https://api.test/workflows/revisions/c2/archive",
                {},
                {params: {project_id: "proj-1"}},
            ],
        ])
    })

    it("refuses to delete every revision of the app", () => {
        const rows = toRegistryRows(REVISIONS, "variants", new Set())
        mount(toDeletion(rows, new Set([variantRowKey("verbose"), variantRowKey("default")])))
        expect(document.body.textContent).toContain("Cannot delete every revision of an app")
        expect(button("Delete")).toBeUndefined()
        expect(http.post).not.toHaveBeenCalled()
    })
})
