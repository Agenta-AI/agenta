import {useContext, type ReactNode} from "react"

import {SidebarLayoutContext} from "@agenta/navigation-ui"

const ROW =
    "flex w-full shrink-0 items-center border-0 border-b border-solid border-[var(--ag-shell-line)]"

/** The top row of a scope's sidebar: Back and the collapse toggle (the phone sheet: its close). */
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
    return (
        <>
            <div
                className={`${ROW} ${phone ? "h-[52px]" : "h-12"} ${collapsed ? "justify-center" : phone ? "justify-between pl-1.5 pr-1" : "justify-between px-1.5"}`}
            >
                {collapsed ? toggle : back}
                {!collapsed && toggle}
            </div>
            {collapsed && <div className={`${ROW} h-12 justify-center`}>{back}</div>}
        </>
    )
}
