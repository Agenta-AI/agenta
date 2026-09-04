import {ArrowLeft} from "@phosphor-icons/react"
import clsx from "clsx"

export interface SidebarBackButtonProps {
    collapsed: boolean
    /** Where "Back" goes; the app decides (route history fallback lives app-side). */
    onBack: () => void
    className?: string
}

/** The scope header's way out (settings, workflow scopes). */
export const SidebarBackButton = ({collapsed, onBack, className}: SidebarBackButtonProps) => (
    <button
        type="button"
        aria-label="Back"
        onClick={onBack}
        className={clsx(
            // text-sm / colorText, not xs / secondary: the rail has always drawn this row at
            // the same weight as the nav rows beside it, not as a dimmed caption.
            // [font-family:inherit] is load-bearing — preflight is off, so a bare <button>
            // falls back to Arial while every <div> row beside it renders Inter.
            "flex cursor-pointer items-center justify-center gap-2 rounded-md border-0 bg-transparent [font-family:inherit] text-colorText",
            "hover:bg-colorFillTertiary",
            collapsed ? "size-8" : "ml-2 h-7 px-2 text-sm",
            className,
        )}
    >
        <ArrowLeft size={14} />
        {!collapsed && "Back"}
    </button>
)
