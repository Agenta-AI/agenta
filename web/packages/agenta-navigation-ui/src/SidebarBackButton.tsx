import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {ArrowLeft} from "@phosphor-icons/react"
import clsx from "clsx"

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
    const t = useT(commonCatalog)
    const text = label ?? t("common.back")
    return (
        <button
            type="button"
            aria-label={label === undefined ? text : `Back from ${label}`}
            onClick={onBack}
            className={clsx(
                // text-sm / colorText, not xs / secondary: the rail has always drawn this row at
                // the same weight as the nav rows beside it, not as a dimmed caption.
                // [font-family:inherit] is load-bearing — preflight is off, so a bare <button>
                // falls back to Arial while every <div> row beside it renders Inter.
                "flex cursor-pointer items-center justify-center gap-2 border-0 bg-transparent [font-family:inherit] text-colorText",
                "hover:bg-colorFillTertiary",
                collapsed
                    ? "size-8 rounded-[8px]"
                    : "h-7 min-w-0 flex-1 justify-start gap-[10px] rounded-[6px] px-3 text-sm font-medium",
                className,
            )}
        >
            <ArrowLeft size={16} className="shrink-0 text-colorTextSecondary" />
            {!collapsed && <span className="truncate">{text}</span>}
        </button>
    )
}
