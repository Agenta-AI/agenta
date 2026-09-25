/** The panel's action bar, pinned to the bottom of the scrolling body. */
export const PanelFooter = ({children}: {children: React.ReactNode}) => (
    <div className="sticky -bottom-4 z-10 -mx-4 -mb-4 mt-auto flex flex-col gap-2 border-0 border-t border-solid border-border bg-background px-4 py-3.5">
        {children}
    </div>
)
