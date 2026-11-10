import {shortcutAria} from "@agenta/shared/utils"
import {ShortcutKeys} from "@agenta/ui/shortcuts"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {CaretDoubleLeftIcon, CaretDoubleRightIcon} from "@phosphor-icons/react"

/** Opens and closes the config pane: atop the pane while open, at the bar's start while closed. */
export const ConfigPaneToggle = ({
    open,
    onToggle,
    size = "icon-sm",
}: {
    open: boolean
    onToggle: () => void
    /** The phone bar's buttons are the larger touch size. */
    size?: "icon" | "icon-sm"
}) => {
    const label = open ? "Hide configuration" : "Show configuration"
    return (
        <SimpleTooltip
            title={
                <span className="flex items-center gap-1.5">
                    {label} <ShortcutKeys id="panel.config" tone="inverse" />
                </span>
            }
        >
            <Button
                variant="ghost"
                size={size}
                aria-label={label}
                aria-expanded={open}
                aria-keyshortcuts={shortcutAria("panel.config")}
                onClick={onToggle}
                className="text-muted-foreground hover:text-foreground aria-expanded:bg-transparent aria-expanded:text-muted-foreground hover:aria-expanded:bg-accent hover:aria-expanded:text-foreground"
            >
                {open ? <CaretDoubleLeftIcon /> : <CaretDoubleRightIcon />}
            </Button>
        </SimpleTooltip>
    )
}
