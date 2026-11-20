import {atom, createStore} from "jotai"
import {beforeEach, describe, expect, it, vi} from "vitest"

const billing = vi.hoisted(() => ({enabled: false}))

vi.mock("@agenta/shared/api", () => ({
    axios: {get: vi.fn()},
    getAgentaApiUrl: () => "",
    isBillingEnabled: () => billing.enabled,
}))
vi.mock("@agenta/shared/state", async () => ({projectIdAtom: (await import("jotai")).atom("p")}))
vi.mock("jotai-tanstack-query", () => ({
    atomWithQuery: () =>
        atom({
            data: {
                version: "v0.1.0",
                releases: [
                    {
                        id: "v999.0.0",
                        date: "2030-01-01",
                        features: [
                            {id: "f", title: "New", body: "", link: "https://agenta.ai/docs"},
                        ],
                        improvements: [],
                        fixes: [],
                        securityFix: true,
                    },
                ],
                notices: [],
            },
        }),
}))

const {notInstalledReleasesAtom, releaseListAtom, securityReleaseAtom} =
    await import("../../src/releases/state")

describe("upgrade signals", () => {
    beforeEach(() => {
        billing.enabled = false
    })

    it("lists the newer release and its security fix on a self-hosted instance", () => {
        const store = createStore()
        expect(store.get(notInstalledReleasesAtom)[0]?.id).toBe("v999.0.0")
        expect(store.get(securityReleaseAtom)?.id).toBe("v999.0.0")
    })

    it("shows the release notes on cloud, but no upgrade and no security warning", () => {
        billing.enabled = true
        const store = createStore()
        expect(store.get(releaseListAtom)[0]?.id).toBe("v999.0.0")
        expect(store.get(notInstalledReleasesAtom)).toEqual([])
        expect(store.get(securityReleaseAtom)).toBeNull()
    })
})
