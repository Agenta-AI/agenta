import type {ReactNode} from "react"

import {MENU_ITEM} from "../components/ui/menu-item"
import {cn} from "../utils/styles"

import {BottomSheet} from "./BottomSheet"

export interface BottomSheetMenuItem {
    /** Stable key of the entry. */
    key: string
    label: ReactNode
    /** One line under the label ("Run on a recurring schedule"). */
    description?: ReactNode
    /** A 16 px icon before the label. */
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
    /** The control that opens the menu; it gets the focus back when the menu closes. */
    trigger?: ReactNode
}

/**
 * A menu of two to five entries that start something, as a bottom sheet on a phone: a grab bar,
 * the heading, the same MENU_ITEM row as every menu (ROW-02, nothing bigger on a phone: SIZE-02),
 * and "Cancel". A tap on "Cancel" or on the
 * dimmed page closes it and changes nothing. A select stays a menu under its field; this is for
 * menus that start a form or an action.
 */
export const BottomSheetMenu = ({
    open,
    onOpenChange,
    title,
    showTitle = true,
    items,
    trigger,
}: BottomSheetMenuProps) => {
    return (
        <BottomSheet
            open={open}
            onOpenChange={onOpenChange}
            title={title}
            showTitle={showTitle}
            trigger={trigger}
            data-testid="bottom-sheet-menu"
        >
            <div role="menu" aria-label={title} className="flex flex-col px-2">
                {items.map((item) => (
                    <button
                        key={item.key}
                        type="button"
                        role="menuitem"
                        disabled={item.disabled}
                        className={cn(
                            MENU_ITEM,
                            "border-0 bg-transparent text-left font-[inherit] hover:bg-accent focus-visible:bg-accent active:bg-accent disabled:cursor-not-allowed disabled:opacity-50",
                            Boolean(item.description) && "min-h-row-double",
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
                                    "flex shrink-0",
                                    item.destructive ? "text-destructive" : "text-muted-foreground",
                                )}
                            >
                                {item.icon}
                            </span>
                        ) : null}
                        <span className="flex min-w-0 flex-col">
                            <span
                                className={cn(
                                    "text-label",
                                    item.destructive ? "text-destructive" : "text-foreground",
                                )}
                            >
                                {item.label}
                            </span>
                            {item.description ? (
                                <span className="text-meta text-muted-foreground">
                                    {item.description}
                                </span>
                            ) : null}
                        </span>
                    </button>
                ))}
            </div>
        </BottomSheet>
    )
}
