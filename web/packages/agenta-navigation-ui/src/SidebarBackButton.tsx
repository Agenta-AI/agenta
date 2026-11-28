import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
import {SimpleTooltip} from "@agenta/ui/composed"
import {ArrowLeft} from "@phosphor-icons/react"
import clsx from "clsx"

import {ROW_HEIGHT} from "./rowStyles"

export interface SidebarBackButtonProps {
    collapsed: boolean
    /** Where "Back" goes; the app decides (route history fallback lives app-side). */
    onBack: () => void
    /** The row's text; "Back" by default. */
    label?: string
    className?: string
}

/** The scope header's way out (settings, workflow scopes): a rail row, or a 28px icon when collapsed. */
export const SidebarBackButton = ({
    collapsed,
    onBack,
    label,
    className,
}: SidebarBackButtonProps) => {
    const t = useT(commonCatalog, navigationCatalog)
    const text = label ?? t("common.back")
    const button = (
        <button
            type="button"
            aria-label={label === undefined ? text : t("navigation.chrome.backFrom", {label})}
            onClick={onBack}
            className={clsx(
                // [font-family:inherit]: preflight is off, so a bare <button> renders Arial.
                "flex cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent [font-family:inherit] text-foreground outline-none focus-ring hover:bg-accent",
                collapsed ? "size-7 justify-center" : `${ROW_HEIGHT} min-w-0 justify-start px-2`,
                className,
            )}
        >
            <ArrowLeft size={16} className="shrink-0" />
            {!collapsed && <span className="truncate">{text}</span>}
        </button>
    )
    return collapsed ? (
        <SimpleTooltip title={text} side="right">
            {button}
        </SimpleTooltip>
    ) : (
        button
    )
}
