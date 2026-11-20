import {useContext, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import agentSidebarCatalog from "@agenta/i18n/catalogs/agentSidebar"
import {SidebarDensityContext} from "@agenta/navigation-ui"
import {ArrowLineLeftIcon} from "@phosphor-icons/react"

const ROW =
    "flex w-full shrink-0 items-center border-0 border-b border-solid border-[var(--ag-shell-line)]"
// In the phone sheet the small buttons keep their drawn size and get a 44 px hit area.
const TOUCH_HITS =
    "[&_button]:relative [&_button]:after:absolute [&_button]:after:-inset-2 [&_button]:after:content-['']"

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
    const touch = useContext(SidebarDensityContext) === "touch"
    const hits = touch ? TOUCH_HITS : ""
    return (
        <>
            <div
                className={`${ROW} ${hits} h-[45px] ${collapsed ? "justify-center" : "justify-between px-1.5"}`}
            >
                {collapsed ? toggle : back}
                {!collapsed && toggle}
            </div>
            {collapsed && <div className={`${ROW} h-[45px] justify-center`}>{back}</div>}
            <div
                className={`${ROW} ${hits} min-h-[52px] gap-1 ${collapsed ? "justify-center" : "px-1.5"}`}
            >
                {switcher}
                {collapsed ? null : (
                    <button
                        type="button"
                        aria-label={t("agentSidebar.backToMainSidebar")}
                        title={t("agentSidebar.backToMainSidebar")}
                        onClick={onFold}
                        className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-colorTextSecondary [font-family:inherit] hover:bg-colorFillTertiary hover:text-colorText"
                    >
                        <ArrowLineLeftIcon size={16} />
                    </button>
                )}
            </div>
        </>
    )
}
