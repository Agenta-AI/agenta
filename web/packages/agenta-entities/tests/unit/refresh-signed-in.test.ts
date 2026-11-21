import {projectIdAtom, userAtom} from "@agenta/shared/state"
import {QueryClient, QueryObserver} from "@tanstack/react-query"
import {createStore} from "jotai"
import {afterEach, describe, expect, it, vi} from "vitest"

const client = new QueryClient({defaultOptions: {queries: {retry: false}}})

vi.mock("@agenta/shared/api", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/shared/api")>()),
    getHostQueryClient: () => client,
}))

import {refreshSignedInAtom} from "../../src/secret/state/subscriptionLogin"

const PROJECT = ["vault", "secrets", "u1", "p1"]
const ORGANIZATION = ["vault", "organization-secrets", "u1", "p1"]
const row = (loginState: string) => ({id: "s1", subscription: {provider: "chatgpt", loginState}})

const store = () => {
    const created = createStore()
    created.set(userAtom, {id: "u1"} as never)
    created.set(projectIdAtom, "p1")
    return created
}

const stops: (() => void)[] = []

/** A list a page is reading: an observer keeps the query active. */
const watch = async (queryKey: unknown[], queryFn: () => Promise<unknown>) => {
    const observer = new QueryObserver(client, {queryKey, queryFn})
    stops.push(observer.subscribe(() => undefined))
    await vi.waitFor(() => expect(observer.getCurrentResult().isFetched).toBe(true))
}

/** A list no page reads now: it is in the cache with its fetch, but no observer. */
const cacheOnly = async (queryKey: unknown[], queryFn: () => Promise<unknown>) => {
    await client.prefetchQuery({queryKey, queryFn})
}

afterEach(() => {
    stops.splice(0).forEach((stop) => stop())
    client.clear()
})

describe("refreshSignedInAtom", () => {
    it("waits for the refetch and reads the fresh list", async () => {
        const queryFn = vi
            .fn()
            .mockResolvedValueOnce([row("pending_login")])
            .mockImplementationOnce(
                () => new Promise((resolve) => setTimeout(() => resolve([row("ready")]), 20)),
            )
        await watch(PROJECT, queryFn)

        await expect(store().set(refreshSignedInAtom, "s1")).resolves.toBe(true)
        expect(queryFn).toHaveBeenCalledTimes(2)
    })

    it("is false when the list still shows it waiting for a sign-in", async () => {
        await watch(PROJECT, async () => [row("pending_login")])
        await expect(store().set(refreshSignedInAtom, "s1")).resolves.toBe(false)
    })

    it("is false when the refetch fails, even over a list that read ready before", async () => {
        const queryFn = vi
            .fn()
            .mockResolvedValueOnce([row("ready")])
            .mockRejectedValueOnce(new Error("offline"))
        await watch(PROJECT, queryFn)

        await expect(store().set(refreshSignedInAtom, "s1")).resolves.toBe(false)
        expect(queryFn).toHaveBeenCalledTimes(2)
    })

    it("fetches the organization list too when no page reads it, and finds the connection there", async () => {
        await watch(PROJECT, async () => [])
        const organization = vi
            .fn()
            .mockResolvedValueOnce([row("pending_login")])
            .mockResolvedValueOnce([row("ready")])
        await cacheOnly(ORGANIZATION, organization)

        await expect(store().set(refreshSignedInAtom, "s1")).resolves.toBe(true)
        expect(organization).toHaveBeenCalledTimes(2)
    })

    it("does not read another project's list", async () => {
        await watch(PROJECT, async () => [])
        await watch(["vault", "secrets", "u1", "p2"], async () => [row("ready")])
        await expect(store().set(refreshSignedInAtom, "s1")).resolves.toBe(false)
    })
})
