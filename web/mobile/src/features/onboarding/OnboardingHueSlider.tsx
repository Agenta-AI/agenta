import {useRef, type KeyboardEvent, type PointerEvent} from "react"

import {AGENT_ICON_COLORS, AGENT_ICON_CONIC, hexToHsv, hsvToHex} from "@agenta/ui/agent-icon"

import {FOCUS_RING} from "@/lib/interactive"
import {cn} from "@/lib/utils"

import {ONBOARDING_COPY} from "./onboardingCopy"

const TRACK = AGENT_ICON_CONIC.replace("conic-gradient(", "linear-gradient(90deg,")
const isPalette = (hex: string) =>
    AGENT_ICON_COLORS.some(([solid]) => solid.toLowerCase() === hex.toLowerCase())
/** The design's custom colours: one saturation and value, any hue. */
const fromHue = (hue: number) => hsvToHex(((hue % 360) + 360) % 360, 0.78, 0.62).toUpperCase()

/** A custom agent colour picked along the hue wheel; drag, tap, or arrow keys. */
export const OnboardingHueSlider = ({
    color,
    onPreview,
    onChange,
    className,
}: {
    color: string
    /** Each step of a drag; `onChange` gets the colour once, on release. */
    onPreview: (hex: string) => void
    onChange: (hex: string) => void
    className?: string
}) => {
    const custom = !isPalette(color)
    const hue = custom ? hexToHsv(color).h : 0
    const trackRef = useRef<HTMLDivElement | null>(null)

    const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
        const track = trackRef.current
        if (!track) return
        const box = track.getBoundingClientRect()
        let last = color
        const set = (x: number) => {
            last = fromHue(Math.max(0, Math.min(1, (x - box.left) / box.width)) * 360)
            onPreview(last)
        }
        set(event.clientX)
        track.setPointerCapture(event.pointerId)
        const move = (next: globalThis.PointerEvent) => set(next.clientX)
        const up = () => {
            track.removeEventListener("pointermove", move)
            track.removeEventListener("pointerup", up)
            track.removeEventListener("pointercancel", up)
            onChange(last)
        }
        track.addEventListener("pointermove", move)
        track.addEventListener("pointerup", up)
        track.addEventListener("pointercancel", up)
    }

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const delta = event.key === "ArrowRight" ? 10 : event.key === "ArrowLeft" ? -10 : 0
        if (!delta) return
        event.preventDefault()
        onChange(fromHue(hue + delta))
    }

    return (
        <div
            ref={trackRef}
            role="slider"
            tabIndex={0}
            aria-label={ONBOARDING_COPY.creator.hue}
            aria-valuemin={0}
            aria-valuemax={360}
            aria-valuenow={Math.round(hue)}
            onPointerDown={onPointerDown}
            onKeyDown={onKeyDown}
            // The track is the colour wheel itself, a fixed picker surface rather than a theme role.
            style={{background: TRACK, outline: custom ? `2px solid ${color}` : undefined}}
            className={cn(
                "relative h-2.5 min-w-16 flex-1 cursor-pointer touch-none rounded-full outline-offset-2",
                FOCUS_RING,
                className,
            )}
        >
            <span
                aria-hidden
                style={{left: `${hue / 3.6}%`, background: custom ? color : undefined}}
                className="bg-background absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-solid border-white shadow-sm ring-1 ring-black/20"
            />
        </div>
    )
}
