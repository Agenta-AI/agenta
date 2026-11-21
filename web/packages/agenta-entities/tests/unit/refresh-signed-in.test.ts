import {projectIdAtom, userAtom} from "@agenta/shared/state"
import {QueryClient, QueryObserver} from "@tanstack/react-query"
import {createStore} from "jotai"
import {describe, expect, it, vi} from "vitest"

const client = new QueryClient({defaultOptions: {queries: {retry: false}}})

vi.mock("@agenta/shared/api", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/shared/api")>()),
    getHostQueryClient: () => client,
}))

import {refreshSignedInAtom} from "../../src/secret/state/subscriptionLogin"

const KEY = ["vault", "secrets", "u1", "p1"]
const row = (loginState: string) => ({id: "s1", subscription: {provider: "chatgpt", loginState}})

const store = () => {
    const created = createStore()
    created.set(userAtom, {id: "u1"} as never)
    created.set(projectIdAtom, "p1")
    return created
}

describe("refreshSignedInAtom", () => {
    it("is true when the refreshed list shows the connection signed in", async () => {
        client.setQueryData(KEY, [row("ready")])
        await expect(store().set(refreshSignedInAtom, "s1")).resolves.toBe(true)
    })

    it("finds an organization connection that only the organization list holds", async () => {
        client.setQueryData(KEY, [])
        client.setQueryData(["vault", "organization-secrets", "u1", "p1"], [row("ready")])
        await expect(store().set(refreshSignedInAtom, "s1")).resolves.toBe(true)
        client.removeQueries({queryKey: ["vault", "organization-secrets"]})
    })

    it("does not read another project's list", async () => {
        client.setQueryData(KEY, [])
        client.setQueryData(["vault", "secrets", "u1", "p2"], [row("ready")])
        await expect(store().set(refreshSignedInAtom, "s1")).resolves.toBe(false)
        client.removeQueries({queryKey: ["vault", "secrets", "u1", "p2"]})
    })

    it("is false when the list still shows it waiting for a sign-in", async () => {
        client.setQueryData(KEY, [row("pending_login")])
        await expect(store().set(refreshSignedInAtom, "s1")).resolves.toBe(false)
    })

    describe("with a list a page is reading", () => {
        const watch = (queryFn: () => Promise<unknown>) => {
            client.removeQueries({queryKey: KEY})
            const observer = new QueryObserver(client, {queryKey: KEY, queryFn})
            const stop = observer.subscribe(() => undefined)
            return {observer, stop}
        }

        it("waits for the refetch and reads the fresh list", async () => {
            const queryFn = vi
                .fn()
                .mockResolvedValueOnce([row("pending_login")])
                .mockImplementationOnce(
                    () => new Promise((resolve) => setTimeout(() => resolve([row("ready")]), 20)),
                )
            const {observer, stop} = watch(queryFn)
            await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true))

            await expect(store().set(refreshSignedInAtom, "s1")).resolves.toBe(true)
            expect(queryFn).toHaveBeenCalledTimes(2)
            stop()
        })

        it("is false when the refetch fails, even over a list that read ready before", async () => {
            const queryFn = vi
                .fn()
                .mockResolvedValueOnce([row("ready")])
                .mockRejectedValueOnce(new Error("offline"))
            const {observer, stop} = watch(queryFn)
            await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true))

            await expect(store().set(refreshSignedInAtom, "s1")).resolves.toBe(false)
            expect(queryFn).toHaveBeenCalledTimes(2)
            stop()
        })
    })
})
