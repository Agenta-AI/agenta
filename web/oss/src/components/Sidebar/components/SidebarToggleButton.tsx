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
            // A square the exact height of the 22px wordmark: top-aligned in the brand row, both
            // optical centres land on the same line. The old 28px pill rode 3px low.
            // The ::after is a transparent 28px hit extender — it grows the pointer target only,
            // leaving the 22px visual box and the row's alignment untouched.
            className={clsx(
                "shrink-0 !h-[22px] !w-[22px] !p-0",
                "relative after:absolute after:inset-[-3px] after:content-['']",
                className,
            )}
            icon={
                <Sidebar
                    size={16}
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
