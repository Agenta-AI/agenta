import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {createRailMotion, type RailPointerEvent} from "../../src/railMotion"

const fakeElement = () => {
    const props = new Map<string, string>()
    const attrs = new Map<string, string>()
    return {
        offsetWidth: 0,
        opacity: 1,
        style: {
            setProperty: (key: string, value: string) => props.set(key, value),
            removeProperty: (key: string) => props.delete(key),
        },
        setAttribute: (key: string, value: string) => attrs.set(key, value),
        removeAttribute: (key: string) => attrs.delete(key),
        animate(frames: {opacity: number}[]) {
            this.opacity = frames.at(-1)?.opacity ?? 1
            return {cancel: () => undefined, finished: Promise.resolve()}
        },
        painted: () => parseFloat(props.get("--ag-sidebar-w") ?? "NaN"),
        attr: (key: string) => attrs.get(key),
    }
}

const setup = ({collapsed = false, width = 255} = {}) => {
    let now = 0
    let frames: FrameRequestCallback[] = []
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb))
    vi.stubGlobal("cancelAnimationFrame", () => {
        frames = []
    })
    vi.stubGlobal("performance", {now: () => now})
    vi.stubGlobal("getComputedStyle", (el: {opacity: number}) => ({opacity: String(el.opacity)}))
    vi.stubGlobal("document", {body: {style: {removeProperty: () => undefined}}})

    const rail = fakeElement()
    const content = fakeElement()
    const react = {collapsed, width}
    const setCollapsed = vi.fn((next: boolean) => {
        react.collapsed = next
    })
    const setWidth = vi.fn((next: number) => {
        react.width = next
    })
    const motion = createRailMotion({
        rail: () => rail as unknown as HTMLElement,
        content: () => content as unknown as HTMLElement,
        readWidth: () => react.width,
        isCollapsed: () => react.collapsed,
        setCollapsed,
        setWidth,
        prefersReducedMotion: () => false,
    })

    const pointer = (clientX: number): RailPointerEvent => ({
        pointerId: 1,
        clientX,
        button: 0,
        preventDefault: () => undefined,
        currentTarget: {
            setPointerCapture: () => undefined,
            hasPointerCapture: () => false,
            releasePointerCapture: () => undefined,
        },
    })

    /** Runs frames 16ms apart, then lets React render whatever the controller asked for. */
    const run = async (count = 60) => {
        for (let i = 0; i < count; i++) {
            now += 16
            const pending = frames
            frames = []
            pending.forEach((cb) => cb(now))
            await Promise.resolve()
            motion.sync(react.collapsed, react.width)
        }
    }

    return {motion, rail, content, react, setCollapsed, setWidth, pointer, run}
}

describe("createRailMotion", () => {
    beforeEach(() => vi.unstubAllGlobals())
    afterEach(() => vi.unstubAllGlobals())

    it("collapses on a drag under 160px and keeps the stored width", async () => {
        const t = setup()
        t.motion.pointerDown(t.pointer(255))
        t.motion.pointerMove(t.pointer(150))
        await t.run()
        t.motion.pointerEnd(t.pointer(150))
        await t.run()

        expect(t.setCollapsed.mock.calls).toEqual([[true]])
        expect(t.setWidth).not.toHaveBeenCalled()
        expect(t.rail.painted()).toBe(48)
        expect(t.content.opacity).toBe(1)
        expect(t.rail.attr("data-resizing")).toBeUndefined()
        expect(t.rail.attr("data-snap")).toBeUndefined()
    })

    it("stores the clamped width after a release in the rubber band", async () => {
        const t = setup()
        t.motion.pointerDown(t.pointer(255))
        t.motion.pointerMove(t.pointer(180))
        await t.run(2)
        expect(t.rail.painted()).toBe(196)
        t.motion.pointerEnd(t.pointer(180))
        await t.run()

        expect(t.setWidth.mock.calls).toEqual([[200]])
        expect(t.setCollapsed).not.toHaveBeenCalled()
        expect(t.rail.painted()).toBe(200)
        expect(t.rail.attr("data-resizing")).toBeUndefined()
    })

    it("hands the rail back to React when the toggle collapses it mid-glide", async () => {
        const t = setup()
        t.motion.pointerDown(t.pointer(255))
        t.motion.pointerMove(t.pointer(440))
        await t.run(2)
        t.motion.pointerEnd(t.pointer(440))
        await t.run(2)

        t.react.collapsed = true
        t.motion.sync(true, t.react.width)
        await t.run()

        expect(t.rail.painted()).toBe(48)
        expect(t.rail.attr("data-resizing")).toBeUndefined()
    })

    it("ignores a grab until React has rendered the collapse, then opens from 48px", async () => {
        const t = setup()
        t.motion.pointerDown(t.pointer(255))
        t.motion.pointerMove(t.pointer(150))
        await t.run()
        t.motion.pointerEnd(t.pointer(150))
        await t.run()

        t.motion.pointerDown(t.pointer(48))
        t.motion.pointerMove(t.pointer(260))
        await t.run()
        t.motion.pointerEnd(t.pointer(260))
        await t.run()

        expect(t.setCollapsed.mock.calls).toEqual([[true], [false]])
        expect(t.setWidth.mock.calls).toEqual([[260]])
        expect(t.rail.painted()).toBe(260)
        expect(t.content.opacity).toBe(1)
    })

    it("stays collapsed after a short pull on the icon rail", async () => {
        const t = setup({collapsed: true})
        t.motion.pointerDown(t.pointer(48))
        t.motion.pointerMove(t.pointer(120))
        await t.run(10)
        expect(t.rail.painted()).toBeGreaterThan(48)
        t.motion.pointerEnd(t.pointer(120))
        await t.run()

        expect(t.setCollapsed).not.toHaveBeenCalled()
        expect(t.rail.painted()).toBe(48)
        expect(t.rail.attr("data-snap")).toBeUndefined()
    })

    it("re-opens to the pointer when a collapsing drag comes back out", async () => {
        const t = setup()
        t.motion.pointerDown(t.pointer(255))
        t.motion.pointerMove(t.pointer(120))
        await t.run()
        t.motion.pointerMove(t.pointer(240))
        await t.run()
        t.motion.pointerEnd(t.pointer(240))
        await t.run()

        expect(t.setCollapsed.mock.calls).toEqual([[true], [false]])
        expect(t.setWidth.mock.calls).toEqual([[240]])
        expect(t.rail.painted()).toBe(240)
    })
})
