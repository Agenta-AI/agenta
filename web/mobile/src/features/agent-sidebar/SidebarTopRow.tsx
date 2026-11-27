import type {ReactNode} from "react"

/** A scope sidebar's top row: Back and the collapse toggle; collapsed, the toggle sits above Back. */
export const SidebarTopRow = ({
    collapsed,
    back,
    toggle,
}: {
    collapsed: boolean
    back: ReactNode
    toggle: ReactNode
}) => {
    if (collapsed)
        return (
            <div className="flex w-full shrink-0 flex-col items-center justify-center gap-1 pb-1 pt-2">
                {toggle}
                {back}
            </div>
        )
    return (
        <div className="flex h-12 w-full shrink-0 items-center justify-between gap-0.5 px-2">
            {back}
            {toggle}
        </div>
    )
}
