import {sidebarCollapsedAtom} from "@agenta/navigation"
import {EnhancedButton} from "@agenta/ui/components/presentational"
import {Sidebar, X} from "@phosphor-icons/react"
import clsx from "clsx"
import {useAtom} from "jotai"
import type {PrimitiveAtom} from "jotai"

export interface SidebarToggleButtonProps {
    /** The rail's collapsed state. Defaults to the shared atom both shells already use. */
    collapsedAtom?: PrimitiveAtom<boolean>
    /** Given, the button CLOSES instead of collapsing — the overlay mount, where a 48px icon
     * strip inside a sheet is not a state anything can undo. */
    onDismiss?: () => void
    className?: string
}

/** Collapse/expand toggle for the rail, pinned in the logo row — or its close, in an overlay. */
export const SidebarToggleButton = ({
    collapsedAtom = sidebarCollapsedAtom,
    onDismiss,
    className,
}: SidebarToggleButtonProps) => {
    const [collapsed, setCollapsed] = useAtom(collapsedAtom)

    return (
        <EnhancedButton
            type="text"
            size="small"
            className={clsx(
                // A 28px square, the same box the rail's icon rows use, so the one control above
                // the list is as easy to hit as the rows under it. It was 22 with a -3px ::after
                // extending only the POINTER area, which left a hover fill visibly smaller than
                // the thing you were pointing at.
                "shrink-0 !size-7 !p-0",
                className,
            )}
            aria-label={onDismiss ? "Close navigation" : undefined}
            icon={
                onDismiss ? (
                    <X size={16} />
                ) : (
                    <Sidebar
                        size={16}
                        className={clsx("transition-transform", collapsed ? "rotate-180" : "")}
                    />
                )
            }
            onClick={() => (onDismiss ? onDismiss() : setCollapsed((c) => !c))}
            // No tooltip on the close: the sheet autofocuses its first focusable child, and a
            // Radix tooltip opens on FOCUS as well as hover — so every open popped a "Close"
            // bubble nobody asked for. The X plus its aria-label already say it.
            tooltipProps={
                onDismiss
                    ? undefined
                    : {
                          title: collapsed ? "Expand" : "Collapse",
                          mouseEnterDelay: 1,
                          placement: "right",
                      }
            }
        />
    )
}
