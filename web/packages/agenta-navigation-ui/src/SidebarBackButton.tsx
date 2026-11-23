import {useContext} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
import {ArrowLeft} from "@phosphor-icons/react"
import clsx from "clsx"

import {SidebarLayoutContext} from "./sidebarLayout"

export interface SidebarBackButtonProps {
    collapsed: boolean
    /** Where "Back" goes; the app decides (route history fallback lives app-side). */
    onBack: () => void
    /** The row's text; "Back" by default. */
    label?: string
    className?: string
}

/** The scope header's way out (settings, workflow scopes). */
export const SidebarBackButton = ({
    collapsed,
    onBack,
    label,
    className,
}: SidebarBackButtonProps) => {
    const t = useT(commonCatalog, navigationCatalog)
    const text = label ?? t("common.back")
    const phone = useContext(SidebarLayoutContext) === "phone"
    return (
        <button
            type="button"
            aria-label={label === undefined ? text : t("navigation.chrome.backFrom", {label})}
            onClick={onBack}
            className={clsx(
                // A white chip on the rail, as the design draws it, 13 px in the label's ink. The
                // phone sheet draws no ground: 15 px in the secondary ink (M02).
                // [font-family:inherit] is load-bearing — preflight is off, so a bare <button>
                // falls back to Arial while every <div> row beside it renders Inter.
                "flex cursor-pointer items-center justify-center gap-2 border-0 bg-transparent [font-family:inherit] text-colorText",
                "hover:bg-colorFillTertiary",
                collapsed
                    ? "size-8 rounded-[8px]"
                    : clsx(
                          "min-w-0 flex-1 justify-start gap-[10px] rounded-[6px] px-3 font-medium",
                          phone ? "h-11 text-[15px]" : "h-7 text-sm",
                      ),
                className,
            )}
        >
            <ArrowLeft size={16} className="shrink-0 text-colorTextSecondary" />
            {!collapsed && <span className="truncate">{text}</span>}
        </button>
    )
}
