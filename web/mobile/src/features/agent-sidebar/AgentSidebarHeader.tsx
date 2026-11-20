import {useContext, type MouseEvent, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import agentSidebarCatalog from "@agenta/i18n/catalogs/agentSidebar"
import {SidebarLayoutContext} from "@agenta/navigation-ui"
import {ArrowsInLineVerticalIcon, PlusIcon} from "@phosphor-icons/react"
import Link from "next/link"

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

/**
 * "New session" and "New chat": a full-width outlined button under the sidebar's header. A link,
 * so a modified or middle click opens the bare page in another tab; a plain click runs `onPlainClick`
 * in place of following the link.
 * Collapsed, it is the plus alone.
 */
export const SidebarNewButton = ({
    label,
    href,
    collapsed,
    onPlainClick,
}: {
    label: string
    href: string
    collapsed: boolean
    onPlainClick?: () => void
}) => {
    const phone = useContext(SidebarLayoutContext) === "phone"
    const onClick = onPlainClick
        ? (event: MouseEvent) => {
              if (
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
              )
                  return
              event.preventDefault()
              onPlainClick()
          }
        : undefined
    if (collapsed)
        return (
            <div className="flex w-full shrink-0 justify-center pt-2">
                <Link
                    href={href}
                    onClick={onClick}
                    aria-label={label}
                    title={label}
                    className="flex size-7 items-center justify-center rounded-sm !text-foreground no-underline hover:bg-muted"
                >
                    <PlusIcon size={16} />
                </Link>
            </div>
        )
    return (
        <div className={`w-full shrink-0 px-2 ${phone ? "pb-1 pt-1" : "pb-1 pt-2"}`}>
            <Link
                href={href}
                onClick={onClick}
                className={`flex w-full items-center justify-center gap-1.5 bg-background font-medium !text-foreground no-underline shadow-[inset_0_0_0_1px_var(--border)] hover:bg-muted ${phone ? "h-11 rounded-lg text-[15px] leading-5" : "h-8 rounded-md text-sm"}`}
            >
                <PlusIcon size={14} aria-hidden />
                {label}
            </Link>
        </div>
    )
}

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
