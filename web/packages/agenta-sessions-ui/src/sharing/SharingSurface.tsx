import type {ReactNode} from "react"

import {useMediaQuery} from "@agenta/ui/hooks"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@agenta/ui/ui"

/** The app's phone/desktop line (`lg`), as `PickerOverlay` reads it. */
const WIDE_QUERY = "(min-width: 64rem)"

export interface SharingSurfaceProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    description?: string
    footer?: ReactNode
    children: ReactNode
}

/** A dialog from `lg` up and a bottom sheet below it: the sharing dialogs' one frame. */
export const SharingSurface = ({
    open,
    onOpenChange,
    title,
    description,
    footer,
    children,
}: SharingSurfaceProps) => {
    const wide = useMediaQuery(WIDE_QUERY)

    if (wide) {
        return (
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="max-w-[560px]">
                    <DialogHeader>
                        <DialogTitle>{title}</DialogTitle>
                        {description ? <DialogDescription>{description}</DialogDescription> : null}
                    </DialogHeader>
                    {children}
                    {footer ? <DialogFooter>{footer}</DialogFooter> : null}
                </DialogContent>
            </Dialog>
        )
    }

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="responsive" className="gap-4 overflow-y-auto">
                <SheetHeader>
                    <SheetTitle>{title}</SheetTitle>
                    {description ? <SheetDescription>{description}</SheetDescription> : null}
                </SheetHeader>
                <div className="flex flex-col gap-4 px-4">{children}</div>
                {footer ? <SheetFooter>{footer}</SheetFooter> : null}
            </SheetContent>
        </Sheet>
    )
}
