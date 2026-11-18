import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
import {sidebarCollapsedAtom} from "@agenta/navigation"
import {EnhancedButton} from "@agenta/ui/components/presentational"
import clsx from "clsx"
import {useAtom} from "jotai"
import type {PrimitiveAtom} from "jotai"
import {PanelLeft, X} from "lucide-react"

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
    const t = useT(navigationCatalog, commonCatalog)
    const [collapsed, setCollapsed] = useAtom(collapsedAtom)

    return (
        <EnhancedButton
            type="text"
            size="small"
            className={clsx(
                // The kit's small button, square: its height, its width.
                "shrink-0 !p-0 !text-colorTextSecondary hover:!text-colorText",
                // 32px as the icon rail's first button, the kit's small square beside the trigger.
                collapsed && !onDismiss ? "!size-8 !rounded-[8px]" : "aspect-square !rounded-[6px]",
                className,
            )}
            aria-label={onDismiss ? t("navigation.chrome.closeNavigation") : undefined}
            icon={
                onDismiss ? (
                    <X size={16} strokeWidth={1.75} />
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
                          title: collapsed ? t("common.expand") : t("common.collapse"),
                          mouseEnterDelay: 1,
                          placement: "right",
                      }
            }
        />
    )
}
