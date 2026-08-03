/** The trigger rows' shared "⋯" actions menu (identical in both row shapes). */
import {type ReactNode} from "react"

import {Button, DropdownMenu, DropdownMenuContent, DropdownMenuTrigger} from "@agenta/ui/ui"
import {DotsThreeVertical} from "@phosphor-icons/react"

export function TriggerActionsMenu({
    menu,
    open,
    container,
}: {
    /** The composed menu body (`DropdownMenuItem` / `DropdownMenuSeparator` JSX). */
    menu: ReactNode
    /** Force open — controlled usage and forced-open parity stories. */
    open?: boolean
    /** Portal target; defaults to document.body (pass an element to render inline). */
    container?: HTMLElement | null
}) {
    return (
        <DropdownMenu open={open}>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Open trigger actions"
                    onClick={(e) => e.stopPropagation()}
                >
                    <DotsThreeVertical size={16} weight="bold" />
                </Button>
            </DropdownMenuTrigger>
            {/* w-[180px] = the antd Dropdown's `styles={{root: {width: 180}}}`. */}
            <DropdownMenuContent align="start" container={container} className="w-[180px]">
                {menu}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
