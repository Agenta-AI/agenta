// @vitest-environment jsdom
/**
 * The page's stack guard: a navigation with an open form that has edits closes the views first
 * (leaving never asks, the edits drop), then goes on; Back goes on with replace, a link with push.
 */
import {act} from "react"

import {
    defineView,
    useViewForm,
    useViewStack,
    useViewTitle,
    ViewStackHost,
    type ViewChromeProps,
    type ViewStack,
} from "@agenta/ui/view-stack"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const router = vi.hoisted(() => {
    const handlers = new Map<string, Set<(...args: unknown[]) => void>>()
    return {
        handlers,
        asPath: "/agents/a?view=configuration&tab=automations",
        push: vi.fn(async () => true),
        replace: vi.fn(async () => true),
        events: {
            on: (name: string, fn: (...args: unknown[]) => void) => {
                if (!handlers.has(name)) handlers.set(name, new Set())
                handlers.get(name)!.add(fn)
            },
            off: (name: string, fn: (...args: unknown[]) => void) => handlers.get(name)?.delete(fn),
            emit: () => undefined,
        },
    }
})
vi.mock("next/router", () => ({useRouter: () => router}))

const {PageViewStackGuard} = await import("@/features/agent-pages/PageViewStackGuard")
type PageViewStackGuardApi =
    import("@/features/agent-pages/PageViewStackGuard").PageViewStackGuardApi

const Chrome = ({children}: ViewChromeProps) => <div>{children}</div>
const DirtyBody = () => {
    useViewTitle("Morning check")
    useViewForm({dirty: true, valid: true, save: async () => true})
    return null
}
const dirtyView = defineView<Record<string, never>>({
    id: "test.dirty",
    apply: "on_save",
    Component: DirtyBody,
})

let stack: ViewStack
const Root = () => {
    stack = useViewStack()
    return null
}

/** Next calls the listeners and treats a throw as the abort. */
const start = (url: string, shallow = false) => {
    let aborted = false
    for (const fn of router.handlers.get("routeChangeStart") ?? []) {
        try {
            fn(url, {shallow})
        } catch {
            aborted = true
        }
    }
    return aborted
}
let host: HTMLDivElement
let root: Root
let guardRef: {current: PageViewStackGuardApi | null}
beforeEach(async () => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    router.handlers.clear()
    router.push.mockClear()
    router.replace.mockClear()
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    guardRef = {current: null}
    await act(async () =>
        root.render(
            <ViewStackHost chrome={Chrome}>
                <PageViewStackGuard guardRef={guardRef} />
                <Root />
            </ViewStackHost>,
        ),
    )
    await act(async () => void stack.open(dirtyView, {}, {kind: "project"}))
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
    window.history.replaceState(null, "", "/")
})

describe("PageViewStackGuard", () => {
    it("lets Back go on with replace, with no question, and closes the views", async () => {
        window.history.replaceState(null, "", "/m/agents/a?view=configuration&tab=agent")
        let aborted = false
        await act(async () => {
            aborted = start("/m/agents/a?view=configuration&tab=agent", true)
        })
        expect(aborted).toBe(true)
        expect(document.querySelector("[role='alertdialog']")).toBeNull()
        expect(router.replace).toHaveBeenCalledWith(
            "/m/agents/a?view=configuration&tab=agent",
            undefined,
            {shallow: true},
        )
        expect(router.push).not.toHaveBeenCalled()
        expect(stack.depth).toBe(0)
    })

    it("stops a link away from the page, closes the views and goes on with push", async () => {
        let aborted = false
        await act(async () => {
            aborted = start("/m/settings")
        })
        expect(aborted).toBe(true)
        expect(router.push).toHaveBeenCalledWith("/m/settings", undefined, {shallow: false})
        expect(stack.depth).toBe(0)
    })

    it("lets the page's own navigation through after allowNext", async () => {
        guardRef.current?.allowNext()
        let aborted = true
        await act(async () => {
            aborted = start("/m/agents/a?view=configuration&tab=agent", true)
        })
        expect(aborted).toBe(false)
        expect(router.push).not.toHaveBeenCalled()
        expect(router.replace).not.toHaveBeenCalled()
    })
})
