import {ChannelsPage} from "@agenta/settings-ui"

import {Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle} from "@/components/ui/sheet"

/**
 * Mobile binding: the shared Channels page with this app's bottom sheet as the sliding panel.
 * Parity with the desktop drawer — the connect flow and manage view are the same shared code.
 *
 * FIRST PASS: `ChannelsPage` holds connections in local state (no data layer yet). The agent
 * name is a placeholder; wire it and `initialConnections` to real data when the backend lands.
 */
export const ChannelsTab = () => (
    <ChannelsPage
        agentName="your agent"
        renderPanel={({open, title, subtitle, onClose, children}) => (
            <Sheet open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
                <SheetContent side="responsive" className="overflow-y-auto">
                    <SheetHeader>
                        <SheetTitle>{title}</SheetTitle>
                        {subtitle ? <SheetDescription>{subtitle}</SheetDescription> : null}
                    </SheetHeader>
                    <div className="px-4 pb-6">{children}</div>
                </SheetContent>
            </Sheet>
        )}
    />
)
