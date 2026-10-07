/**
 * The product panel beside the sign-in form on wide viewports: the open-source pill, the
 * headline, and a live mock of the Automations page. It hides itself below `lg`; the phone layout
 * is the form alone.
 *
 * Styles come from auth.css (`.auth-panel`, `.auth-chip`), so the panel needs no props — only
 * the surrounding `.auth-redesign` scope.
 */
import {memo, useLayoutEffect, useRef, useState} from "react"

import {GithubLogo} from "@phosphor-icons/react"

import {ProductPreview} from "./ProductPreview"

const FRAME_WIDTH = 920
const FRAME_HEIGHT = 760
/** How far the frame runs past the panel's right and bottom edges, as in the design. */
const BLEED = 48
const MAX_SCALE = 1.6

/** Cover the panel with the fixed-size preview on large screens, anchored top-left. */
const useFrameScale = () => {
    const ref = useRef<HTMLDivElement>(null)
    const [scale, setScale] = useState(1)
    useLayoutEffect(() => {
        const node = ref.current
        if (!node || typeof ResizeObserver === "undefined") return
        const observer = new ResizeObserver(([entry]) => {
            const {width, height} = entry.contentRect
            const cover = Math.max((width + BLEED) / FRAME_WIDTH, (height + BLEED) / FRAME_HEIGHT)
            setScale(Math.min(MAX_SCALE, Math.max(1, cover)))
        })
        observer.observe(node)
        return () => observer.disconnect()
    }, [])
    return [ref, scale] as const
}

const AuthSideBanner = () => {
    const [stageRef, scale] = useFrameScale()
    return (
        <section className="auth-panel m-3 hidden min-w-0 flex-1 flex-col gap-[clamp(24px,4vh,40px)] overflow-hidden rounded-lg pl-[clamp(32px,5vw,72px)] pt-[clamp(32px,8vh,72px)] lg:flex">
            <div className="flex flex-col gap-3.5 pr-8">
                <a
                    href="https://github.com/Agenta-AI/agenta"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="auth-chip self-start"
                >
                    <GithubLogo size={14} weight="fill" />
                    <span>Open Source</span>
                </a>
                <h2 className="auth-headline auth-headline-panel m-0 max-w-[520px]">
                    Agents that run while you work on something else
                </h2>
            </div>
            <div ref={stageRef} className="relative min-h-0 flex-1" aria-hidden>
                <div
                    className="auth-preview-frame absolute left-0 top-0 h-[760px] w-[920px] origin-top-left overflow-hidden rounded-[14px]"
                    style={{transform: scale === 1 ? undefined : `scale(${scale})`}}
                >
                    <ProductPreview />
                </div>
            </div>
        </section>
    )
}

export default memo(AuthSideBanner)
