import {SheetFooter} from "@agenta/ui/ui"

/**
 * The panel's action bar: the kit's sheet footer, pinned to the bottom of the scrolling body.
 * The solid layer under it keeps scrolled content from showing through its tinted band.
 */
export const PanelFooter = ({children}: {children: React.ReactNode}) => (
    <div className="sticky -bottom-4 z-10 -mx-4 -mb-4 mt-auto rounded-b-[inherit] bg-background">
        <SheetFooter>{children}</SheetFooter>
    </div>
)
