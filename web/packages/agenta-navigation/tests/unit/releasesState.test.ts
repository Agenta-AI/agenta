import {atom, createStore} from "jotai"
import {beforeEach, describe, expect, it, vi} from "vitest"

const billing = vi.hoisted(() => ({enabled: false}))
const method = vi.hoisted(() => ({value: "compose" as unknown}))
const feed = vi.hoisted(() => ({empty: false}))

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
                get deployment_method() {
                    return method.value
                },
                get releases() {
                    return feed.empty ? [] : this.newer
                },
                newer: [
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

const {
    notInstalledReleasesAtom,
    releaseListAtom,
    securityReleaseAtom,
    updateSizeAtom,
    upgradeMethodAtom,
} = await import("../../src/releases/state")

describe("upgrade signals", () => {
    beforeEach(() => {
        billing.enabled = false
        method.value = "compose"
        feed.empty = false
    })

    it("lists the newer release and its security fix on a self-hosted instance", () => {
        const store = createStore()
        expect(store.get(notInstalledReleasesAtom)[0]?.id).toBe("v999.0.0")
        expect(store.get(securityReleaseAtom)?.id).toBe("v999.0.0")
        expect(store.get(updateSizeAtom)).toBe("security")
        expect(store.get(upgradeMethodAtom)).toBe("compose")
    })

    it.each([
        ["helm", "helm"],
        ["railway", "railway"],
        ["docker", null],
        ["kubernetes", null],
        [null, null],
        [42, null],
    ])("reads the deployment method %s as %s", (value, expected) => {
        method.value = value
        expect(createStore().get(upgradeMethodAtom)).toBe(expected)
    })

    it("shows no upgrade and no security warning without the feed", () => {
        feed.empty = true
        const store = createStore()
        expect(store.get(notInstalledReleasesAtom)).toEqual([])
        expect(store.get(securityReleaseAtom)).toBeNull()
        expect(store.get(updateSizeAtom)).toBeNull()
    })

    it("shows the release notes on cloud, but no upgrade and no security warning", () => {
        billing.enabled = true
        const store = createStore()
        expect(store.get(releaseListAtom)[0]?.id).toBe("v999.0.0")
        expect(store.get(notInstalledReleasesAtom)).toEqual([])
        expect(store.get(securityReleaseAtom)).toBeNull()
        expect(store.get(updateSizeAtom)).toBeNull()
        expect(store.get(upgradeMethodAtom)).toBeNull()
    })
})
