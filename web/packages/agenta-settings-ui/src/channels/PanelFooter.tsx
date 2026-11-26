import {SheetFooter} from "@agenta/ui/ui"

/**
 * The panel's action bar: the kit's sheet footer, pinned to the bottom of the scrolling body.
 * It bleeds to the body's edges by `--panel-bleed-x` (the body's side padding, 16px by default).
 */
export const PanelFooter = ({children}: {children: React.ReactNode}) => (
    <div className="sticky -bottom-4 z-10 -mx-[var(--panel-bleed-x,1rem)] -mb-4 mt-auto rounded-b-[inherit] bg-background">
        <SheetFooter>{children}</SheetFooter>
    </div>
)
