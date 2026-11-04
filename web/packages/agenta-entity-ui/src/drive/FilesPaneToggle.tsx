import {shortcutAria} from "@agenta/shared/utils"
import {ShortcutKeys} from "@agenta/ui/shortcuts"
import {Button, SimpleTooltip, type SimpleTooltipProps} from "@agenta/ui/ui"
import {Folder, FolderOpen} from "@phosphor-icons/react"

export function FilesPaneToggle({
    open,
    onToggle,
    disabled = false,
    tooltipSide,
}: {
    open: boolean
    onToggle: () => void
    disabled?: boolean
    tooltipSide?: SimpleTooltipProps["side"]
}) {
    return (
        <SimpleTooltip
            title={
                disabled ? (
                    "Open a conversation to browse files."
                ) : (
                    <span className="flex items-center gap-1.5">
                        {open ? "Hide files" : "Show files"}{" "}
                        <ShortcutKeys id="panel.files" tone="inverse" />
                    </span>
                )
            }
            side={tooltipSide}
        >
            <span className="inline-flex shrink-0">
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={open ? "Hide files pane" : "Show files pane"}
                    aria-pressed={open}
                    aria-keyshortcuts={shortcutAria("panel.files")}
                    disabled={disabled}
                    onClick={onToggle}
                >
                    {open ? <FolderOpen weight="fill" /> : <Folder />}
                </Button>
            </span>
        </SimpleTooltip>
    )
}
