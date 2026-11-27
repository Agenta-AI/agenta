import {useContext} from "react"

import {useT} from "@agenta/i18n"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
import phoneCatalog from "@agenta/i18n/catalogs/ui.phone"
import {sidebarCollapsedAtom} from "@agenta/navigation"
import {SimpleTooltip} from "@agenta/ui/composed"
import {Button} from "@agenta/ui/ui"
import {SidebarSimple, X} from "@phosphor-icons/react"
import clsx from "clsx"
import {useAtom} from "jotai"
import type {PrimitiveAtom} from "jotai"

import {SidebarLayoutContext} from "./sidebarLayout"

export interface SidebarToggleButtonProps {
    /** The rail's collapsed state. Defaults to the shared atom both shells already use. */
    collapsedAtom?: PrimitiveAtom<boolean>
    /** Given, the button CLOSES instead of collapsing (the overlay mount). */
    onDismiss?: () => void
    className?: string
}

/** Collapse/expand toggle for the rail, pinned in the logo row — or its close, in an overlay. */
export const SidebarToggleButton = ({
    collapsedAtom = sidebarCollapsedAtom,
    onDismiss,
    className,
}: SidebarToggleButtonProps) => {
    const t = useT(navigationCatalog, phoneCatalog)
    // The phone sheet names itself "the sidebar", as its menu button does ("Open the sidebar").
    const phone = useContext(SidebarLayoutContext) === "phone"
    const [collapsed, setCollapsed] = useAtom(collapsedAtom)

    const label = onDismiss
        ? t(phone ? "ui.phone.closeSidebar" : "navigation.chrome.closeNavigation")
        : t(collapsed ? "navigation.chrome.expandSidebar" : "navigation.chrome.collapseSidebar")

    return (
        <SimpleTooltip title={label} side={onDismiss ? "bottom" : "right"}>
            <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className={clsx("shrink-0 text-muted-foreground hover:text-foreground", className)}
                aria-label={label}
                onClick={() => (onDismiss ? onDismiss() : setCollapsed((c) => !c))}
            >
                {onDismiss ? <X /> : <SidebarSimple />}
            </Button>
        </SimpleTooltip>
    )
}
