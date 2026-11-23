import {useContext} from "react"

import {useT} from "@agenta/i18n"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
import phoneCatalog from "@agenta/i18n/catalogs/ui.phone"
import {sidebarCollapsedAtom} from "@agenta/navigation"
import {EnhancedButton} from "@agenta/ui/components/presentational"
import clsx from "clsx"
import {useAtom} from "jotai"
import type {PrimitiveAtom} from "jotai"
import {PanelLeft, X} from "lucide-react"

import {SidebarLayoutContext} from "./sidebarLayout"

export interface SidebarToggleButtonProps {
    /** The rail's collapsed state. Defaults to the shared atom both shells already use. */
    collapsedAtom?: PrimitiveAtom<boolean>
    /** Given, the button CLOSES instead of collapsing — the overlay mount, where a 48px icon
     * strip inside a sheet is not a state anything can undo. */
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

    return (
        <EnhancedButton
            type="text"
            size="small"
            className={clsx(
                // A 28px square, the same box the rail's icon rows use.
                "shrink-0 !size-7 !rounded-sm !p-0 !text-colorTextSecondary hover:!text-colorText",
                className,
            )}
            aria-label={
                onDismiss
                    ? t(phone ? "ui.phone.closeSidebar" : "navigation.chrome.closeNavigation")
                    : t(
                          collapsed
                              ? "navigation.chrome.expandSidebar"
                              : "navigation.chrome.collapseSidebar",
                      )
            }
            icon={
                onDismiss ? (
                    <X className={phone ? "size-5" : "size-4"} />
                ) : (
                    <PanelLeft size={16} strokeWidth={1.75} />
                )
            }
            onClick={() => (onDismiss ? onDismiss() : setCollapsed((c) => !c))}
            // No tooltip on the close: the sheet autofocuses its first focusable child, and a
            // Radix tooltip opens on FOCUS as well as hover — so every open popped a "Close"
            // bubble nobody asked for. The X plus its aria-label already say it.
            tooltipProps={
                onDismiss
                    ? undefined
                    : {
                          title: t(
                              collapsed
                                  ? "navigation.chrome.expandSidebar"
                                  : "navigation.chrome.collapseSidebar",
                          ),
                          mouseEnterDelay: 1,
                          placement: "right",
                      }
            }
        />
    )
}
