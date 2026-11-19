import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import agentSidebarCatalog from "@agenta/i18n/catalogs/agentSidebar"
import {SidebarSimpleIcon} from "@phosphor-icons/react"

const ROW =
    "flex w-full shrink-0 items-center border-0 border-b border-solid border-[var(--ag-shell-line)]"

/**
 * The agent sidebar's top: Back and the collapse toggle, then the agent switcher and the fold
 * button. Collapsed, the toggle keeps the spot every collapsed rail gives it, Back takes the next
 * row, and the fold button hides.
 */
export const AgentSidebarHeader = ({
    collapsed,
    back,
    toggle,
    switcher,
    onFold,
}: {
    collapsed: boolean
    back: ReactNode
    toggle: ReactNode
    switcher: ReactNode
    /** Back to the main sidebar; the page stays. */
    onFold: () => void
}) => {
    const t = useT(agentSidebarCatalog)
    return (
        <>
            <div
                className={`${ROW} h-[45px] ${collapsed ? "justify-center" : "justify-between px-1.5"}`}
            >
                {collapsed ? toggle : back}
                {!collapsed && toggle}
            </div>
            {collapsed && <div className={`${ROW} h-[45px] justify-center`}>{back}</div>}
            <div className={`${ROW} min-h-[52px] gap-1 ${collapsed ? "justify-center" : "px-1.5"}`}>
                {switcher}
                {collapsed ? null : (
                    <button
                        type="button"
                        aria-label={t("agentSidebar.backToMainSidebar")}
                        title={t("agentSidebar.backToMainSidebar")}
                        onClick={onFold}
                        className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-colorTextSecondary [font-family:inherit] hover:bg-colorFillTertiary hover:text-colorText"
                    >
                        <SidebarSimpleIcon size={16} />
                    </button>
                )}
            </div>
        </>
    )
}
