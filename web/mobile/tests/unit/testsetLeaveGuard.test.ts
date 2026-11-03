// @vitest-environment jsdom
import {act, createElement} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {useTestsetLeaveGuard} from "@/features/testsets/detail/useTestsetLeaveGuard"

/** A router that runs the route events the way the Pages Router does on `push`. */
const router = vi.hoisted(() => {
    const handlers = new Map<string, Set<(url: string) => void>>()
    const emit = (name: string, url = "") => {
        for (const handler of [...(handlers.get(name) ?? [])]) handler(url)
    }
    return {
        handlers,
        emit,
        visited: [] as string[],
        push: async (url: string) => {
            emit("routeChangeStart", url)
            router.visited.push(url)
            emit("routeChangeComplete", url)
        },
    }
})

vi.mock("next/router", () => ({
    useRouter: () => ({
        push: router.push,
        events: {
            on: (name: string, handler: (url: string) => void) => {
                const set = router.handlers.get(name) ?? new Set()
                set.add(handler)
                router.handlers.set(name, set)
            },
            off: (name: string, handler: (url: string) => void) =>
                router.handlers.get(name)?.delete(handler),
            emit: (name: string) => router.emit(name),
        },
    }),
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let leave: ((url: string) => void) | null = null

function Probe({dirty}: {dirty: boolean}) {
    const guard = useTestsetLeaveGuard({dirty, isNew: false, onSave: vi.fn(), onDiscard: vi.fn()})
    leave = guard.leave
    return guard.prompt
}

describe("useTestsetLeaveGuard", () => {
    let root: Root
    let host: HTMLDivElement

    const render = (dirty: boolean) => act(() => root.render(createElement(Probe, {dirty})))

    beforeEach(() => {
        router.handlers.clear()
        router.visited = []
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    it("A leave with no changes does not let a later change leave without the prompt", async () => {
        render(false)
        await act(async () => leave?.("/testsets/next-revision"))
        expect(router.visited).toEqual(["/testsets/next-revision"])

        // The same page stays mounted on the new revision, and the reader edits it.
        render(true)
        await act(async () => {
            await router.push("/somewhere-else").catch(() => undefined)
        })

        expect(router.visited).toEqual(["/testsets/next-revision"])
        expect(document.body.textContent).toContain("Discard changes")
    })
})
