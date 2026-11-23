import {useContext, type ReactNode} from "react"

import {SidebarLayoutContext} from "@agenta/navigation-ui"

import {SidebarTopRow} from "./SidebarTopRow"

/**
 * The agent sidebar's top: Back and the collapse toggle, then the agent switcher. Collapsed, the
 * switcher is a tile under a short rule. `newSession` (the builder's "New chat") follows the
 * switcher; the agent sidebar lists "New session" as a page row instead.
 */
export const AgentSidebarHeader = ({
    collapsed,
    back,
    toggle,
    switcher,
    newSession,
}: {
    collapsed: boolean
    back: ReactNode
    toggle: ReactNode
    switcher: ReactNode
    newSession?: ReactNode
}) => {
    const phone = useContext(SidebarLayoutContext) === "phone"
    return (
        <>
            <SidebarTopRow collapsed={collapsed} back={back} toggle={toggle} />
            {collapsed ? (
                <div className="flex w-full shrink-0 flex-col items-center gap-1 pb-1">
                    <span aria-hidden className="my-1 h-px w-5 bg-[var(--ag-shell-line)]" />
                    {switcher}
                </div>
            ) : (
                <div
                    className={`flex w-full shrink-0 items-center px-2 ${phone ? "pb-1 pt-2" : "pb-2.5"}`}
                >
                    {switcher}
                </div>
            )}
            {newSession}
        </>
    )
}
