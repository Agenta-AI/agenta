import type {ChannelsPanelRenderProps} from "@agenta/settings-ui"

import {Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle} from "@/components/ui/sheet"

/** The /m container for the Channels panels and every Publish panel. */
export const ChannelsPanelSheet = ({
    open,
    title,
    subtitle,
    onClose,
    children,
}: ChannelsPanelRenderProps) => (
    <Sheet
        open={open}
        onOpenChange={(next) => {
            if (!next) onClose()
        }}
    >
        {/* `responsive` is this app's form-panel idiom: a bottom sheet on a phone, the
            right-edge drawer from lg up — where the desktop shows its own Drawer. */}
        <SheetContent side="responsive">
            <SheetHeader>
                <SheetTitle>{title}</SheetTitle>
                {subtitle ? <SheetDescription>{subtitle}</SheetDescription> : null}
            </SheetHeader>
            {/* The connect flow is taller than a phone, so the body is the scroller.
                `min-h-0` is what lets it shrink inside the sheet's flex column. */}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
        </SheetContent>
    </Sheet>
)
