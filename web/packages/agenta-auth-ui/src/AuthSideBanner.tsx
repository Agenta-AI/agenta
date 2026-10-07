/** The product panel beside the sign-in form on wide screens. */
import {memo, useLayoutEffect, useRef, useState} from "react"

import {Button} from "@agenta/ui/ui"
import {GithubLogo} from "@phosphor-icons/react"

import {ProductPreview} from "./ProductPreview"

const FRAME_WIDTH = 920
const FRAME_HEIGHT = 760
/** How far the frame runs past the panel's right and bottom edges, as in the design. */
const BLEED = 48
const MAX_SCALE = 2

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
    return (
        <section className="auth-panel m-3 hidden min-w-0 flex-1 flex-col gap-[clamp(24px,4vh,40px)] overflow-hidden rounded-lg pl-[clamp(32px,5vw,72px)] pt-[clamp(32px,8vh,72px)] lg:flex">
            <div
                className="flex flex-col gap-3.5 pr-8"
                style={{transform: `translateY(${offset}px)`}}
            >
                <Button
                    asChild
                    variant="outline"
                    size="xs"
                    className="self-start rounded-full bg-background pl-2 pr-2.5 text-xs font-medium no-underline shadow-[var(--ag-boxShadowTertiary)]"
                >
                    <a
                        href="https://github.com/Agenta-AI/agenta"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        <GithubLogo size={14} weight="fill" />
                        Open Source
                    </a>
                </Button>
                <h2 className="auth-headline m-0 max-w-[520px] text-balance text-[clamp(28px,3vw,40px)] font-semibold leading-[1.15] tracking-[-0.02em] text-foreground">
                    Agents that run while you work on something else
                </h2>
            </div>
            <div ref={stageRef} className="relative min-h-0 flex-1" aria-hidden>
                <div
                    className="auth-preview-frame absolute left-0 top-0 h-[760px] w-[920px] origin-top-left overflow-hidden rounded-[14px]"
                    style={{transform: `translateY(${offset}px) scale(${scale})`}}
                >
                    <ProductPreview />
                </div>
            </div>
        </section>
    )
}

export default memo(AuthSideBanner)
