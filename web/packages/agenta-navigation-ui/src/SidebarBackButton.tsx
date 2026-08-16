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
            "flex cursor-pointer items-center justify-center gap-2 rounded-md border-0 bg-transparent text-colorTextSecondary",
            "hover:bg-colorFillTertiary hover:text-colorText",
            collapsed ? "size-8" : "ml-2 h-7 px-2 text-xs",
            className,
        )}
    >
        <ArrowLeft size={14} />
        {!collapsed && "Back"}
    </button>
)
