// @vitest-environment jsdom
/**
 * The deploy and revert writes over the real publish mutation. Only the HTTP client is replaced,
 * so each test checks the environment commit body that would reach the server.
 */
import {act} from "react"

import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {useDeployRevision, useRevertDeployment} from "@/features/variants/useDeploymentWrites"

const http = vi.hoisted(() => ({get: vi.fn(), post: vi.fn(), put: vi.fn()}))

vi.mock("@agenta/shared/api", async (original) => ({
    ...(await original<object>()),
    axios: http,
}))
vi.mock("@agenta/ui/app-message", () => ({message: {success: vi.fn(), error: vi.fn()}}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const PROJECT = "project-1"
const TARGET = {
    revisionId: "rev-1",
    revisionVersion: 1,
    appId: "app-1",
    appSlug: "capitals",
    variantId: "variant-1",
    variantSlug: "capitals.default",
}

describe("Deploy note", () => {
    let root: Root
    let writes: {
        deploy: ReturnType<typeof useDeployRevision>
        revert: ReturnType<typeof useRevertDeployment>
    }

    const Probe = () => {
        writes = {deploy: useDeployRevision(), revert: useRevertDeployment()}
        return null
    }

    const sentMessages = () =>
        http.post.mock.calls
            .filter(([url]) => String(url).endsWith("/environments/revisions/commit"))
            .map(
                ([, body]) =>
                    (body as {environment_revision: {message?: string}}).environment_revision
                        .message,
            )

    beforeEach(() => {
        const store = getDefaultStore()
        const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
        queryClient.setQueryData(["environments-list", PROJECT, false], {
            count: 1,
            environments: [
                {
                    id: "env-1",
                    slug: "development",
                    name: "development",
                    variant_id: "env-variant-1",
                    data: {references: {}},
                },
            ],
        })
        store.set(queryClientAtom, queryClient)
        store.set(projectIdAtom, PROJECT)
        store.set(sessionAtom, true)
        http.post.mockReset()
        http.post.mockResolvedValue({data: {count: 1, environment_revision: null}})
        root = createRoot(document.createElement("div"))
        act(() => root.render(<Probe />))
    })
    afterEach(() => act(() => root.unmount()))

    it("An empty note stays empty, as in /w, not the raw app key", async () => {
        await act(async () => {
            await writes.deploy({
                target: TARGET,
                environmentSlug: "development",
                successText: "Published",
                note: "   ",
            })
            await writes.revert({
                target: TARGET,
                environmentSlug: "development",
                environmentName: "development",
                note: "",
            })
        })
        expect(sentMessages()).toEqual(["", ""])
    })

    it("A written note is sent trimmed", async () => {
        await act(async () => {
            await writes.deploy({
                target: TARGET,
                environmentSlug: "development",
                successText: "Published",
                note: "  First release ",
            })
        })
        expect(sentMessages()).toEqual(["First release"])
    })
})
