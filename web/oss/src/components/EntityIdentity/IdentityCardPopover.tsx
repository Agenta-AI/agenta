import {type ReactNode} from "react"

import {Popover, type PopoverProps} from "antd"

interface IdentityCardPopoverProps {
    /** The card body (AgentIdentityCard). */
    content: ReactNode
    /** The anchor — the name / pen the card grows out of. */
    children: ReactNode
    open?: boolean
    onOpenChange?: (open: boolean) => void
    placement?: PopoverProps["placement"]
    trigger?: PopoverProps["trigger"]
}

/**
 * Anchored, non-modal shell for the entity identity cards. A thin wrapper over antd Popover that
 * pins the card to the name it edits (no centered overlay), keeps a consistent width, and lets the
 * body own its own padding so the cards read identically across the playground surfaces.
 */
const IdentityCardPopover = ({
    content,
    children,
    open,
    onOpenChange,
    placement = "bottomLeft",
    trigger = "click",
}: IdentityCardPopoverProps) => {
    return (
        <Popover
            open={open}
            onOpenChange={onOpenChange}
            trigger={trigger}
            placement={placement}
            arrow={false}
            content={<div className="w-[320px] max-w-[calc(100vw-48px)]">{content}</div>}
        >
            {children}
        </Popover>
    )
}

export default IdentityCardPopover
