/** The product panel beside the sign-in form on wide screens. */
import {memo, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore} from "react"

import {ProductPreview} from "./ProductPreview"

const REPO = "Agenta-AI/agenta"
/** The last known count, shown until the live one arrives or when GitHub is unreachable. */
const FALLBACK_STARS = 4900

/** 4906 -> "4.9K", 950 -> "950", as the website's hero badge shows it. */
const formatStars = (n: number) =>
    n < 1000 ? String(n) : `${(Math.floor(n / 100) / 10).toFixed(1)}K`

const STARS_CACHE_KEY = "agenta:github-stars"
/** GitHub allows 60 unauthenticated calls an hour per IP; a shared office would burn that fast. */
const STARS_TTL_MS = 6 * 60 * 60 * 1000

const readCachedStars = (): number | null => {
    try {
        const cached = JSON.parse(localStorage.getItem(STARS_CACHE_KEY) ?? "null") as {
            count?: unknown
            at?: unknown
        } | null
        if (typeof cached?.count !== "number" || typeof cached.at !== "number") return null
        return Date.now() - cached.at < STARS_TTL_MS ? cached.count : null
    } catch {
        return null
    }
}

const writeCachedStars = (count: number) => {
    try {
        localStorage.setItem(STARS_CACHE_KEY, JSON.stringify({count, at: Date.now()}))
    } catch {
        // Storage can be full or blocked; the next load just asks GitHub again.
    }
}

let starsRequest: Promise<number | null> | undefined

/** One request per page load, shared by every mount; the sign-in steps remount the shell. */
const fetchStars = () =>
    (starsRequest ??= Promise.resolve(readCachedStars()).then(
        (cached) =>
            cached ??
            fetch(`https://api.github.com/repos/${REPO}`)
                .then((res) => (res.ok ? res.json() : null))
                .then((data: {stargazers_count?: unknown} | null) => {
                    const count = data?.stargazers_count
                    if (typeof count !== "number") return null
                    writeCachedStars(count)
                    return count
                })
                .catch(() => null),
    ))

/** The live star count, fetched only while the panel is on screen. */
const useGithubStars = (enabled: boolean) => {
    const [stars, setStars] = useState(FALLBACK_STARS)
    useEffect(() => {
        if (!enabled) return
        let live = true
        fetchStars().then((count) => {
            if (live && count !== null) setStars(count)
        })
        return () => {
            live = false
        }
    }, [enabled])
    return formatStars(stars)
}

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

/** Scale the preview with the panel; on tall screens push the content down so the preview bleeds. */
const useFrameFit = () => {
    const ref = useRef<HTMLDivElement>(null)
    const [fit, setFit] = useState({scale: 1, offset: 0})
    useLayoutEffect(() => {
        const node = ref.current
        if (!node || typeof ResizeObserver === "undefined") return
        const observer = new ResizeObserver(([entry]) => {
            const {width, height} = entry.contentRect
            const cover = Math.max((width + BLEED) / FRAME_WIDTH, (height + BLEED) / FRAME_HEIGHT)
            const scale = Math.min(MAX_SCALE, Math.max(1, cover))
            const offset = Math.max(0, height + BLEED - FRAME_HEIGHT * scale)
            setFit({scale, offset})
        })
        observer.observe(node)
        return () => observer.disconnect()
    }, [])
    return [ref, fit] as const
}

const AuthSideBanner = () => {
    const [stageRef, {scale, offset}] = useFrameFit()
    const wide = useWide()
    const stars = useGithubStars(wide)
    return (
        <section className="auth-panel m-3 hidden min-w-0 flex-1 flex-col gap-[clamp(24px,4vh,40px)] overflow-hidden rounded-lg pl-[clamp(32px,5vw,72px)] pt-[clamp(32px,8vh,72px)] lg:flex">
            <div
                className="flex flex-col gap-3.5 pr-8"
                style={{transform: `translateY(${offset}px)`}}
            >
                <a
                    href={`https://github.com/${REPO}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-6 items-center gap-1.5 self-start rounded-full border border-solid border-border px-3 text-xs uppercase tracking-[0.02em] text-muted-foreground no-underline outline-none transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:ring-[3px] focus-visible:ring-[color:var(--ag-controlOutline)]"
                >
                    <GithubMark />
                    Open source · {stars}
                </a>
                <h2 className="auth-headline m-0 max-w-[520px] text-balance text-[clamp(28px,3vw,40px)] font-semibold leading-[1.15] tracking-[-0.02em] text-foreground">
                    Agents that run while you work on something else
                </h2>
            </div>
            <div ref={stageRef} className="relative min-h-0 flex-1" aria-hidden>
                <div
                    className="auth-preview-frame absolute left-0 top-0 h-[760px] w-[920px] origin-top-left overflow-hidden rounded-[14px]"
                    style={{transform: `translateY(${offset}px) scale(${scale})`}}
                >
                    {wide ? <ProductPreview /> : null}
                </div>
            </div>
        </section>
    )
}

export default memo(AuthSideBanner)
