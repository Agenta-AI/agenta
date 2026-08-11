import {sidebarCollapsedAtom} from "@agenta/navigation"
import {EnhancedButton} from "@agenta/ui/components/presentational"
import {Sidebar} from "@phosphor-icons/react"
import clsx from "clsx"
import {useAtom} from "jotai"
import type {PrimitiveAtom} from "jotai"

export interface SidebarToggleButtonProps {
    /** The rail's collapsed state. Defaults to the shared atom both shells already use. */
    collapsedAtom?: PrimitiveAtom<boolean>
    className?: string
}

/** Collapse/expand toggle for the rail, pinned in the logo row. */
export const SidebarToggleButton = ({
    collapsedAtom = sidebarCollapsedAtom,
    className,
}: SidebarToggleButtonProps) => {
    const [collapsed, setCollapsed] = useAtom(collapsedAtom)

    return (
        <EnhancedButton
            type="text"
            size="small"
            className={clsx(
                // A 22px square — the exact height of the wordmark — so both optical centres line
                // up; the old 28px pill rode 3px low. `after:inset-[-3px]` gives back the pointer
                // area the smaller square costs, without affecting layout.
                "shrink-0 !h-[22px] !w-[22px] !p-0 relative after:absolute after:inset-[-3px] after:content-['']",
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
