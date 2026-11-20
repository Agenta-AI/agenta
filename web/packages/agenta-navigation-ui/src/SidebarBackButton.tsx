import {useContext} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {ArrowLeft} from "@phosphor-icons/react"
import clsx from "clsx"

import {SidebarDensityContext} from "./sidebarDensity"

export interface SidebarBackButtonProps {
    collapsed: boolean
    /** Where "Back" goes; the app decides (route history fallback lives app-side). */
    onBack: () => void
    className?: string
}

/** The scope header's way out (settings, workflow scopes). */
export const SidebarBackButton = ({collapsed, onBack, className}: SidebarBackButtonProps) => {
    const t = useT(commonCatalog)
    const touch = useContext(SidebarDensityContext) === "touch"
    return (
        <button
            type="button"
            aria-label={t("common.back")}
            onClick={onBack}
            className={clsx(
                // text-sm / colorText, not xs / secondary: the rail has always drawn this row at
                // the same weight as the nav rows beside it, not as a dimmed caption.
                // [font-family:inherit] is load-bearing — preflight is off, so a bare <button>
                // falls back to Arial while every <div> row beside it renders Inter.
                "flex cursor-pointer items-center justify-center gap-2 rounded-md border-0 bg-transparent [font-family:inherit] text-colorText",
                "hover:bg-colorFillTertiary",
                collapsed ? "size-8" : touch ? "h-11 px-2 text-[15px]" : "ml-2 h-7 px-2 text-sm",
                className,
            )}
        >
            <ArrowLeft size={14} />
            {!collapsed && t("common.back")}
        </button>
    )
}
