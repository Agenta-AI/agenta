import type {ChannelsPanelRenderProps} from "@agenta/settings-ui"
import {Button, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle} from "@agenta/ui/ui"
import {ArrowLeft} from "@phosphor-icons/react"

/** The /m container for the Publish and Channels panels. */
export const ChannelsPanelSheet = ({
    open,
    title,
    subtitle,
    onClose,
    children,
    wide,
    onBack,
    icon,
}: ChannelsPanelRenderProps) => (
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
                wide ? ({"--ag-sheet-responsive-width": "720px"} as React.CSSProperties) : undefined
            }
        >
            <SheetHeader className="border-0 border-b border-solid border-border py-3.5">
                <div className="flex min-w-0 items-center gap-2.5">
                    {onBack ? (
                        <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={onBack}>
                            <ArrowLeft />
                        </Button>
                    ) : null}
                    {icon ? (
                        <span className="flex size-8 flex-none items-center justify-center rounded-lg border border-solid border-border text-foreground">
                            {icon}
                        </span>
                    ) : null}
                    <div className="flex min-w-0 flex-1 flex-col">
                        <SheetTitle className="text-[15px]">{title}</SheetTitle>
                        {/* A div: the subtitle may be the agent picker, a button. */}
                        {subtitle ? (
                            <SheetDescription asChild>
                                <div className="truncate text-xs">{subtitle}</div>
                            </SheetDescription>
                        ) : null}
                    </div>
                </div>
            </SheetHeader>
            {/* The body scrolls; `min-h-0` lets it shrink inside the sheet's flex column. */}
            <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        </SheetContent>
    </Sheet>
)
