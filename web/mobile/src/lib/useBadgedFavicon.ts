import {useEffect, useState} from "react"

/** What the badge says. Green while a turn runs; amber once it ended and the user has not looked. */
export type FaviconBadge = "running" | "finished"

const SIZE = 32
/** Dot centre and radius, top-right; the ring is the transparent cut that keeps it legible on any tab strip. */
const DOT = {x: 25, y: 7, r: 6, ring: 7.5}

/** The run-status hues the session rows paint, with their values as a fallback: canvas cannot read a token. */
const BADGE_COLOR: Record<FaviconBadge, {token: string; fallback: string}> = {
    running: {token: "--ag-run-status-success", fallback: "#12B76A"},
    finished: {token: "--ag-run-status-warning", fallback: "#F79009"},
}

const badgeColor = (badge: FaviconBadge) => {
    const {token, fallback} = BADGE_COLOR[badge]
    return getComputedStyle(document.documentElement).getPropertyValue(token).trim() || fallback
}

const loadImage = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = reject
        image.src = src
    })

/** The favicon at `src` with a dot on its shoulder, as a PNG data URL. */
const drawFaviconBadge = async (src: string, badge: FaviconBadge): Promise<string> => {
    const image = await loadImage(src)
    const canvas = document.createElement("canvas")
    canvas.width = SIZE
    canvas.height = SIZE
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("canvas 2d context unavailable")
    ctx.drawImage(image, 0, 0, SIZE, SIZE)
    ctx.globalCompositeOperation = "destination-out"
    ctx.beginPath()
    ctx.arc(DOT.x, DOT.y, DOT.ring, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalCompositeOperation = "source-over"
    ctx.fillStyle = badgeColor(badge)
    ctx.beginPath()
    ctx.arc(DOT.x, DOT.y, DOT.r, 0, Math.PI * 2)
    ctx.fill()
    return canvas.toDataURL("image/png")
}

/**
 * The badged favicon for `badge`, else null. Each variant is drawn once, on first use; a failed
 * draw leaves the plain icon (no badge is the failure mode, never a broken one). Null on the server.
 */
export const useBadgedFavicon = (src: string, badge: FaviconBadge | null): string | null => {
    const [drawn, setDrawn] = useState<Partial<Record<FaviconBadge, string>>>({})
    useEffect(() => {
        if (!badge || drawn[badge]) return
        let live = true
        drawFaviconBadge(src, badge)
            .then((url) => {
                if (live) setDrawn((prev) => ({...prev, [badge]: url}))
            })
            .catch(() => undefined)
        return () => {
            live = false
        }
    }, [badge, drawn, src])
    return badge ? (drawn[badge] ?? null) : null
}
