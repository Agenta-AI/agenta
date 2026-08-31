/**
 * Chat message chrome, antd-free — the drop-in replacements for the @ant-design/x pieces the
 * desktop chat used (`Bubble`, `Actions` items, `FileCard`). Metrics mirror antd-x so the swap
 * is invisible: content 16/12 padding with a 12px radius, `filled` on the fill-content token,
 * `borderless` flush on the canvas, a 32px avatar column + 12px gap, and the 4px three-dot
 * typing loader.
 * Bodies stay caller-owned ReactNodes; nothing here knows about messages or parts.
 */
import {useEffect, useRef, type ReactNode} from "react"

import {ArrowDown} from "@phosphor-icons/react"

// The tailwind-merge `cn`, NOT the clsx-only one in utils/styles: a caller's `classNames.content`
// has to actually REPLACE the variant's padding/radius. With plain concatenation both land on the
// element and CSS source order decides, so an override to a smaller scale silently loses.
import {Button} from "../../ui/button"
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "../../ui/tooltip"
import {cn} from "../../ui/utils"

/** The antd-x loading dots: three 4px primary dots on a gentle bounce. */
export const ChatTypingDots = ({className}: {className?: string}) => (
    <span className={cn("flex h-8 items-center gap-2 self-center px-0.5", className)}>
        {[0, 1, 2].map((i) => (
            <span
                key={i}
                className="size-1 rounded-full bg-colorPrimary motion-safe:animate-bounce"
                style={{animationDuration: "1.2s", animationDelay: `${i * 0.2}s`}}
            />
        ))}
    </span>
)

export interface ChatBubbleProps {
    /** `start` hugs the left (assistant), `end` the right (user). */
    placement?: "start" | "end"
    /** `filled` paints the content card, `outlined` draws its border, `borderless` sits flush. */
    variant?: "filled" | "outlined" | "borderless"
    avatar?: ReactNode
    /** Typing indicator — replaces the content with the three-dot loader. */
    loading?: boolean
    content?: ReactNode
    className?: string
    classNames?: {content?: string; body?: string}
}

/**
 * One message bubble: avatar column + content column. Pure chrome — the body is whatever the
 * caller renders (markdown, tool groups, widgets); this only owns placement, fill, and the
 * typing state.
 */
export const ChatBubble = ({
    placement = "start",
    variant = "filled",
    avatar,
    loading = false,
    content,
    className,
    classNames,
}: ChatBubbleProps) => (
    <div
        className={cn(
            "flex gap-3",
            placement === "end" && "flex-row-reverse",
            loading ? "items-center" : "items-start",
            className,
        )}
    >
        {/* 32px slot, not shrink-to-fit: antd-x reserves a 32px avatar column around its 24px
            avatar, so shrink-wrapping moved every message body 8px inboard of the desktop app. */}
        {avatar ? <div className="w-8 shrink-0">{avatar}</div> : null}
        <div className={cn("flex min-w-0 max-w-full flex-col", classNames?.body)}>
            {loading ? (
                <ChatTypingDots />
            ) : (
                <div
                    className={cn(
                        "relative box-border min-w-0 max-w-full break-words text-xs leading-normal text-colorText",
                        variant === "filled" && "rounded-xl bg-colorFillSecondary px-4 py-3",
                        variant === "outlined" &&
                            "rounded-xl border border-solid border-colorBorderSecondary px-4 py-3",
                        variant === "borderless" && "min-h-0 bg-transparent p-0",
                        classNames?.content,
                    )}
                >
                    {content}
                </div>
            )}
        </div>
    </div>
)

/** The 24px round icon avatar the bubbles used (antd `Avatar size="small"` look). */
export const ChatBubbleAvatar = ({icon, className}: {icon: ReactNode; className?: string}) => (
    <span
        className={cn(
            "flex size-6 items-center justify-center rounded-full",
            "bg-colorTextQuaternary text-white",
            className,
        )}
    >
        {icon}
    </span>
)

/** One toolbar icon button with its tooltip — an antd-x `Actions` item, as plain markup. */
/**
 * The per-turn toolbar's reveal, and the row hook it hangs off.
 *
 * A turn's actions and its run metrics only appear on hover or keyboard focus, so a transcript at
 * rest stays quiet. Kept as one definition because it is three coupled parts and a second copy
 * drifts: the row must be `group` (the reveal keys off it) and `ag-turn` (the transcript's bottom
 * fade watches that class and lifts while a turn is hovered, so a revealed toolbar is never washed
 * out), the lane must be reserved in the row's padding or the reveal shifts layout, and the hidden
 * toolbar must be `pointer-events-none` or it swallows clicks while invisible.
 *
 * ```tsx
 * <div className={`${turnRowClass} ${isUser ? "justify-end" : "justify-start"}`}>
 *     …bubble…
 *     <div className={turnToolbarRevealClass}>…actions…</div>
 * </div>
 * ```
 */
export const turnToolbarRevealClass =
    "opacity-0 transition-opacity duration-150 pointer-events-none " +
    "group-hover:opacity-100 group-hover:pointer-events-auto " +
    "focus-within:opacity-100 focus-within:pointer-events-auto"

/**
 * The toolbar's own position: a bare row in the reserved lane, so a turn's meta reads as one quiet
 * line of text rather than as a card competing with the answer above it. `z-10` puts it above a
 * transcript's bottom fade.
 *
 * Combine with `turnToolbarRevealClass` and a side. Both are `11` — the avatar column (w-8) plus
 * its gap (gap-3) — so the row lines up with the MESSAGE, not the avatar: `left-11` starts where
 * the response text does, `right-11` ends where the user bubble does.
 */
/** The user turn's bubble geometry, tighter than the antd-x default it inherits. Geometry only:
 * the tint stays on the desktop, since `--ag-user-bubble-*` is not bridged into /m's tokens. */
export const userBubbleContentClass = "min-w-0 max-w-full overflow-hidden rounded-lg px-3 py-2"

export const turnToolbarClass = "absolute bottom-0 z-10 flex items-center gap-1"

/** The turn row the reveal above hangs off. `pb-8` reserves the toolbar's lane so revealing it
 * never reflows the transcript — the scroll engineering is sensitive to hover-driven layout. The
 * lane is 32px and the toolbar 18px, so the row sits 14px under the bubble. */
export const turnRowClass = "ag-turn group relative flex items-start pb-8"

export const ChatActionIconButton = ({
    label,
    icon,
    onClick,
    tooltip = true,
}: {
    label: string
    icon: ReactNode
    onClick: () => void
    /** Drop the hover tooltip where the icon already says it. `label` still names the button. */
    tooltip?: boolean
}) => {
    const button = (
        <button
            type="button"
            aria-label={label}
            onClick={onClick}
            className={cn(
                // 18px box around the footer's 12px icon. `p-0` is load-bearing: the UA sheet gives
                // a button 6px of side padding, which left an 8px content box and squashed the
                // glyph. `shrink-0` so a tight row squeezes the gap, never the glyph.
                "flex size-[18px] shrink-0 cursor-pointer items-center justify-center rounded border-0 p-0",
                "bg-transparent text-colorTextSecondary transition-colors",
                "hover:bg-colorFillTertiary hover:text-colorText",
            )}
        >
            {icon}
        </button>
    )
    if (!tooltip) return button
    return (
        <TooltipProvider delayDuration={300}>
            <Tooltip>
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                <TooltipContent className="max-w-64 text-xs">{label}</TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}

/**
 * The "Jump to latest" pill that floats over the foot of a transcript once you have scrolled away
 * from the newest turn.
 *
 * ALWAYS mounted so it can fade and slide rather than pop; the hidden state is non-interactive and
 * keeps its own `-translate-x-1/2` (Tailwind composes the x and y translate into one transform, so
 * dropping it while hidden would slide the pill off-centre).
 *
 * Default control size (28px, 15px padding, 14px text) on the scale's 8px radius — the pill shape
 * shrank the label into the corners. Solid elevated surface, border and a light shadow: a
 * transparent pill let streamed text bleed through it.
 * `z-10` puts it above a transcript's bottom fade — source order alone left the gradient painting
 * over the pill whenever no turn was hovered to suppress the fade.
 */
export const ChatJumpToLatest = ({
    show,
    onClick,
    className,
}: {
    show: boolean
    onClick: () => void
    className?: string
}) => {
    const ref = useRef<HTMLButtonElement>(null)
    // `tabIndex={-1}` does not drop focus the element already has, so a button hidden while
    // focused would stay keyboard-reachable while `aria-hidden` — and Enter would still fire it.
    useEffect(() => {
        if (show) return
        const node = ref.current
        if (node && node === document.activeElement) node.blur()
    }, [show])

    return (
        <Button
            ref={ref}
            variant="outline"
            onClick={onClick}
            tabIndex={show ? 0 : -1}
            aria-hidden={!show}
            aria-label="Jump to latest message"
            className={cn(
                // `hover:bg-colorBgElevated` is load-bearing: the variant's hover fill is 4% white
                // in dark mode, which would let streamed text read through the pill.
                "border-colorBorderSecondary bg-colorBgElevated hover:bg-colorBgElevated absolute bottom-2 left-1/2 z-10 -translate-x-1/2 text-xs shadow-sm transition-[opacity,transform] duration-200 ease-out",
                show ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0",
                className,
            )}
        >
            <ArrowDown size={14} />
            Jump to latest
        </Button>
    )
}
