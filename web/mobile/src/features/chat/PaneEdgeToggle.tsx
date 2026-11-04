import {shortcutAria} from "@agenta/shared/utils"
import {ShortcutKeys} from "@agenta/ui/shortcuts"
import {PANE_SLIDE_MS, SimpleTooltip} from "@agenta/ui/ui"
import {CaretLeftIcon, CaretRightIcon} from "@phosphor-icons/react"
import clsx from "clsx"

/**
 * The pill on a side panel's edge that opens and closes it. Open, it sits across the panel's
 * edge; closed, it hangs off the workspace's edge with only its inner half showing.
 */
export const PaneEdgeToggle = ({
    side,
    open,
    offset,
    animate,
    label,
    shortcutId,
    onToggle,
}: {
    side: "left" | "right"
    open: boolean
    /** Distance from the workspace's edge to the panel's inner edge, in px. */
    offset: number
    /** The panel is sliding, so the pill follows it. Off during a drag. */
    animate: boolean
    label: string
    shortcutId: string
    onToggle: () => void
}) => {
    const pointsLeft = (side === "left") === open
    const Caret = pointsLeft ? CaretLeftIcon : CaretRightIcon

    return (
        <SimpleTooltip
            side={side === "left" ? "right" : "left"}
            title={
                <span className="flex items-center gap-1.5">
                    {label} <ShortcutKeys id={shortcutId} tone="inverse" />
                </span>
            }
        >
            <button
                type="button"
                aria-label={label}
                aria-expanded={open}
                aria-keyshortcuts={shortcutAria(shortcutId)}
                onClick={onToggle}
                style={{
                    [side]: offset,
                    transition: animate ? `${side} ${PANE_SLIDE_MS}ms ease` : undefined,
                }}
                className={clsx(
                    "border-border bg-background text-muted-foreground hover:text-foreground absolute top-1/2 z-20 box-border flex h-10 w-5 -translate-y-1/2 cursor-pointer items-center justify-center border border-solid p-0 shadow-sm",
                    open && "rounded-full",
                    open && (side === "left" ? "-translate-x-1/2" : "translate-x-1/2"),
                    !open &&
                        (side === "left"
                            ? "rounded-r-full border-l-0"
                            : "rounded-l-full border-r-0"),
                )}
            >
                <Caret size={12} aria-hidden />
            </button>
        </SimpleTooltip>
    )
}
