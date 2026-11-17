import {useT} from "@agenta/i18n"
import filesPaneCatalog from "@agenta/i18n/catalogs/entityUi.filesPane"
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
    const t = useT(filesPaneCatalog)
    return (
        <SimpleTooltip
            title={
                disabled ? (
                    t("entityUi.filesPane.openConversationToBrowse")
                ) : (
                    <span className="flex items-center gap-1.5">
                        {open
                            ? t("entityUi.filesPane.hideFiles")
                            : t("entityUi.filesPane.showFiles")}{" "}
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
                    aria-label={
                        open
                            ? t("entityUi.filesPane.hideFilesPane")
                            : t("entityUi.filesPane.showFilesPane")
                    }
                    aria-pressed={open}
                    aria-keyshortcuts={shortcutAria("panel.files")}
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
