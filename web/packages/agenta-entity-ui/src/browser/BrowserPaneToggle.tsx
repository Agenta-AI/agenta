import {Button, SimpleTooltip, type SimpleTooltipProps} from "@agenta/ui/ui"
import {Globe} from "@phosphor-icons/react"

/** The tab strip's browser toggle, beside the Files toggle; a dot while the agent waits for you. */
export function BrowserPaneToggle({
    open,
    onToggle,
    needsYou = false,
    tooltipSide,
}: {
    open: boolean
    onToggle: () => void
    needsYou?: boolean
    tooltipSide?: SimpleTooltipProps["side"]
}) {
    const label = needsYou
        ? "The agent needs you in the browser"
        : open
          ? "Hide browser"
          : "Show browser"
    return (
        <SimpleTooltip title={label} side={tooltipSide}>
            <span className="inline-flex shrink-0">
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={open ? "Hide browser pane" : "Show browser pane"}
                    aria-pressed={open}
                    onClick={onToggle}
                    className="relative"
                >
                    <Globe weight={open ? "fill" : "regular"} />
                    {needsYou ? (
                        <span
                            aria-hidden
                            className="absolute right-1 top-1 size-1.5 rounded-full bg-primary"
                        />
                    ) : null}
                </Button>
            </span>
        </SimpleTooltip>
    )
}
