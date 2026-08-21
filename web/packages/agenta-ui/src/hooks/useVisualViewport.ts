/**
 * Page height that follows the on-screen keyboard.
 *
 * A phone browser opens the keyboard OVER the page instead of resizing it. The layout viewport —
 * what `100dvh` measures — keeps its full height, so the bottom of a `dvh`-tall column sits under
 * the keyboard. In a chat surface that bottom is the composer, and the page cannot scroll to
 * reveal it because the column is exactly as tall as the layout viewport.
 *
 * Chrome and Android solve this declaratively with `interactive-widget=resizes-content` in the
 * viewport meta: the layout viewport itself shrinks and `dvh` follows. This hook then measures an
 * inset of zero and stays idle. iOS Safari ignores that directive, so there the visual viewport is
 * the only signal, and this hook publishes it as a CSS variable for the page to size against.
 *
 * Desktop is unaffected by construction: with no keyboard the inset is always zero, the variable
 * is never set, and every consumer keeps its `100dvh` fallback.
 */
import {useEffect} from "react"

/** The CSS variable this hook writes on the document element. Consumers fall back to `100dvh`. */
export const VIEWPORT_HEIGHT_VAR = "--ag-viewport-height"

/**
 * Below this many pixels the inset is browser chrome — a collapsing URL bar, a find bar — not a
 * keyboard. Overriding the page height for those would resize the layout during an ordinary
 * scroll. No soft keyboard is anywhere near this short.
 */
export const KEYBOARD_INSET_MIN_PX = 120

/** Touch input, where sending a message should also dismiss the on-screen keyboard. */
export const COARSE_POINTER_QUERY = "(pointer: coarse)"

/** The four numbers the rules below need, so they can be tested without a browser. */
export interface VisualViewportSample {
    /** The layout viewport height (`window.innerHeight`), which the keyboard does not shrink. */
    innerHeight: number
    /** The visual viewport height: the part of the page the user can actually see. */
    height: number
    /** How far the visual viewport sits below the top of the layout viewport. */
    offsetTop: number
    /** The pinch-zoom scale. Anything above 1 means the user zoomed in. */
    scale: number
}

/**
 * The number of pixels an interactive widget covers at the bottom of the layout viewport.
 *
 * Pinch zoom also shrinks the visual viewport, so a scale above 1 reports no inset: resizing the
 * page while the user zooms would fight the gesture.
 */
export function keyboardInset(sample: VisualViewportSample): number {
    if (sample.scale > 1.01) return 0
    const inset = sample.innerHeight - sample.height - sample.offsetTop
    return inset > 0 ? inset : 0
}

/**
 * The value for `VIEWPORT_HEIGHT_VAR`, or `null` when the page must keep its `100dvh` height.
 *
 * The height is `height + offsetTop`, not `height`. The page still starts at the top of the layout
 * viewport, so its bottom edge must land at `offsetTop + height` to sit on the bottom of what the
 * user sees after the browser pushed the visual viewport down.
 */
export function viewportHeightOverride(
    sample: VisualViewportSample,
    activeOverride: string | null = null,
): string | null {
    if (sample.scale > 1.01) return activeOverride
    if (keyboardInset(sample) < KEYBOARD_INSET_MIN_PX) return null
    return `${Math.round(sample.height + sample.offsetTop)}px`
}

/** True on a touch device. False during server render and on every mouse-driven browser. */
export function hasCoarsePointer(): boolean {
    if (typeof window === "undefined" || !window.matchMedia) return false
    return window.matchMedia(COARSE_POINTER_QUERY).matches
}

function readVisualViewport(): VisualViewportSample | null {
    if (typeof window === "undefined") return null
    const viewport = window.visualViewport
    if (!viewport) return null
    return {
        innerHeight: window.innerHeight,
        height: viewport.height,
        offsetTop: viewport.offsetTop,
        scale: viewport.scale,
    }
}

/**
 * Track the visual viewport and publish its height as `VIEWPORT_HEIGHT_VAR` on `:root` while a
 * soft keyboard is open. Call it once, from the component that owns the full-height frame.
 *
 * Writes are coalesced into an animation frame because iOS emits a visual-viewport `scroll` event
 * for every pixel the keyboard animates.
 */
export function useVisualViewportHeight(): void {
    useEffect(() => {
        const viewport = typeof window === "undefined" ? undefined : window.visualViewport
        if (!viewport) return

        const root = document.documentElement
        let frame: number | null = null
        let activeOverride: string | null = null

        const apply = () => {
            frame = null
            const sample = readVisualViewport()
            activeOverride = sample ? viewportHeightOverride(sample, activeOverride) : null
            if (activeOverride) root.style.setProperty(VIEWPORT_HEIGHT_VAR, activeOverride)
            else root.style.removeProperty(VIEWPORT_HEIGHT_VAR)
        }
        const sync = () => {
            if (frame !== null) return
            frame = window.requestAnimationFrame(apply)
        }

        apply()
        viewport.addEventListener("resize", sync)
        viewport.addEventListener("scroll", sync)
        window.addEventListener("orientationchange", sync)

        return () => {
            if (frame !== null) window.cancelAnimationFrame(frame)
            viewport.removeEventListener("resize", sync)
            viewport.removeEventListener("scroll", sync)
            window.removeEventListener("orientationchange", sync)
            root.style.removeProperty(VIEWPORT_HEIGHT_VAR)
        }
    }, [])
}
