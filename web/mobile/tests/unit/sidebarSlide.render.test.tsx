// @vitest-environment jsdom
/**
 * The rail slides its content in when it mounts for a focus change (A11, A12), and does not
 * move with reduced motion.
 */
import {sidebarCollapsedAtom, sidebarOpenGroupsAtomFamily} from "@agenta/navigation"
import {SidebarShell} from "@agenta/navigation-ui"
import {cleanup, render} from "@testing-library/react"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

globalThis.ResizeObserver ??= class {
    observe = () => undefined
    unobserve = () => undefined
    disconnect = () => undefined
} as unknown as typeof ResizeObserver

const scope = {
    id: "agent-sidebar:a1",
    useSelection: () => ({mode: "route" as const}),
    useSections: () => [],
}

const animate = vi.fn()
const reducedMotion = (reduce: boolean) =>
    vi.stubGlobal(
        "matchMedia",
        (query: string) =>
            ({
                matches: reduce && query.includes("reduce"),
                addEventListener: () => undefined,
                removeEventListener: () => undefined,
            }) as unknown as MediaQueryList,
    )

beforeEach(() => {
    animate.mockReset()
    Element.prototype.animate = animate as unknown as Element["animate"]
})
afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
})

const mount = (enterFrom?: "start" | "end") =>
    render(
        <SidebarShell
            collapsedAtom={sidebarCollapsedAtom}
            openGroupsAtomFamily={sidebarOpenGroupsAtomFamily}
            scope={scope}
            enterFrom={enterFrom}
        />,
    )

describe("the rail's slide between sidebars", () => {
    it("slides in from the end for 0.2 s", () => {
        reducedMotion(false)
        mount("end")
        expect(animate).toHaveBeenCalledOnce()
        const [frames, options] = animate.mock.calls[0]
        expect(frames[0]).toMatchObject({transform: "translateX(16px)", opacity: 0})
        expect(options).toMatchObject({duration: 200})
    })

    it("slides in from the start when going back", () => {
        reducedMotion(false)
        mount("start")
        expect(animate.mock.calls[0][0][0]).toMatchObject({transform: "translateX(-16px)"})
    })

    it("does not move with reduced motion or with no focus change", () => {
        reducedMotion(true)
        mount("end")
        cleanup()
        reducedMotion(false)
        mount()
        expect(animate).not.toHaveBeenCalled()
    })
})
