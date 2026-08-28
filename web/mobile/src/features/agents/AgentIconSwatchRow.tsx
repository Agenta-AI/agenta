import {useEffect, useRef, useState} from "react"

import {
    AGENT_ICON_COLORS,
    AGENT_ICON_CONIC,
    DEFAULT_AGENT_ICON,
    isHexColor,
    normalizeHex,
} from "@agenta/ui/agent-icon"

/** One drag through the OS picker is one write, not one per frame. */
const COMMIT_DELAY_MS = 150

/**
 * The colour row. Nine palette swatches plus the OS colour picker for anything else.
 *
 * A phone gets the native `<input type="color">` rather than the desktop's saturation square and
 * hue strip: two pointer-drag surfaces inside a scrolling sheet fight the scroll, and the OS picker
 * is the control someone already knows.
 *
 * `selected` is null until the agent has a stored choice, so nothing reads as picked before it is.
 */
export const AgentIconSwatchRow = ({
    selected,
    onPick,
}: {
    selected: string | null
    onPick: (hex: string) => void
}) => {
    /** Shown while dragging; the commit trails it so the row tracks the thumb without writing. */
    const [preview, setPreview] = useState<string | null>(null)
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), [])

    const pickCustom = (next: string) => {
        if (!isHexColor(next)) return
        const hex = normalizeHex(next).toUpperCase()
        setPreview(hex)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => {
            setPreview(null)
            onPick(hex)
        }, COMMIT_DELAY_MS)
    }

    const shown = preview ?? selected

    return (
        <div className="flex flex-wrap items-center gap-3">
            {AGENT_ICON_COLORS.map(([solid]) => {
                const isSelected = solid.toLowerCase() === shown?.toLowerCase()
                return (
                    <button
                        key={solid}
                        type="button"
                        aria-label={solid}
                        aria-pressed={isSelected}
                        onClick={() => onPick(solid)}
                        // size-8 is a thumb, not the desktop's size-5 cursor target.
                        className="size-8 shrink-0 cursor-pointer rounded-full border border-solid border-black/10 p-0 dark:border-white/20"
                        style={{
                            background: solid,
                            // outline, not ring: it leaves a genuinely transparent gap, so the
                            // swatch reads the same on any sheet background.
                            ...(isSelected
                                ? {outline: `2px solid ${solid}`, outlineOffset: 2}
                                : null),
                        }}
                    />
                )
            })}
            <label
                className="relative size-8 shrink-0 cursor-pointer overflow-hidden rounded-full border border-solid border-black/10 dark:border-white/20"
                style={{background: AGENT_ICON_CONIC}}
            >
                <span className="sr-only">Custom colour</span>
                <input
                    type="color"
                    value={shown ?? DEFAULT_AGENT_ICON.color}
                    onChange={(event) => pickCustom(event.target.value)}
                    className="absolute inset-0 size-full cursor-pointer opacity-0"
                />
            </label>
        </div>
    )
}
