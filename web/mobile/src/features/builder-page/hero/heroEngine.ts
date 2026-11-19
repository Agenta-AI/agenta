import {
    createMotion,
    kickMotion,
    snapMotion,
    stepMotion,
    type HeroMotion,
    type HeroState,
} from "./heroMotion"
import {readHeroInks, type HeroInks} from "./heroTheme"
import type {HeroRenderer} from "./strandRibbonRenderer"

const MAX_PIXEL_RATIO = 2
// A long frame (a busy tab, a breakpoint) moves the springs at most this far.
const MAX_STEP = 1 / 20

export interface HeroEngineOptions {
    state: HeroState
    createRenderer: (canvas: HTMLCanvasElement) => HeroRenderer | null
    /** Called with true when the renderer is missing or lost, and false when it works again. */
    onFallback: (fallback: boolean) => void
}

/**
 * Runs the hero on one canvas: the animation loop, the still frame for reduced motion,
 * the pause when the tab is hidden or the canvas is off screen, the theme, and a lost context.
 */
export class HeroEngine {
    private readonly canvas: HTMLCanvasElement
    private readonly options: HeroEngineOptions
    private readonly motion: HeroMotion
    private readonly reducedMotion: MediaQueryList
    private renderer: HeroRenderer | null
    private inks: HeroInks
    private raf = 0
    private last = 0
    private onScreen = true
    private readonly cleanups: (() => void)[] = []

    constructor(canvas: HTMLCanvasElement, options: HeroEngineOptions) {
        this.canvas = canvas
        this.options = options
        this.motion = createMotion(options.state)
        this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)")
        this.inks = readHeroInks(canvas)
        this.renderer = options.createRenderer(canvas)
        options.onFallback(!this.renderer)

        this.listen(document, "visibilitychange", this.wake)
        this.listen(this.reducedMotion, "change", this.wake)
        this.listen(canvas, "webglcontextlost", this.onContextLost)
        this.listen(canvas, "webglcontextrestored", this.onContextRestored)

        // The app switches theme with the class (and data-theme) of <html>.
        const themeObserver = new MutationObserver(this.onThemeChange)
        themeObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["class", "data-theme"],
        })
        this.cleanups.push(() => themeObserver.disconnect())

        if (typeof IntersectionObserver !== "undefined") {
            const io = new IntersectionObserver((entries) => {
                this.onScreen = entries[entries.length - 1].isIntersecting
                this.wake()
            })
            io.observe(canvas)
            this.cleanups.push(() => io.disconnect())
        }
        if (typeof ResizeObserver !== "undefined") {
            const ro = new ResizeObserver(() => {
                if (!this.raf) this.draw()
            })
            ro.observe(canvas)
            this.cleanups.push(() => ro.disconnect())
        }

        this.draw()
        this.wake()
    }

    get state(): HeroState {
        return this.motion.state
    }

    /** Whether the loop runs now. */
    get running(): boolean {
        return this.raf !== 0
    }

    setState(state: HeroState): void {
        if (state === this.motion.state) return
        this.motion.state = state
        this.wake()
    }

    /** One keystroke. Does nothing under reduced motion. */
    pulse(): void {
        if (this.isStill()) return
        kickMotion(this.motion)
        this.wake()
    }

    destroy(): void {
        this.stop()
        this.cleanups.forEach((fn) => fn())
        this.cleanups.length = 0
        this.renderer?.dispose()
        this.renderer = null
    }

    private isStill(): boolean {
        return this.reducedMotion.matches
    }

    private canAnimate(): boolean {
        return !!this.renderer && this.onScreen && !document.hidden && !this.isStill()
    }

    private readonly wake = (): void => {
        if (this.isStill()) {
            this.stop()
            snapMotion(this.motion)
            this.draw()
            return
        }
        if (!this.canAnimate()) {
            this.stop()
            return
        }
        if (!this.raf) {
            this.last = 0
            this.raf = requestAnimationFrame(this.loop)
        }
    }

    private stop(): void {
        if (this.raf) cancelAnimationFrame(this.raf)
        this.raf = 0
    }

    private readonly loop = (now: number): void => {
        this.raf = 0
        if (!this.canAnimate()) return
        const dt = this.last ? Math.min((now - this.last) / 1000, MAX_STEP) : 1 / 60
        this.last = now
        stepMotion(this.motion, dt)
        this.draw()
        this.raf = requestAnimationFrame(this.loop)
    }

    private draw(): void {
        if (!this.renderer) return
        const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO)
        const w = Math.max(1, Math.round(this.canvas.clientWidth * ratio))
        const h = Math.max(1, Math.round(this.canvas.clientHeight * ratio))
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w
            this.canvas.height = h
        }
        this.renderer.draw(this.motion, this.inks)
    }

    private readonly onThemeChange = (): void => {
        this.inks = readHeroInks(this.canvas, this.inks)
        if (!this.raf) this.draw()
    }

    private readonly onContextLost = (event: Event): void => {
        // Without preventDefault the browser never restores the context.
        event.preventDefault()
        this.stop()
        this.renderer = null
        this.options.onFallback(true)
    }

    private readonly onContextRestored = (): void => {
        this.renderer = this.options.createRenderer(this.canvas)
        this.options.onFallback(!this.renderer)
        this.draw()
        this.wake()
    }

    private listen(target: EventTarget, type: string, handler: (event: Event) => void): void {
        target.addEventListener(type, handler)
        this.cleanups.push(() => target.removeEventListener(type, handler))
    }
}
