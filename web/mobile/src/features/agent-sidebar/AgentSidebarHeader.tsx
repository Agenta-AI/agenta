import {useContext, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import agentSidebarCatalog from "@agenta/i18n/catalogs/agentSidebar"
import {SidebarLayoutContext} from "@agenta/navigation-ui"
import {ArrowsInLineVerticalIcon} from "@phosphor-icons/react"

import {SidebarTopRow} from "./SidebarTopRow"

const ROW =
    "flex w-full shrink-0 items-center border-0 border-b border-solid border-[var(--ag-shell-line)]"

/**
 * The agent sidebar's top: Back and the collapse toggle, then the agent switcher and the fold
 * button, then "New session". Collapsed, the toggle keeps the spot every collapsed rail gives it,
 * Back takes the next row, and the fold button hides. In the phone sheet the switcher row has no
 * fold button and no rule under it: "Back" already returns to the main sidebar.
 */
export const AgentSidebarHeader = ({
    collapsed,
    back,
    toggle,
    switcher,
    newSession,
    onFold,
}: {
    collapsed: boolean
    back: ReactNode
    toggle: ReactNode
    switcher: ReactNode
    newSession: ReactNode
    /** Back to the main sidebar; the page stays. */
    onFold: () => void
}) => {
    const t = useT(agentSidebarCatalog)
    const phone = useContext(SidebarLayoutContext) === "phone"
    return (
        <>
            <SidebarTopRow collapsed={collapsed} back={back} toggle={toggle} />
            {phone ? (
                <div className="flex w-full shrink-0 items-center px-2 pb-1 pt-2">{switcher}</div>
            ) : (
                <div className={`${ROW} h-12 gap-1 ${collapsed ? "justify-center" : "px-1.5"}`}>
                    {switcher}
                    {collapsed ? null : (
                        <button
                            type="button"
                            aria-label={t("agentSidebar.backToMainSidebar")}
                            title={t("agentSidebar.backToMainSidebar")}
                            onClick={onFold}
                            className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 text-colorTextSecondary [font-family:inherit] hover:bg-colorSplit hover:text-colorText"
                        >
                            <ArrowsInLineVerticalIcon size={16} />
                        </button>
                    )}
                </div>
            )}
            {newSession}
        </>
    )
}
