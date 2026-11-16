/** The product panel beside the sign-in form on wide screens. */
import {memo, useLayoutEffect, useRef, useState, useSyncExternalStore} from "react"

import {ProductPreview} from "./ProductPreview"
import {REPO, useGithubStars} from "./useGithubStars"

/** GitHub's mark, filled, as on the website badge. */
const GithubMark = () => (
    <svg aria-hidden width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 1.5c-5.8 0-10.5 4.7-10.5 10.5 0 4.64 3 8.58 7.18 9.97.53.1.72-.23.72-.5 0-.25-.01-1.08-.01-1.96-2.64.49-3.32-.64-3.53-1.23-.12-.3-.63-1.23-1.08-1.48-.37-.2-.89-.68-.01-.7.83-.01 1.42.76 1.61 1.08.94 1.59 2.45 1.14 3.06.87.09-.68.37-1.14.67-1.4-2.34-.26-4.78-1.17-4.78-5.19 0-1.14.41-2.08 1.08-2.82-.11-.26-.47-1.34.1-2.78 0 0 .88-.28 2.89 1.08a9.77 9.77 0 0 1 5.25 0c2.01-1.37 2.89-1.08 2.89-1.08.58 1.44.21 2.52.1 2.78.67.73 1.08 1.67 1.08 2.82 0 4.03-2.45 4.92-4.79 5.18.38.33.71.96.71 1.94 0 1.4-.01 2.54-.01 2.89 0 .28.19.61.72.5A10.52 10.52 0 0 0 22.5 12c0-5.8-4.7-10.5-10.5-10.5Z" />
    </svg>
)

const FRAME_WIDTH = 920
const FRAME_HEIGHT = 760
/** How far the frame runs past the panel's right and bottom edges, as in the design. */
const BLEED = 48
/** Below this the mock's text gets too small to read; a narrow panel shows less of it instead. */
const MIN_SCALE = 0.85
const MAX_SCALE = 3
/** Tailwind's `lg`, where the panel shows. */
const WIDE = "(min-width: 1024px)"

const subscribeWide = (onChange: () => void) => {
    const list = window.matchMedia?.(WIDE)
    list?.addEventListener("change", onChange)
    return () => list?.removeEventListener("change", onChange)
}

/** Whether the panel is on screen; below `lg` CSS hides it and the live preview should not run. */
const useWide = () =>
    useSyncExternalStore(
        subscribeWide,
        () => window.matchMedia?.(WIDE).matches ?? false,
        () => false,
    )

/**
 * Scale the preview to the panel's width, then grow the frame's height to fill the panel.
 * Scaling to the height instead pushed the automation list off a tall, narrow panel (iPad portrait).
 */
const useFrameFit = () => {
    const ref = useRef<HTMLDivElement>(null)
    const [fit, setFit] = useState({scale: 1, height: FRAME_HEIGHT})
    useLayoutEffect(() => {
        const node = ref.current
        if (!node || typeof ResizeObserver === "undefined") return
        const observer = new ResizeObserver(([entry]) => {
            const {width, height} = entry.contentRect
            const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (width + BLEED) / FRAME_WIDTH))
            setFit({scale, height: Math.max(FRAME_HEIGHT, (height + BLEED) / scale)})
        })
        observer.observe(node)
        return () => observer.disconnect()
    }, [])
    return [ref, fit] as const
}

const AuthSideBanner = () => {
    const [stageRef, {scale, height}] = useFrameFit()
    const wide = useWide()
    const stars = useGithubStars(wide)
    return (
        <section className="auth-panel m-3 hidden min-w-0 flex-1 flex-col gap-[clamp(24px,4vh,40px)] overflow-hidden rounded-lg pl-[clamp(32px,5vw,72px)] pt-[clamp(32px,8vh,72px)] lg:flex">
            <div className="flex flex-col gap-3.5 pr-8">
                <a
                    href={`https://github.com/${REPO}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-6 items-center gap-1.5 self-start rounded-full border border-solid border-border bg-background px-3 text-xs text-muted-foreground no-underline outline-none transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:ring-[3px] focus-visible:ring-[color:var(--ag-controlOutline)]"
                >
                    <GithubMark />
                    Open source · {stars}
                </a>
                <h2 className="auth-headline m-0 max-w-[520px] text-balance text-[clamp(28px,3vw,40px)] min-[2400px]:max-w-[880px] min-[2400px]:text-[clamp(40px,1.7vw,64px)] font-semibold leading-[1.15] tracking-[-0.02em] text-foreground">
                    Agents that run while you work on something else
                </h2>
            </div>
            <div ref={stageRef} className="relative min-h-0 flex-1" aria-hidden>
                <div
                    className="auth-preview-frame absolute left-0 top-0 w-[920px] origin-top-left overflow-hidden rounded-[14px]"
                    style={{height, transform: `scale(${scale})`}}
                >
                    {wide ? <ProductPreview /> : null}
                </div>
            </div>
        </section>
    )
}

export default memo(AuthSideBanner)
