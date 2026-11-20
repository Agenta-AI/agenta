import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import phoneCatalog from "@agenta/i18n/catalogs/ui.phone"

import {Button} from "../components/ui/button"
import {Sheet, SheetContent, SheetTitle} from "../components/ui/sheet"
import {cn} from "../utils/styles"

export interface BottomSheetMenuItem {
    /** Stable key of the entry. */
    key: string
    label: ReactNode
    /** One line under the label ("Run on a recurring schedule"). */
    description?: ReactNode
    /** A 18 px icon before the label. */
    icon?: ReactNode
    /** The sheet closes first, then this runs. */
    onSelect: () => void
    disabled?: boolean
    destructive?: boolean
}

export interface BottomSheetMenuProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** The heading of the sheet ("Add automation"). Read as the sheet's name when it is hidden. */
    title: string
    /** Shows the heading. A menu whose trigger already names it may hide it (read only). */
    showTitle?: boolean
    items: BottomSheetMenuItem[]
}

/**
 * A menu of two to five entries that start something, as a bottom sheet on a phone: a grab bar,
 * the heading, one row of at least 56 px per entry, and "Cancel". A tap on "Cancel" or on the
 * dimmed page closes it and changes nothing. A select stays a menu under its field; this is for
 * menus that start a form or an action.
 */
export const BottomSheetMenu = ({
    open,
    onOpenChange,
    title,
    showTitle = true,
    items,
}: BottomSheetMenuProps) => {
    const t = useT(phoneCatalog)
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                side="bottom"
                data-testid="bottom-sheet-menu"
                className="max-h-[85vh] gap-0 overflow-y-auto rounded-t-2xl pb-6 pt-2"
                // The rows are the content; there is no description to point at.
                aria-describedby={undefined}
            >
                <div
                    aria-hidden
                    className="mx-auto mb-2.5 h-[5px] w-9 shrink-0 rounded-full bg-colorBorder"
                />
                <SheetTitle
                    className={cn(
                        "px-4 pb-2 pt-1 text-base font-semibold",
                        !showTitle && "sr-only",
                    )}
                >
                    {title}
                </SheetTitle>
                <div role="menu" aria-label={title} className="flex flex-col">
                    {items.map((item) => (
                        <button
                            key={item.key}
                            type="button"
                            role="menuitem"
                            disabled={item.disabled}
                            className={cn(
                                "box-border flex min-h-14 w-full cursor-pointer items-center gap-3.5 border-0 border-t border-solid border-colorBorderSecondary bg-transparent px-4 py-2 text-left font-[inherit]",
                                "active:bg-colorFillTertiary disabled:cursor-not-allowed disabled:opacity-50",
                            )}
                            onClick={() => {
                                onOpenChange(false)
                                item.onSelect()
                            }}
                        >
                            {item.icon ? (
                                <span
                                    aria-hidden
                                    className={cn(
                                        "flex shrink-0 [&_svg]:size-[18px]",
                                        item.destructive
                                            ? "text-colorError"
                                            : "text-colorTextSecondary",
                                    )}
                                >
                                    {item.icon}
                                </span>
                            ) : null}
                            <span className="flex min-w-0 flex-col">
                                <span
                                    className={cn(
                                        "text-[15px] leading-5",
                                        item.destructive ? "text-colorError" : "text-colorText",
                                    )}
                                >
                                    {item.label}
                                </span>
                                {item.description ? (
                                    <span className="text-xs text-colorTextTertiary">
                                        {item.description}
                                    </span>
                                ) : null}
                            </span>
                        </button>
                    ))}
                </div>
                <div className="px-4 pt-2">
                    <Button
                        variant="outline"
                        className="h-11 w-full rounded-[10px] text-[15px]"
                        onClick={() => onOpenChange(false)}
                    >
                        {t("ui.phone.cancel")}
                    </Button>
                </div>
            </SheetContent>
        </Sheet>
    )
}
