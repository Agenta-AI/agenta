import type {ReactNode} from "react"

import {cn} from "../utils/styles"

import {BottomSheet} from "./BottomSheet"

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
    return (
        <BottomSheet
            open={open}
            onOpenChange={onOpenChange}
            title={title}
            showTitle={showTitle}
            data-testid="bottom-sheet-menu"
        >
            <div role="menu" aria-label={title} className="flex flex-col">
                {items.map((item) => (
                    <button
                        key={item.key}
                        type="button"
                        role="menuitem"
                        disabled={item.disabled}
                        className={cn(
                            "box-border flex min-h-14 w-full cursor-pointer items-center gap-3.5 border-0 border-t border-solid border-colorBorderSecondary bg-transparent px-4 py-2 text-left font-[inherit]",
                            "outline-none active:bg-colorFillTertiary focus-visible:bg-colorFillTertiary disabled:cursor-not-allowed disabled:opacity-50",
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
        </BottomSheet>
    )
}
