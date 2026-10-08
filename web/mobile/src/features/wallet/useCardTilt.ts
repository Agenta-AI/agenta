import {useCallback, useState, type PointerEvent} from "react"

export interface CardTilt {
    rx: number
    ry: number
    /** Glare position, in percent of the card. */
    gx: number
    gy: number
    hover: boolean
}

const FLAT: CardTilt = {rx: 0, ry: 0, gx: 50, gy: 50, hover: false}

/** A card's tilt toward the pointer; `enabled: false` keeps it flat. */
export const useCardTilt = (enabled: boolean) => {
    const [tilt, setTilt] = useState<CardTilt>(FLAT)
    const onPointerMove = useCallback(
        (event: PointerEvent<HTMLElement>) => {
            if (!enabled) return
            const box = event.currentTarget.getBoundingClientRect()
            const px = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width))
            const py = Math.max(0, Math.min(1, (event.clientY - box.top) / box.height))
            setTilt({
                rx: (0.5 - py) * 18,
                ry: (px - 0.5) * 22,
                gx: px * 100,
                gy: py * 100,
                hover: true,
            })
        },
        [enabled],
    )
    const onPointerLeave = useCallback(() => setTilt(FLAT), [])
    return {tilt, onPointerMove, onPointerLeave}
}
