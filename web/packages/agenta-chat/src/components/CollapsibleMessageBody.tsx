import {useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode} from "react"

import {useAtomValue, useSetAtom} from "jotai"

import {expandedValueAtomFamily, setExpandedAtom} from "../state/expandState"

// Same idiom as InfiniteVirtualTable — no layout-effect warning on the server.
const useIsomorphicLayoutEffect = typeof document !== "undefined" ? useLayoutEffect : useEffect

/** The clamp — about eight lines of chat text. */
export const COLLAPSED_MESSAGE_MAX_PX = 200
/** A message that only just spills renders whole; the toggle would cost more room than it saves. */
const OVERFLOW_SLACK_PX = 32
const FADE_PX = 40
const DURATION_MS = 240

const FADE_MASK = `linear-gradient(to bottom, #000 calc(100% - ${FADE_PX}px), transparent 100%)`

export interface CollapsibleMessageBodyProps {
    /** Expand key (`messageBodyKey`) — persisted, so it survives the windowed row unmounting. */
    stateKey: string
    children: ReactNode
    collapsedMaxPx?: number
    className?: string
}

/**
 * Clamps a long message behind a "Show more" toggle so one pasted wall of text can't bury the
 * turns around it. Measurement drives only the toggle: the clamp is on from the first paint, or a
 * long message would paint full-height and snap shut, moving the transcript's scroll anchor.
 */
export const CollapsibleMessageBody = ({
    stateKey,
    children,
    collapsedMaxPx = COLLAPSED_MESSAGE_MAX_PX,
    className,
}: CollapsibleMessageBodyProps) => {
    const stored = useAtomValue(expandedValueAtomFamily(stateKey))
    const setExpanded = useSetAtom(setExpandedAtom)
    const expanded = stored ?? false
    const regionId = useId()

    const innerRef = useRef<HTMLDivElement>(null)
    // The inner box is never clipped (the clamp is on the outer one), so this is the natural
    // height and the observer can't feed back into itself. `null` = not measured yet.
    const [height, setHeight] = useState<number | null>(null)

    useIsomorphicLayoutEffect(() => {
        const el = innerRef.current
        if (!el) return
        const measure = () => setHeight(el.getBoundingClientRect().height)
        measure()
        if (typeof ResizeObserver === "undefined") return
        const observer = new ResizeObserver(measure)
        observer.observe(el)
        return () => observer.disconnect()
    }, [])

    const overflows = height !== null && height > collapsedMaxPx + OVERFLOW_SLACK_PX
    const clamped = !expanded && (height === null || overflows)

    return (
        <div className={className}>
            <div
                id={regionId}
                className="overflow-hidden"
                style={{
                    // Animated between measured pixels, so the open state stays right if the
                    // content reflows (resize, a late attachment) — no keyword interpolation.
                    maxHeight: clamped ? collapsedMaxPx : (height ?? undefined),
                    transition: `max-height ${DURATION_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
                    // A mask, not an overlay: the fade needs no knowledge of the bubble's fill.
                    maskImage: clamped ? FADE_MASK : undefined,
                    WebkitMaskImage: clamped ? FADE_MASK : undefined,
                }}
            >
                <div ref={innerRef}>{children}</div>
            </div>
            {overflows && (
                <button
                    type="button"
                    onClick={() => setExpanded({key: stateKey, value: !expanded})}
                    aria-expanded={expanded}
                    aria-controls={regionId}
                    className="-ml-1 mt-1 w-fit cursor-pointer rounded border-0 bg-transparent px-1 py-0.5 text-xs font-medium text-colorTextSecondary transition-colors hover:bg-colorFillQuaternary hover:text-colorText"
                >
                    {expanded ? "Show less" : "Show more"}
                </button>
            )}
        </div>
    )
}

export default CollapsibleMessageBody
