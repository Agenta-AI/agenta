import {QueryClient} from "@tanstack/react-query"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

// The assertion is client-only and dev-only; the node test env has neither.
const originalWindow = (globalThis as {window?: unknown}).window
const originalNodeEnv = process.env.NODE_ENV

const loadQueryClientModule = async () => {
    vi.resetModules()
    return await import("../../src/api/queryClient")
}

describe("assertHostQueryClient", () => {
    beforeEach(() => {
        ;(globalThis as {window?: unknown}).window = {}
        process.env.NODE_ENV = "development"
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
        if (originalWindow === undefined) delete (globalThis as {window?: unknown}).window
        else (globalThis as {window?: unknown}).window = originalWindow
        process.env.NODE_ENV = originalNodeEnv
    })

    it("stays silent when the host installed the shared singleton", async () => {
        const {queryClient, assertHostQueryClient} = await loadQueryClientModule()
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined)

        assertHostQueryClient(() => queryClient)
        vi.runAllTimers()

        expect(error).not.toHaveBeenCalled()
    })

    it("reports a host that installed a rival client", async () => {
        const {assertHostQueryClient} = await loadQueryClientModule()
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined)
        const rival = new QueryClient()

        assertHostQueryClient(() => rival)
        vi.runAllTimers()

        expect(error).toHaveBeenCalledOnce()
        expect(error.mock.calls[0][0]).toContain("Host QueryClient mismatch")
    })

    it("does not flag a host that hydrates late", async () => {
        const {queryClient, assertHostQueryClient} = await loadQueryClientModule()
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined)
        let hydrated = false

        assertHostQueryClient(() => (hydrated ? queryClient : new QueryClient()))
        vi.advanceTimersByTime(1)
        hydrated = true
        vi.runAllTimers()

        expect(error).not.toHaveBeenCalled()
    })

    it("checks only once", async () => {
        const {assertHostQueryClient} = await loadQueryClientModule()
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined)
        const rival = new QueryClient()

        assertHostQueryClient(() => rival)
        assertHostQueryClient(() => rival)
        vi.runAllTimers()

        expect(error).toHaveBeenCalledOnce()
    })

    it("does not run in production", async () => {
        process.env.NODE_ENV = "production"
        const {assertHostQueryClient} = await loadQueryClientModule()
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined)

        assertHostQueryClient(() => new QueryClient())
        vi.runAllTimers()

        expect(error).not.toHaveBeenCalled()
    })
})

/**
 * The tests above call `assertHostQueryClient` directly, which leaves the accessor every package
 * write actually goes through untested. `getHostQueryClient()` reads `queryClientAtom` from the
 * default jotai store — that read is the contract, so it gets its own coverage.
 */
describe("getHostQueryClient", () => {
    it("returns whatever the host hydrated into queryClientAtom", async () => {
        const {getDefaultStore} = await import("jotai")
        const {queryClientAtom} = await import("jotai-tanstack-query")
        const {getHostQueryClient} = await import("../../src/api/hostQueryClient")

        const hostClient = new QueryClient()
        getDefaultStore().set(queryClientAtom, hostClient)

        expect(getHostQueryClient()).toBe(hostClient)
    })

    it("follows the atom when the host swaps its client", async () => {
        const {getDefaultStore} = await import("jotai")
        const {queryClientAtom} = await import("jotai-tanstack-query")
        const {getHostQueryClient} = await import("../../src/api/hostQueryClient")

        const first = new QueryClient()
        const second = new QueryClient()
        const store = getDefaultStore()

        store.set(queryClientAtom, first)
        expect(getHostQueryClient()).toBe(first)

        // Resolved per call, never cached at module scope — that is what makes a late
        // hydration work instead of pinning the first client forever.
        store.set(queryClientAtom, second)
        expect(getHostQueryClient()).toBe(second)
    })
})
