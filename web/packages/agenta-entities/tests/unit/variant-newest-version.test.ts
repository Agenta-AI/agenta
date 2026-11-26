/**
 * The commit dialog numbers the next revision after the variant's newest one. The server counts
 * archived revisions too, so the newest version is read with them.
 */
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

const {postMock} = vi.hoisted(() => ({postMock: vi.fn()}))

vi.mock("@agenta/shared/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/shared/api")>()
    return {
        ...actual,
        axios: Object.assign(Object.create(actual.axios), {post: postMock}),
        getAgentaApiUrl: () => "https://agenta.test/api",
    }
})

import {workflowVariantNewestVersionAtomFamily} from "../../src/workflow/state/store"

const settledValue = async (variantId: string) => {
    const store = createStore()
    store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
    store.set(projectIdAtom, "proj-1")
    store.set(sessionAtom, true)
    const target = workflowVariantNewestVersionAtomFamily(variantId)
    const unsubscribe = store.sub(target, () => undefined)
    await vi.waitFor(() => expect(postMock).toHaveBeenCalled())
    await vi.waitFor(() => expect(store.get(target)).not.toBeUndefined())
    const value = store.get(target)
    unsubscribe()
    return value
}

describe("workflowVariantNewestVersionAtomFamily", () => {
    beforeEach(() => postMock.mockReset())

    it("asks for the variant's newest revision, archived ones included", async () => {
        postMock.mockResolvedValue({
            data: {count: 1, workflow_revisions: [{id: "rev-10", version: "10"}]},
        })

        expect(await settledValue("variant-1")).toBe(10)
        expect(postMock).toHaveBeenCalledWith(
            "https://agenta.test/api/workflows/revisions/query",
            {
                workflow_variant_refs: [{id: "variant-1"}],
                include_archived: true,
                windowing: {limit: 1},
            },
            {params: {project_id: "proj-1"}},
        )
    })

    it("is null when the variant has no revision", async () => {
        postMock.mockResolvedValue({data: {count: 0, workflow_revisions: []}})

        expect(await settledValue("variant-2")).toBeNull()
    })
})
