// @vitest-environment jsdom
import {act, cleanup, render} from "@testing-library/react"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

type Handler = (...args: unknown[]) => void

const router = vi.hoisted(() => {
    const handlers = new Map<string, Set<(...args: unknown[]) => void>>()
    return {
        handlers,
        push: vi.fn(async () => true),
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
})
vi.mock("next/router", () => ({useRouter: () => router}))

import {
    LeaveGuardProvider,
    useConfirmLeave,
    useLeaveSource,
    type LeaveReason,
    type LeaveSource,
} from "@/features/agent-layout/leaveGuard"

afterEach(cleanup)
beforeEach(() => {
    router.push.mockClear()
})

let confirmLeave: (reason: LeaveReason) => Promise<boolean> = async () => true

const Source = ({source}: {source: LeaveSource | null}) => {
    useLeaveSource(source)
    return null
}
const Probe = () => {
    confirmLeave = useConfirmLeave()
    return null
}

const source = (dirty: boolean, answer: boolean) => ({
    isDirty: vi.fn(() => dirty),
    ask: vi.fn(async () => answer),
})

const startRoute = (url: string, shallow = false) => {
    let aborted = false
    try {
        router.handlers.get("routeChangeStart")?.forEach((fn: Handler) => fn(url, {shallow}))
    } catch {
        aborted = true
    }
    return aborted
}

describe("leave guard", () => {
    it("asks each dirty source in turn and skips clean ones", async () => {
        const clean = source(false, false)
        const first = source(true, true)
        const second = source(true, true)
        render(
            <LeaveGuardProvider leavesAgent={() => true}>
                <Source source={clean} />
                <Source source={first} />
                <Source source={second} />
                <Probe />
            </LeaveGuardProvider>,
        )
        await expect(confirmLeave("swap")).resolves.toBe(true)
        expect(clean.ask).not.toHaveBeenCalled()
        expect(first.ask).toHaveBeenCalledWith("swap")
        expect(second.ask).toHaveBeenCalledWith("swap")
    })

    it("stops at the first source that keeps the person", async () => {
        const keep = source(true, false)
        const later = source(true, true)
        render(
            <LeaveGuardProvider leavesAgent={() => true}>
                <Source source={keep} />
                <Source source={later} />
                <Probe />
            </LeaveGuardProvider>,
        )
        await expect(confirmLeave("close")).resolves.toBe(false)
        expect(later.ask).not.toHaveBeenCalled()
    })

    it("drops a source when it unmounts or passes null", async () => {
        const dirty = source(true, false)
        const view = render(
            <LeaveGuardProvider leavesAgent={() => true}>
                <Source source={dirty} />
                <Probe />
            </LeaveGuardProvider>,
        )
        view.rerender(
            <LeaveGuardProvider leavesAgent={() => true}>
                <Source source={null} />
                <Probe />
            </LeaveGuardProvider>,
        )
        await expect(confirmLeave("close")).resolves.toBe(true)
        expect(dirty.ask).not.toHaveBeenCalled()
    })

    it("skips a source that unmounted while an earlier one was asking", async () => {
        let resolve!: (ok: boolean) => void
        const first = {
            isDirty: () => true,
            ask: vi.fn(() => new Promise<boolean>((r) => (resolve = r))),
        }
        const second = source(true, true)
        const view = render(
            <LeaveGuardProvider leavesAgent={() => true}>
                <Source source={first} />
                <Source source={second} />
                <Probe />
            </LeaveGuardProvider>,
        )
        const leaving = confirmLeave("close")
        view.rerender(
            <LeaveGuardProvider leavesAgent={() => true}>
                <Source source={first} />
                <Probe />
            </LeaveGuardProvider>,
        )
        resolve(true)
        await expect(leaving).resolves.toBe(true)
        expect(second.ask).not.toHaveBeenCalled()
    })

    it("asks one question at a time", async () => {
        let resolve!: (ok: boolean) => void
        const slow = {
            isDirty: () => true,
            ask: () => new Promise<boolean>((r) => (resolve = r)),
        }
        render(
            <LeaveGuardProvider leavesAgent={() => true}>
                <Source source={slow} />
                <Probe />
            </LeaveGuardProvider>,
        )
        const first = confirmLeave("swap")
        await expect(confirmLeave("swap")).resolves.toBe(false)
        resolve(true)
        await expect(first).resolves.toBe(true)
    })

    it("asks the browser before unload only when a source is dirty", () => {
        let dirty = false
        render(
            <LeaveGuardProvider leavesAgent={() => true}>
                <Source source={{isDirty: () => dirty, ask: async () => true}} />
            </LeaveGuardProvider>,
        )
        const clean = new Event("beforeunload", {cancelable: true})
        window.dispatchEvent(clean)
        expect(clean.defaultPrevented).toBe(false)
        dirty = true
        const asked = new Event("beforeunload", {cancelable: true})
        window.dispatchEvent(asked)
        expect(asked.defaultPrevented).toBe(true)
    })

    it("aborts a route change, asks, and pushes the same URL once the person agrees", async () => {
        const dirty = source(true, true)
        render(
            <LeaveGuardProvider leavesAgent={() => true}>
                <Source source={dirty} />
            </LeaveGuardProvider>,
        )
        let aborted = false
        await act(async () => {
            aborted = startRoute("/w/1/p/2/sessions/other")
        })
        expect(aborted).toBe(true)
        expect(dirty.ask).toHaveBeenCalledWith("navigate")
        expect(router.push).toHaveBeenCalledWith("/w/1/p/2/sessions/other")
        // The retried navigation passes once.
        expect(startRoute("/w/1/p/2/sessions/other")).toBe(false)
    })

    it("stays when the person keeps editing", async () => {
        const keep = source(true, false)
        render(
            <LeaveGuardProvider leavesAgent={() => true}>
                <Source source={keep} />
            </LeaveGuardProvider>,
        )
        let aborted = false
        await act(async () => {
            aborted = startRoute("/w/1/p/2/agents")
        })
        expect(aborted).toBe(true)
        expect(keep.ask).toHaveBeenCalledWith("navigate")
        expect(router.push).not.toHaveBeenCalled()
    })

    it("lets shallow changes, routes inside the agent and clean sources through", () => {
        const dirty = source(true, true)
        render(
            <LeaveGuardProvider leavesAgent={(url) => !url.includes("/agents/a1")}>
                <Source source={dirty} />
            </LeaveGuardProvider>,
        )
        expect(startRoute("/w/1/p/2/sessions/s1?tab=x", true)).toBe(false)
        expect(startRoute("/w/1/p/2/agents/a1?view=configuration")).toBe(false)
        expect(dirty.ask).not.toHaveBeenCalled()
    })

    it("leaves at once outside a provider", async () => {
        render(<Probe />)
        await expect(confirmLeave("navigate")).resolves.toBe(true)
    })
})
