import type {ReactNode} from "react"

import {useIsPhone} from "@agenta/ui/phone"
import {Sheet, SheetContent, SheetTitle} from "@agenta/ui/ui"

import {PagePaneHeader} from "./PagePaneHeader"

/** What a page puts in the right pane (LAYOUT-04): one thing at a time. */
export interface PagePane {
    title: ReactNode
    content: ReactNode
    open: boolean
    onOpenChange: (open: boolean) => void
}

/**
 * The right pane, a slot of the layout that any page can fill. Docked beside the content on an
 * expanded window; an overlay with the scrim on a medium one; a full-page drill-in with Back on a
 * phone, so the page under it keeps its state.
 */
export const PageRightPane = ({pane, docked}: {pane: PagePane; docked: boolean}) => {
    const phone = useIsPhone()
    const close = () => pane.onOpenChange(false)

    if (docked) {
        if (!pane.open) return null
        return (
            <aside className="flex h-full w-panel-side shrink-0 flex-col border-0 border-l border-solid border-border-muted bg-muted">
                <PagePaneHeader title={pane.title} onClose={close} back={false} />
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-6 sm:px-6">
                    {pane.content}
                </div>
            </aside>
        )
    }

    return (
        <Sheet open={pane.open} onOpenChange={pane.onOpenChange}>
            <SheetContent
                side="right"
                aria-describedby={undefined}
                className={
                    phone
                        ? "inset-0 w-full max-w-none rounded-none"
                        : "w-panel-side max-w-none bg-muted"
                }
            >
                <SheetTitle className="sr-only">{pane.title}</SheetTitle>
                <PagePaneHeader title={pane.title} onClose={close} back={phone} />
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-6 sm:px-6">
                    {pane.content}
                </div>
            </SheetContent>
        </Sheet>
    )
}
