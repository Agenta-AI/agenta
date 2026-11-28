// @vitest-environment jsdom
//
// Next passes `routeChangeStart` the URL with the `/m` basePath on it. The guard retries that
// navigation after the confirm, so it must push the URL without the basePath, or Next adds it again
// and lands on `/m/m/...` (a 404).
import {act, createElement} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

const {router, handlers} = vi.hoisted(() => {
    const handlers = new Map<string, Set<(...args: unknown[]) => void>>()
    const router = {
        basePath: "/m",
        asPath: "/w/ws/p/proj/automations/a1",
        push: vi.fn(() => Promise.resolve(true)),
        events: {
            on: (name: string, fn: (...args: unknown[]) => void) => {
                if (!handlers.has(name)) handlers.set(name, new Set())
                handlers.get(name)!.add(fn)
            },
            off: (name: string, fn: (...args: unknown[]) => void) => handlers.get(name)?.delete(fn),
            emit: (name: string, ...args: unknown[]) =>
                handlers.get(name)?.forEach((fn) => fn(...args)),
        },
    }
    return {router, handlers}
})

vi.mock("next/router", () => ({useRouter: () => router}))

import {useUnsavedGuard} from "@/features/automations/useUnsavedGuard"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let root: Root | undefined

afterEach(() => {
    act(() => root?.unmount())
    root = undefined
    handlers.clear()
    vi.clearAllMocks()
})

describe("useUnsavedGuard", () => {
    it("retries the navigation without the basePath after the confirm", () => {
        let onOk: (() => void) | undefined
        const confirm = vi.fn((request: {onOk: () => void}) => {
            onOk = request.onOk
        })
        const Probe = () => {
            useUnsavedGuard({dirty: true, confirm, title: "t", message: "m"})
            return null
        }
        act(() => {
            root = createRoot(document.createElement("div"))
            root.render(createElement(Probe))
        })

        expect(() =>
            router.events.emit("routeChangeStart", "/m/w/ws/p/proj/apps/app/variants", {
                shallow: false,
            }),
        ).toThrow()
        expect(confirm).toHaveBeenCalledOnce()

        onOk?.()
        expect(router.push).toHaveBeenCalledWith("/w/ws/p/proj/apps/app/variants")
    })

    it("after Back, puts the page's address back while it asks", async () => {
        const confirm = vi.fn()
        const Probe = () => {
            useUnsavedGuard({dirty: true, confirm, title: "t", message: "m"})
            return null
        }
        act(() => {
            root = createRoot(document.createElement("div"))
            root.render(createElement(Probe))
        })
        // Back has moved the browser to the previous entry before the router hears of it.
        window.history.replaceState(null, "", "/m/w/ws/p/proj/automations")
        expect(() =>
            router.events.emit("routeChangeStart", "/m/w/ws/p/proj/automations", {
                shallow: false,
            }),
        ).toThrow()
        expect(confirm).toHaveBeenCalledOnce()
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(router.push).toHaveBeenCalledWith("/w/ws/p/proj/automations/a1", undefined, {
            shallow: true,
        })
    })

    it("after a link click, leaves the address alone while it asks", async () => {
        const confirm = vi.fn()
        const Probe = () => {
            useUnsavedGuard({dirty: true, confirm, title: "t", message: "m"})
            return null
        }
        act(() => {
            root = createRoot(document.createElement("div"))
            root.render(createElement(Probe))
        })
        window.history.replaceState(null, "", "/m/w/ws/p/proj/automations/a1")
        expect(() =>
            router.events.emit("routeChangeStart", "/m/settings", {shallow: false}),
        ).toThrow()
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(router.push).not.toHaveBeenCalled()
    })
})
