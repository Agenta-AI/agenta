import {Button, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle} from "@agenta/ui/ui"
import {ArrowLeft} from "@phosphor-icons/react"

import type {ChannelsPanelRenderProps} from "./useChannelPanel"

export interface ChannelsPanelSheetProps extends ChannelsPanelRenderProps {
    /** The panel's width from `lg` up, in px; 480 when unset. `wide` (720) wins. */
    width?: number
}

/**
 * The container for the Publish and Channels panels, in both apps: a bottom sheet on a phone and
 * the floating right-edge drawer from `lg` up, with Back and the view's mark before the title and
 * Close at the right edge. The body pads 16px, the bleed the panels' footer band assumes.
 */
export const ChannelsPanelSheet = ({
    open,
    title,
    subtitle,
    onClose,
    children,
    wide,
    onBack,
    icon,
    width,
}: ChannelsPanelSheetProps) => (
    <Sheet
        open={open}
        onOpenChange={(next) => {
            if (!next) onClose()
        }}
    >
        {/* `responsive`: a bottom sheet on a phone, the right-edge drawer from lg up. */}
        <SheetContent
            side="responsive"
            style={
                wide || width
                    ? ({
                          "--ag-sheet-responsive-width": `${wide ? 720 : width}px`,
                      } as React.CSSProperties)
                    : undefined
            }
        >
            <SheetHeader className="py-3.5">
                <div className="flex min-w-0 items-center gap-2.5">
                    {onBack ? (
                        <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={onBack}>
                            <ArrowLeft />
                        </Button>
                    ) : null}
                    {icon ? (
                        <span className="flex flex-none items-center text-foreground [&_svg]:size-4">
                            {icon}
                        </span>
                    ) : null}
                    {/* On a phone the subtitle goes under the title, where it has the width to
                        be read; beside the title it was cut to a few words. */}
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
                        <SheetTitle className="flex-none text-[15px]">{title}</SheetTitle>
                        {/* A div: the subtitle may be the agent picker, a button. */}
                        {subtitle ? (
                            <SheetDescription asChild>
                                <div className="min-w-0 text-[13px] sm:truncate">{subtitle}</div>
                            </SheetDescription>
                        ) : null}
                    </div>
                </div>
            </SheetHeader>
            {/* The body scrolls; its corners follow the sheet's, so the footer's band does too. */}
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-b-[inherit] p-4">
                {children}
            </div>
        </SheetContent>
    </Sheet>
)
