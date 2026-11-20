import {useContext} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {CaretLeft} from "@phosphor-icons/react"
import clsx from "clsx"

import {SidebarLayoutContext} from "./sidebarLayout"

export interface SidebarBackButtonProps {
    collapsed: boolean
    /** Where "Back" goes; the app decides (route history fallback lives app-side). */
    onBack: () => void
    className?: string
}

/** The scope header's way out (settings, workflow scopes). */
export const SidebarBackButton = ({collapsed, onBack, className}: SidebarBackButtonProps) => {
    const t = useT(commonCatalog)
    const phone = useContext(SidebarLayoutContext) === "phone"
    return (
        <button
            type="button"
            aria-label={t("common.back")}
            onClick={onBack}
            className={clsx(
                // A white chip, as the design draws it: 13 px in the label's ink on the rail, the
                // phone's 15 px in the secondary ink in the sheet.
                // [font-family:inherit] is load-bearing — preflight is off, so a bare <button>
                // falls back to Arial while every <div> row beside it renders Inter.
                "flex cursor-pointer items-center justify-center rounded-sm border-0 [font-family:inherit]",
                collapsed
                    ? "size-8 bg-transparent text-colorText hover:bg-colorFillTertiary"
                    : "gap-1.5 bg-colorBgContainer hover:bg-colorSplit",
                !collapsed &&
                    (phone
                        ? "h-11 pl-1.5 pr-2.5 text-[15px] leading-5 text-colorTextSecondary"
                        : "h-7 pl-1 pr-2 text-[13px] text-colorText"),
                className,
            )}
        >
            <CaretLeft size={14} />
            {!collapsed && t("common.back")}
        </button>
    )
}
