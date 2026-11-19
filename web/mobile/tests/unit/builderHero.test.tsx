// @vitest-environment jsdom
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {BuilderHero} from "@/features/builder-page/hero/BuilderHero"
import {HeroEngine} from "@/features/builder-page/hero/heroEngine"
import {
    HERO_STATES,
    createMotion,
    kickMotion,
    stepMotion,
    type HeroMotion,
    type HeroState,
} from "@/features/builder-page/hero/heroMotion"
import {parseCssColor, readHeroInks} from "@/features/builder-page/hero/heroTheme"
import type {HeroRenderer} from "@/features/builder-page/hero/strandRibbonRenderer"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const DT = 1 / 60

function run(m: HeroMotion, seconds: number) {
    for (let i = 0; i < Math.round(seconds / DT); i++) stepMotion(m, DT)
}

describe("hero motion", () => {
    it("starts at rest on the given state", () => {
        const m = createMotion("thinking")
        expect(m.params).toEqual(HERO_STATES.thinking)
        expect(m.velocity).toEqual({speed: 0, energy: 0, think: 0, done: 0})
    })

    it.each<[HeroState, HeroState]>([
        ["idle", "typing"],
        ["typing", "thinking"],
        ["thinking", "done"],
        ["done", "idle"],
    ])("moves from %s to %s with no jump and settles", (from, to) => {
        const m = createMotion(from)
        run(m, 1)
        m.state = to
        const before = {...m.params}
        stepMotion(m, DT)
        // One frame after the change, no number has moved more than a small step.
        for (const k of Object.keys(before) as (keyof typeof before)[]) {
            expect(Math.abs(m.params[k] - before[k])).toBeLessThan(0.02)
        }
        run(m, 0.45)
        // Most of the way after about 0.45 s.
        const gap = Math.abs(m.params.speed - HERO_STATES[to].speed)
        expect(gap).toBeLessThan(Math.abs(HERO_STATES[from].speed - HERO_STATES[to].speed) * 0.25)
        run(m, 2)
        for (const k of Object.keys(before) as (keyof typeof before)[]) {
            expect(m.params[k]).toBeCloseTo(HERO_STATES[to][k], 3)
        }
    })

    it("keeps its speed through a state change, so the phase never skips", () => {
        const m = createMotion("idle")
        run(m, 1)
        m.state = "thinking"
        let previous = m.phase
        let previousStep = 0
        for (let i = 0; i < 120; i++) {
            stepMotion(m, DT)
            const delta = m.phase - previous
            expect(delta).toBeGreaterThan(0)
            if (previousStep) expect(Math.abs(delta - previousStep)).toBeLessThan(0.001)
            previousStep = delta
            previous = m.phase
        }
    })

    it("makes a small bump on a keystroke that fades out by itself", () => {
        const m = createMotion("typing")
        kickMotion(m)
        let peak = 0
        for (let i = 0; i < 60; i++) {
            stepMotion(m, DT)
            peak = Math.max(peak, Math.abs(m.kick))
        }
        expect(peak).toBeGreaterThan(0.05)
        expect(peak).toBeLessThan(1)
        run(m, 1)
        expect(Math.abs(m.kick)).toBeLessThan(0.001)
    })
})

describe("hero inks", () => {
    it("parses the token formats of theme.generated.css", () => {
        expect(parseCssColor("#242424")).toEqual([36, 36, 36, 1])
        expect(parseCssColor(" #fff ")).toEqual([255, 255, 255, 1])
        expect(parseCssColor("rgba(255, 255, 255, 0.85)")).toEqual([255, 255, 255, 0.85])
        expect(parseCssColor("rgb(20 20 20 / 50%)")).toEqual([20, 20, 20, 0.5])
        expect(parseCssColor("oklch(0.5 0.1 200)")).toBeNull()
    })

    it("reads the light and dark inks, with dark inks over the dark background", () => {
        const el = document.createElement("div")
        document.body.appendChild(el)
        el.style.setProperty("--colorBgContainer", "#ffffff")
        el.style.setProperty("--colorText", "#242424")
        el.style.setProperty("--colorTextSecondary", "#676770")
        expect(readHeroInks(el)).toEqual({ink: [36, 36, 36], ink2: [103, 103, 112]})

        el.style.setProperty("--colorBgContainer", "#141414")
        el.style.setProperty("--colorText", "rgba(255, 255, 255, 0.85)")
        el.style.setProperty("--colorTextSecondary", "rgba(255, 255, 255, 0.65)")
        expect(readHeroInks(el)).toEqual({ink: [220, 220, 220], ink2: [173, 173, 173]})
        el.remove()
    })
})

// The browser parts the engine reads, driven by the test.
interface Env {
    reduced: boolean
    reducedListeners: (() => void)[]
    frames: FrameRequestCallback[]
    io: {cb: IntersectionObserverCallback} | null
}

let env: Env

function fakeRenderer() {
    const draws: {state: HeroState; params: HeroMotion["params"]}[] = []
    const renderer: HeroRenderer = {
        draw: (m) => draws.push({state: m.state, params: {...m.params}}),
        dispose: vi.fn(),
    }
    return {renderer, draws}
}

function flushFrame(now: number) {
    const pending = env.frames
    env.frames = []
    pending.forEach((cb) => cb(now))
}

function setHidden(hidden: boolean) {
    Object.defineProperty(document, "hidden", {configurable: true, get: () => hidden})
    document.dispatchEvent(new Event("visibilitychange"))
}

beforeEach(() => {
    env = {reduced: false, reducedListeners: [], frames: [], io: null}
    vi.stubGlobal("matchMedia", (query: string) => ({
        get matches() {
            return query.includes("reduced-motion") && env.reduced
        },
        addEventListener: (_: string, fn: () => void) => env.reducedListeners.push(fn),
        removeEventListener: vi.fn(),
    }))
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
        env.frames.push(cb)
        return env.frames.length
    })
    vi.stubGlobal("cancelAnimationFrame", () => {
        env.frames = []
    })
    vi.stubGlobal(
        "IntersectionObserver",
        class {
            constructor(cb: IntersectionObserverCallback) {
                env.io = {cb}
            }
            observe = vi.fn()
            disconnect = vi.fn()
        },
    )
    setHidden(false)
})

afterEach(() => {
    vi.unstubAllGlobals()
})

function makeEngine(
    state: HeroState = "idle",
    renderer: HeroRenderer | null = fakeRenderer().renderer,
) {
    const onFallback = vi.fn()
    const canvas = document.createElement("canvas")
    const engine = new HeroEngine(canvas, {state, createRenderer: () => renderer, onFallback})
    return {engine, canvas, onFallback}
}

describe("hero engine", () => {
    it("animates while visible and pauses when the tab is hidden or the hero is off screen", () => {
        const {renderer, draws} = fakeRenderer()
        const {engine} = makeEngine("idle", renderer)
        expect(engine.running).toBe(true)
        flushFrame(1000)
        flushFrame(1016)
        expect(draws.length).toBeGreaterThanOrEqual(3)

        setHidden(true)
        expect(engine.running).toBe(false)
        const count = draws.length
        flushFrame(1032)
        expect(draws.length).toBe(count)

        setHidden(false)
        expect(engine.running).toBe(true)

        env.io?.cb(
            [{isIntersecting: false} as IntersectionObserverEntry],
            {} as IntersectionObserver,
        )
        expect(engine.running).toBe(false)
        env.io?.cb(
            [{isIntersecting: true} as IntersectionObserverEntry],
            {} as IntersectionObserver,
        )
        expect(engine.running).toBe(true)
        engine.destroy()
        expect(engine.running).toBe(false)
        expect(renderer.dispose).toHaveBeenCalled()
    })

    it("draws one still frame per state under reduced motion and never animates", () => {
        env.reduced = true
        const {renderer, draws} = fakeRenderer()
        const {engine} = makeEngine("idle", renderer)
        expect(engine.running).toBe(false)
        expect(env.frames).toHaveLength(0)
        expect(draws.at(-1)?.params).toEqual(HERO_STATES.idle)

        for (const s of ["typing", "thinking", "done"] as const) {
            const count = draws.length
            engine.setState(s)
            expect(draws.length).toBe(count + 1)
            // The still frame is the resting form of the state, not a frame in between.
            expect(draws.at(-1)).toEqual({state: s, params: HERO_STATES[s]})
        }
        engine.pulse()
        expect(engine.running).toBe(false)
        expect(env.frames).toHaveLength(0)
        engine.destroy()
    })

    it("stops and draws the still frame when reduced motion turns on", () => {
        const {renderer, draws} = fakeRenderer()
        const {engine} = makeEngine("thinking", renderer)
        expect(engine.running).toBe(true)
        env.reduced = true
        env.reducedListeners.forEach((fn) => fn())
        expect(engine.running).toBe(false)
        expect(draws.at(-1)?.params).toEqual(HERO_STATES.thinking)
        engine.destroy()
    })

    it("reports the fallback when there is no renderer", () => {
        const {engine, onFallback} = makeEngine("idle", null)
        expect(onFallback).toHaveBeenLastCalledWith(true)
        expect(engine.running).toBe(false)
        engine.destroy()
    })

    it("shows the fallback on a lost context and resumes when it is restored", () => {
        const {engine, canvas, onFallback} = makeEngine()
        expect(onFallback).toHaveBeenLastCalledWith(false)
        const lost = new Event("webglcontextlost", {cancelable: true})
        canvas.dispatchEvent(lost)
        expect(lost.defaultPrevented).toBe(true)
        expect(onFallback).toHaveBeenLastCalledWith(true)
        expect(engine.running).toBe(false)
        canvas.dispatchEvent(new Event("webglcontextrestored"))
        expect(onFallback).toHaveBeenLastCalledWith(false)
        expect(engine.running).toBe(true)
        engine.destroy()
    })
})

describe("BuilderHero", () => {
    let container: HTMLDivElement
    let root: Root

    beforeEach(() => {
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
    })

    it("shows the still fallback when the browser has no WebGL", () => {
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)
        act(() => root.render(<BuilderHero state="idle" />))
        const hero = container.querySelector("[data-hero-state]")
        expect(hero?.getAttribute("data-hero-state")).toBe("idle")
        expect(hero?.getAttribute("aria-hidden")).toBe("true")
        expect(container.querySelector("[data-hero-fallback]")).not.toBeNull()
        expect(container.querySelectorAll("circle")).toHaveLength(3)

        act(() => root.render(<BuilderHero state="thinking" />))
        expect(hero?.getAttribute("data-hero-state")).toBe("thinking")
    })
})
