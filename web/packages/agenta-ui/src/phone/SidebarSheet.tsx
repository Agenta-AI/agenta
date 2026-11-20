import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import phoneCatalog from "@agenta/i18n/catalogs/ui.phone"
import {X} from "@phosphor-icons/react"

import {Button} from "../components/ui/button"
import {Sheet, SheetContent, SheetTitle} from "../components/ui/sheet"
import {cn} from "../utils/styles"

/** The width of the sidebar sheet on a phone, in px. */
export const SIDEBAR_SHEET_WIDTH = 300

/**
 * Classes for a row of the sidebar sheet: 44 px high, the icon and the label on one line, the
 * label cut with an ellipsis. A sidebar puts them on its rows when it renders in the sheet.
 */
export const SIDEBAR_SHEET_ROW_CLASS =
    "box-border flex h-11 min-w-0 items-center gap-2.5 rounded-lg px-3 text-[15px] [&>span]:truncate"

export interface SidebarSheetProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** The sheet's name for assistive technology (the sidebar has its own visible heading). */
    title: string
    /** Controls at the left of the top row, before "Close the sidebar" (for example "Back"). */
    leading?: ReactNode
    /**
     * Draws the top row with "Close the sidebar". Off for a sidebar that brings its own top row
     * with Back and Close (the app sidebar, through its dismiss handler); the sheet then has no
     * padding and the sidebar fills it.
     */
    header?: boolean
    children: ReactNode
    className?: string
}

/**
 * The sidebar of a phone in a sheet from the left: 300 px wide, inset 8 px, a dimmed page behind
 * it. The top row holds `leading` and "Close the sidebar"; a tap on the dimmed page also closes
 * it. The sidebar inside sets its rows with `SIDEBAR_SHEET_ROW_CLASS`.
 */
export const SidebarSheet = ({
    open,
    onOpenChange,
    title,
    leading,
    header = true,
    children,
    className,
}: SidebarSheetProps) => {
    const t = useT(phoneCatalog)
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                side="left"
                data-testid="sidebar-sheet"
                aria-describedby={undefined}
                className={cn("gap-0 overflow-hidden", header && "px-2 pb-2", className)}
                style={{width: SIDEBAR_SHEET_WIDTH, maxWidth: "calc(100vw - 16px)"}}
            >
                <SheetTitle className="sr-only">{title}</SheetTitle>
                {header ? (
                    <div className="-mx-2 flex h-[52px] shrink-0 items-center gap-1 border-0 border-b border-solid border-colorBorderSecondary pl-1.5 pr-1">
                        <div className="flex min-w-0 flex-1 items-center">{leading}</div>
                        <Button
                            variant="ghost"
                            aria-label={t("ui.phone.closeSidebar")}
                            className="size-11 shrink-0 rounded-lg p-0 text-colorTextSecondary [&_svg]:size-5"
                            onClick={() => onOpenChange(false)}
                        >
                            <X />
                        </Button>
                    </div>
                ) : null}
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
            </SheetContent>
        </Sheet>
    )
}
