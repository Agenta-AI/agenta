import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import phoneCatalog from "@agenta/i18n/catalogs/ui.phone"

import {Button} from "../components/ui/button"
import {Sheet, SheetContent, SheetTitle} from "../components/ui/sheet"
import {cn} from "../utils/styles"

/** A phone button: 44 px high, as wide as its row, the phone's 15 px text. */
export const PHONE_BUTTON_CLASS = "h-11 w-full gap-2 rounded-[10px] text-[15px]"

export interface BottomSheetProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** The heading of the sheet. Read as the sheet's name when it is hidden. */
    title: string
    /** Shows the heading. A sheet whose trigger already names it may hide it (read only). */
    showTitle?: boolean
    /** Buttons above "Cancel" (for example "New session"). Use `PHONE_BUTTON_CLASS`. */
    actions?: ReactNode
    "data-testid"?: string
    children: ReactNode
}

/**
 * A bottom sheet on a phone: a grab bar, the heading, the content (it scrolls when it is long),
 * optional actions, and "Cancel". "Cancel" and the dimmed page close it and change nothing.
 */
export const BottomSheet = ({
    open,
    onOpenChange,
    title,
    showTitle = true,
    actions,
    "data-testid": testId = "bottom-sheet",
    children,
}: BottomSheetProps) => {
    const t = useT(phoneCatalog)
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                side="bottom"
                data-testid={testId}
                className="max-h-[85vh] gap-0 rounded-t-2xl pb-6 pt-2"
                // The content names itself; there is no description to point at.
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
                <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
                <div className="flex shrink-0 flex-col gap-2 px-4 pt-2">
                    {actions}
                    <Button
                        variant="outline"
                        className={PHONE_BUTTON_CLASS}
                        onClick={() => onOpenChange(false)}
                    >
                        {t("ui.phone.cancel")}
                    </Button>
                </div>
            </SheetContent>
        </Sheet>
    )
}
