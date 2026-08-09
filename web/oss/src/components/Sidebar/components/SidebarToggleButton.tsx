import {EnhancedButton} from "@agenta/ui/components/presentational"
import {Sidebar} from "@phosphor-icons/react"
import clsx from "clsx"
import {useAtom} from "jotai"

import {sidebarCollapsedAtom} from "@/oss/lib/atoms/sidebar"

interface SidebarToggleButtonProps {
    className?: string
}

/** Collapse/expand toggle for the sidebar; writes the shared sidebarCollapsedAtom. */
const SidebarToggleButton = ({className}: SidebarToggleButtonProps) => {
    const [collapsed, setCollapsed] = useAtom(sidebarCollapsedAtom)

    return (
        <EnhancedButton
            type="text"
            size="small"
            className={clsx("shrink-0 !h-[28px]", className)}
            icon={
                <Sidebar
                    size={14}
                    className={clsx("transition-transform", collapsed ? "rotate-180" : "")}
                />
            }
            onClick={() => setCollapsed((c) => !c)}
            tooltipProps={{
                title: collapsed ? "Expand" : "Collapse",
                mouseEnterDelay: 1,
                placement: "right",
            }}
        />
    )
}

export default SidebarToggleButton
