import {useContext, type ReactNode} from "react"

import {SidebarLayoutContext} from "@agenta/navigation-ui"

/**
 * The top row of a scope's sidebar: Back and the collapse toggle, as the Settings sidebar draws
 * them (the phone sheet: its close). Collapsed, the toggle sits above Back.
 */
export const SidebarTopRow = ({
    collapsed,
    back,
    toggle,
}: {
    collapsed: boolean
    back: ReactNode
    toggle: ReactNode
}) => {
    const phone = useContext(SidebarLayoutContext) === "phone"
    if (collapsed)
        return (
            <div className="flex w-full shrink-0 flex-col items-center justify-center gap-1 py-1">
                {toggle}
                {back}
            </div>
        )
    return (
        <div
            className={`flex w-full shrink-0 items-center justify-between gap-0.5 ${phone ? "h-[52px] pl-1.5 pr-1" : "h-12 px-2"}`}
        >
            {back}
            {toggle}
        </div>
    )
}
