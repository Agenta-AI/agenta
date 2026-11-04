import {shortcutAria} from "@agenta/shared/utils"
import {ShortcutKeys} from "@agenta/ui/shortcuts"
import {PANE_SLIDE_MS, SimpleTooltip} from "@agenta/ui/ui"
import {CaretLeftIcon, CaretRightIcon} from "@phosphor-icons/react"
import clsx from "clsx"

/**
 * The pill that opens and closes the left panel. One shape in both states: open, it sits across
 * the panel's edge; closed, it rests against the workspace's edge.
 */
export const PaneEdgeToggle = ({
    open,
    offset,
    animate,
    label,
    shortcutId,
    onToggle,
}: {
    open: boolean
    /** Distance from the workspace's edge to the panel's inner edge, in px. */
    offset: number
    /** The panel is sliding, so the pill follows it. Off during a drag. */
    animate: boolean
    label: string
    shortcutId: string
    onToggle: () => void
}) => {
    const Caret = open ? CaretLeftIcon : CaretRightIcon

    return (
        <SimpleTooltip
            side="right"
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
                    left: offset,
                    transition: animate ? `left ${PANE_SLIDE_MS}ms ease` : undefined,
                }}
                className={clsx(
                    "border-border bg-background text-muted-foreground hover:text-foreground absolute top-1/2 z-20 box-border flex h-10 w-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-solid p-0 shadow-sm",
                    open && "-translate-x-1/2",
                )}
            >
                <Caret size={12} aria-hidden />
            </button>
        </SimpleTooltip>
    )
}
