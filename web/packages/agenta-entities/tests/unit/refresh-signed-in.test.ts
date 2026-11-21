import {QueryClient} from "@tanstack/react-query"
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

describe("refreshSignedInAtom", () => {
    it("is true when the refreshed list shows the connection signed in", async () => {
        client.setQueryData(KEY, [row("ready")])
        await expect(createStore().set(refreshSignedInAtom, "s1")).resolves.toBe(true)
    })

    it("finds an organization connection that only the organization list holds", async () => {
        client.setQueryData(KEY, [])
        client.setQueryData(["vault", "organization-secrets", "u1", "p1"], [row("ready")])
        await expect(createStore().set(refreshSignedInAtom, "s1")).resolves.toBe(true)
        client.removeQueries({queryKey: ["vault", "organization-secrets"]})
    })

    it("is false when the list still shows it waiting for a sign-in", async () => {
        client.setQueryData(KEY, [row("pending_login")])
        await expect(createStore().set(refreshSignedInAtom, "s1")).resolves.toBe(false)
    })
})
