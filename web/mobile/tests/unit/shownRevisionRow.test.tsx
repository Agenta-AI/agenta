// @vitest-environment jsdom
// The row for the revision open in the drawer, built from the real workflow atoms. Only HTTP is mocked.
import {act, createElement} from "react"

import {workflowIncludeArchivedAtom} from "@agenta/entities/workflow"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const http = vi.hoisted(() => ({post: vi.fn()}))
vi.mock("@agenta/shared/api", async (original) => {
    const actual = await original<typeof import("@agenta/shared/api")>()
    return {...actual, axios: {...actual.axios, post: http.post}}
})

import {useShownRevisionRow} from "@/features/variants/useShownRevisionRow"
import type {AppRevisionRow} from "@/features/variants/useAppRevisions"

let root: Root | undefined
let latest: AppRevisionRow | null | undefined

const Probe = () => {
    latest = useShownRevisionRow({revisionId: "rev-old", appId: "app-1", rows: []})
    return null
}

const flush = async () => {
    for (let tick = 0; tick < 6; tick++) await act(() => new Promise((r) => setTimeout(r, 10)))
}

let releaseVariants: (() => void) | undefined

const mount = async (variants: unknown[]) => {
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
    const store = createStore()
    store.set(queryClientAtom, queryClient)
    store.set(projectIdAtom, "p-1")
    store.set(sessionAtom, true)
    store.set(workflowIncludeArchivedAtom, false)
    http.post.mockImplementation(async (url: string) => {
        if (url.endsWith("/workflows/revisions/query")) {
            return {
                data: {
                    count: 1,
                    workflow_revisions: [
                        {
                            id: "rev-old",
                            name: "default",
                            version: 3,
                            workflow_id: "app-1",
                            workflow_variant_id: "var-1",
                        },
                    ],
                },
            }
        }
        if (url.endsWith("/workflows/variants/query")) {
            await new Promise<void>((resolve) => {
                releaseVariants = resolve
                if (variants.length === 0) resolve()
            })
            return {data: {count: variants.length, workflow_variants: variants}}
        }
        return {data: {}}
    })
    await act(async () => {
        root = createRoot(document.createElement("div"))
        root.render(createElement(Provider, {store}, createElement(Probe)))
    })
    await flush()
}

afterEach(() => {
    act(() => root?.unmount())
    root = undefined
    latest = undefined
    releaseVariants = undefined
    http.post.mockReset()
})

describe("useShownRevisionRow", () => {
    it("waits for the variants instead of naming the variant after the revision", async () => {
        await mount([{id: "var-1", name: "Chat"}])
        expect(latest).toBeNull()
        await act(async () => releaseVariants?.())
        await flush()
        expect(latest?.variantName).toBe("Chat")
    })

    it("names a variant the list does not hold plainly, never by the revision name", async () => {
        await mount([])
        expect(latest?.variantName).toBe("Unknown variant")
    })
})
