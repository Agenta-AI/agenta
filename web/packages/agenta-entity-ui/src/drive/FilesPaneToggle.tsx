import {shortcutAria} from "@agenta/shared/utils"
import {ShortcutKeys} from "@agenta/ui/shortcuts"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {Folder, FolderOpen} from "@phosphor-icons/react"

export function FilesPaneToggle({
    open,
    onToggle,
    disabled = false,
}: {
    open: boolean
    onToggle: () => void
    disabled?: boolean
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
        >
            <span className="inline-flex shrink-0">
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={open ? "Hide files pane" : "Show files pane"}
                    aria-pressed={open}
                    aria-keyshortcuts={shortcutAria("panel.files")}
                    title={disabled ? "Open a conversation to browse files." : undefined}
                    disabled={disabled}
                    onClick={onToggle}
                    className="h-7 w-7 shrink-0 p-0"
                >
                    {open ? <FolderOpen size={14} weight="fill" /> : <Folder size={14} />}
                </Button>
            </span>
        </SimpleTooltip>
    )
}
