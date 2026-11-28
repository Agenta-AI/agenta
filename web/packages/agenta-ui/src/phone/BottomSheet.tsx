import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import phoneCatalog from "@agenta/i18n/catalogs/ui.phone"

import {Button} from "../components/ui/button"
import {Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger} from "../components/ui/sheet"
import {cn} from "../components/ui/utils"

import {PHONE_BUTTON_CLASS} from "./phoneButton"

export interface BottomSheetProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** The heading of the sheet. Read as the sheet's name when it is hidden. */
    title: string
    /** Shows the heading. A sheet whose trigger already names it may hide it (read only). */
    showTitle?: boolean
    /**
     * The control that opens the sheet. Given here, it opens the sheet and gets the focus back when
     * the sheet closes. It must take a ref and an onClick (a button, or an element with the button
     * role and its own keyboard handling).
     */
    trigger?: ReactNode
    /** Buttons above "Cancel" (for example "New session"). Use `PHONE_BUTTON_CLASS`. */
    actions?: ReactNode
    /** No visible "Cancel": choices apply on tap; a tap outside, Escape or a screen reader's Close shuts it. */
    hideClose?: boolean
    /** Leaves the focus off the first field on open, so a phone keyboard stays down. */
    keepKeyboardClosed?: boolean
    /** Radix's close-focus hook: a caller that moves the focus itself prevents the default. */
    onCloseAutoFocus?: (event: Event) => void
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
    hideClose = false,
    keepKeyboardClosed = false,
    trigger,
    onCloseAutoFocus,
    "data-testid": testId = "bottom-sheet",
    children,
}: BottomSheetProps) => {
    const t = useT(phoneCatalog, commonCatalog)
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            {trigger ? <SheetTrigger asChild>{trigger}</SheetTrigger> : null}
            <SheetContent
                side="bottom"
                data-testid={testId}
                // The one sheet shape, shared with touch.css; svh and the safe area (COMPACT-05).
                className="max-h-[85svh] gap-0 rounded-t-xl pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-2"
                // The content names itself; there is no description to point at.
                aria-describedby={undefined}
                onOpenAutoFocus={keepKeyboardClosed ? (event) => event.preventDefault() : undefined}
                onCloseAutoFocus={onCloseAutoFocus}
            >
                <div
                    aria-hidden
                    className="mx-auto mb-2.5 h-[5px] w-9 shrink-0 rounded-sm bg-border"
                />
                <SheetTitle className={cn("px-4 pb-2 pt-1 text-title", !showTitle && "sr-only")}>
                    {title}
                </SheetTitle>
                <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
                {/* Last, so the open focus does not land on it; only a screen reader finds it. */}
                {hideClose ? (
                    <SheetClose className="sr-only">{t("common.close")}</SheetClose>
                ) : null}
                {hideClose && !actions ? null : (
                    <div className="flex shrink-0 flex-col gap-2 px-4 pt-2">
                        {actions}
                        {hideClose ? null : (
                            <Button
                                variant="outline"
                                // fg2 text, as the canvas draws Cancel (M11).
                                className={cn(PHONE_BUTTON_CLASS, "text-muted-foreground")}
                                onClick={() => onOpenChange(false)}
                            >
                                {t("ui.phone.cancel")}
                            </Button>
                        )}
                    </div>
                )}
            </SheetContent>
        </Sheet>
    )
}
