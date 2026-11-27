import type {ViewType} from "@agenta/entity-ui/view-types"
import {useT} from "@agenta/i18n"
import valueViewCatalog from "@agenta/i18n/catalogs/chat.valueView"
import viewTypesCatalog from "@agenta/i18n/catalogs/entityUi.viewTypes"
import editorCatalog from "@agenta/i18n/catalogs/testsets.testcaseEditor"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {DotsThree} from "@phosphor-icons/react"

/** What the field menu can do to the column of a field. */
export interface FieldColumnActions {
    /** Off while a save runs; the menu items say nothing, the reason is the item's title. */
    blockedReason: string | null
    /** Absent for a group of columns, which can only be deleted. */
    onRename?: () => void
    onDelete: () => void
}

const useViewLabel = () => {
    const t = useT(viewTypesCatalog, editorCatalog)
    return (view: ViewType, list: boolean) => {
        if (view === "json") return "JSON"
        if (view === "yaml") return "YAML"
        if (view === "markdown") return "Markdown"
        if (view === "form") {
            return list ? t("testsets.testcaseEditor.viewList") : t("entityUi.viewTypes.form")
        }
        if (view === "chat") return t("entityUi.viewTypes.chat")
        return t("entityUi.viewTypes.text")
    }
}

/**
 * The menu of one field, on hover: Show as, Copy value, and the column actions. Rename and
 * Delete open the test set page's column steps, which ask before they change every row.
 */
export const FieldMenu = ({
    name,
    views,
    view,
    list,
    onViewChange,
    onCopy,
    column,
}: {
    name: string
    views: ViewType[]
    view: ViewType
    /** The "form" view of a list is called List. */
    list: boolean
    onViewChange: (view: ViewType) => void
    onCopy: () => void
    column?: FieldColumnActions | null
}) => {
    const t = useT(editorCatalog, valueViewCatalog)
    const viewLabel = useViewLabel()
    const blocked = column?.blockedReason ?? undefined
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("testsets.testcaseEditor.fieldActions", {name})}
                    className="text-muted-foreground opacity-0 group-hover/field:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                >
                    <DotsThree aria-hidden size={14} />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
                {views.length > 1 ? (
                    <>
                        <DropdownMenuLabel>{t("testsets.testcaseEditor.showAs")}</DropdownMenuLabel>
                        <DropdownMenuRadioGroup
                            value={view}
                            onValueChange={(next) => onViewChange(next as ViewType)}
                        >
                            {views.map((option) => (
                                <DropdownMenuRadioItem key={option} value={option}>
                                    {viewLabel(option, list)}
                                </DropdownMenuRadioItem>
                            ))}
                        </DropdownMenuRadioGroup>
                        <DropdownMenuSeparator />
                    </>
                ) : null}
                <DropdownMenuItem onSelect={onCopy}>
                    {t("chat.valueView.copyValue")}
                </DropdownMenuItem>
                {column?.onRename ? (
                    <DropdownMenuItem
                        disabled={blocked !== undefined}
                        title={blocked}
                        onSelect={column.onRename}
                    >
                        {t("testsets.testcaseEditor.renameColumn")}
                    </DropdownMenuItem>
                ) : null}
                {column ? (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            variant="destructive"
                            disabled={blocked !== undefined}
                            title={blocked}
                            onSelect={column.onDelete}
                        >
                            {t("testsets.testcaseEditor.deleteColumn")}
                        </DropdownMenuItem>
                    </>
                ) : null}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
