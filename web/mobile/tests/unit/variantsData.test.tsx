// @vitest-environment jsdom
// The variants data hooks: the revisions query, and the deploy and revert writes.
import {act, createElement, type ReactNode} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const fixture = vi.hoisted(() => ({
    queryRevisions: vi.fn(),
    queryVariants: vi.fn(),
    publish: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
}))

vi.mock("@agenta/entities/workflow", () => ({
    queryWorkflowRevisionsByWorkflow: fixture.queryRevisions,
    queryWorkflowVariants: fixture.queryVariants,
    pickModelName: () => "",
}))
vi.mock("@agenta/entities/environment", () => ({
    environmentsListQueryAtomFamily: () => ({id: "environments"}),
    fetchEnvironmentRevisionsList: vi.fn(),
    buildAppDeploymentHistory: vi.fn(),
}))
vi.mock("@agenta/entities/runnable", () => ({publishMutationAtom: {id: "publish"}}))
vi.mock("jotai", () => ({
    useAtomValue: (atom: {id: string}) =>
        atom.id === "publish" ? {mutateAsync: fixture.publish} : {data: undefined},
}))
vi.mock("@agenta/ui/app-message", () => ({
    message: {success: fixture.success, error: fixture.error},
}))

import {useAppRevisions, type AppRevisionRow} from "@/features/variants/useAppRevisions"
import {
    useDeployRevision,
    useRevertDeployment,
    type DeployTarget,
} from "@/features/variants/useDeploymentWrites"

let root: Root | undefined

const render = (element: ReactNode) => {
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    act(() => {
        root = createRoot(document.createElement("div"))
        root.render(createElement(QueryClientProvider, {client}, element))
    })
}

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)))

afterEach(() => {
    act(() => root?.unmount())
    root = undefined
    vi.clearAllMocks()
})

const revision = (id: string, version: number) => ({
    id,
    version,
    workflow_id: "app-1",
    workflow_variant_id: "var-1",
    message: "note",
    created_by_id: "u-1",
    created_at: "2025-01-01T00:00:00Z",
})

const target: DeployTarget = {
    revisionId: "rev-2",
    revisionVersion: 2,
    appId: "app-1",
    appSlug: "alpha",
    variantId: "var-1",
    variantSlug: "alpha.first",
}

describe("useAppRevisions", () => {
    let latest: ReturnType<typeof useAppRevisions> | undefined
    const Probe = ({search}: {search: string}) => {
        latest = useAppRevisions({projectId: "p-1", appId: "app-1", search})
        return null
    }

    it("Revisions are requested newest first with the search as the name filter", async () => {
        fixture.queryVariants.mockResolvedValue({workflow_variants: [{id: "var-1", name: "First"}]})
        fixture.queryRevisions.mockResolvedValue({
            workflow_revisions: [revision("rev-2", 2), revision("rev-0", 0)],
            windowing: {next: null},
        })
        render(createElement(Probe, {search: "chat"}))
        await flush()
        expect(fixture.queryRevisions).toHaveBeenCalledWith(
            "app-1",
            "p-1",
            undefined,
            {next: null, limit: 50, order: "descending"},
            "chat",
        )
        expect(latest?.rows.map((row: AppRevisionRow) => [row.revisionId, row.variantName])).toEqual(
            [["rev-2", "First"]],
        )
    })

    it("Load more sends the cursor the server returned", async () => {
        fixture.queryVariants.mockResolvedValue({workflow_variants: []})
        fixture.queryRevisions.mockResolvedValueOnce({
            workflow_revisions: [revision("rev-3", 3)],
            windowing: {next: "cursor-1"},
        })
        fixture.queryRevisions.mockResolvedValueOnce({
            workflow_revisions: [revision("rev-2", 2)],
            windowing: {next: null},
        })
        render(createElement(Probe, {search: ""}))
        await flush()
        expect(latest?.hasMore).toBe(true)
        await act(async () => {
            await latest?.loadMore()
        })
        await flush()
        expect(fixture.queryRevisions.mock.calls[1][3]).toMatchObject({next: "cursor-1"})
        expect(latest?.rows).toHaveLength(2)
    })
})

describe("deployment writes", () => {
    let deploy: ReturnType<typeof useDeployRevision> | undefined
    let revert: ReturnType<typeof useRevertDeployment> | undefined
    const Probe = () => {
        deploy = useDeployRevision()
        revert = useRevertDeployment()
        return null
    }

    it("Deploy sends the environment slug, not its name", async () => {
        fixture.publish.mockResolvedValue(undefined)
        render(createElement(Probe))
        const ok = await deploy?.({
            target,
            environmentSlug: "prod-eu",
            successText: "Published First to Production",
            note: " go ",
        })
        expect(ok).toBe(true)
        expect(fixture.publish).toHaveBeenCalledWith(
            expect.objectContaining({
                environmentSlug: "prod-eu",
                revisionId: "rev-2",
                applicationId: "app-1",
                note: "go",
            }),
        )
        expect(fixture.success).toHaveBeenCalledWith("Published First to Production")
    })

    it("A failed deploy reports false and shows Couldn't deploy this revision", async () => {
        fixture.publish.mockRejectedValue(new Error('Environment "x" has no variant_id'))
        vi.spyOn(console, "error").mockImplementation(() => undefined)
        render(createElement(Probe))
        const ok = await deploy?.({target, environmentSlug: "x", successText: "", note: ""})
        expect(ok).toBe(false)
        expect(fixture.error).toHaveBeenCalledWith("Couldn't deploy this revision")
    })

    it("Revert re-publishes the row's app revision to the selected environment", async () => {
        fixture.publish.mockResolvedValue(undefined)
        render(createElement(Probe))
        const ok = await revert?.({
            target: {...target, revisionId: "rev-1", revisionVersion: 1},
            environmentSlug: "development",
            environmentName: "Development",
            note: "back",
        })
        expect(ok).toBe(true)
        expect(fixture.publish).toHaveBeenCalledWith(
            expect.objectContaining({revisionId: "rev-1", environmentSlug: "development"}),
        )
        expect(fixture.success).toHaveBeenCalledWith("Reverted in Development successfully")
    })

    it("A failed revert shows Couldn't revert this deployment", async () => {
        fixture.publish.mockRejectedValue(new Error("boom"))
        vi.spyOn(console, "error").mockImplementation(() => undefined)
        render(createElement(Probe))
        const ok = await revert?.({
            target,
            environmentSlug: "development",
            environmentName: "Development",
            note: "",
        })
        expect(ok).toBe(false)
        expect(fixture.error).toHaveBeenCalledWith("Couldn't revert this deployment")
    })
})
