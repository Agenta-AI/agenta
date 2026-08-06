/**
 * RevertGroupButton — the section-scoped "Revert" header action, with its confirm step.
 *
 * Confirmed, because unlike the per-row undo (which is reached THROUGH the popover showing the
 * exact value it restores — see `RailField`) this one discards every change in the group at once
 * and names none of them.
 *
 * Replaces antd `Popconfirm` + `Button type="text"`. `@agenta/ui` has no Popconfirm, so the
 * confirm step is composed on the `Popover` primitive here: warning icon + bold title +
 * description + right-aligned Cancel/OK small buttons — antd's Popconfirm geometry
 * (12px panel padding, 8px message gap, 4px description offset, 8px button gap).
 */
import {useState, type ReactNode} from "react"

import {Button, Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"
import {ArrowCounterClockwise, WarningCircle} from "@phosphor-icons/react"

export interface RevertGroupButtonProps {
    onConfirm: () => void
    disabled?: boolean
    title?: ReactNode
    description?: ReactNode
    okText?: string
    cancelText?: string
    /** Controlled open state — the forced-open parity story drives this. */
    open?: boolean
    onOpenChange?: (open: boolean) => void
    /** Portal target for the confirm panel; a story renders it inline to compare it with antd's. */
    container?: HTMLElement | null
}

export function RevertGroupButton({
    onConfirm,
    disabled,
    title = "Revert this group?",
    description = "Every unsaved change in it goes back to the committed value.",
    okText = "Revert",
    cancelText = "Cancel",
    open,
    onOpenChange,
    container,
}: RevertGroupButtonProps) {
    const [internalOpen, setInternalOpen] = useState(false)
    const isOpen = open ?? internalOpen
    const setOpen = (next: boolean) => {
        if (open === undefined) setInternalOpen(next)
        onOpenChange?.(next)
    }

    return (
        <Popover open={isOpen} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    // The header is a toggle — don't collapse the group while undoing inside it.
                    onClick={(e) => e.stopPropagation()}
                    disabled={disabled}
                    // text-[11px] must not fight the colour class in tailwind-merge, so the
                    // colour comes from the named token, not an arbitrary CSS variable.
                    className="!h-auto !px-1 !py-0.5 !text-[11px] !text-colorTextSecondary"
                >
                    <ArrowCounterClockwise size={13} />
                    Revert
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="end"
                container={container}
                // Radix gives the content role="dialog"; axe requires it to be named.
                aria-label={typeof title === "string" ? title : "Revert this group?"}
                className="w-auto p-3"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="mb-2 flex flex-nowrap items-start text-colorText">
                    {/* antd's `.ant-popconfirm-message-icon` column measures 20px wide and 20px
                        tall (14px glyph + 6px trailing gap, centred on the title's line box). */}
                    <span className="mr-1.5 inline-flex h-5 shrink-0 items-center text-colorWarning">
                        <WarningCircle size={14} weight="fill" />
                    </span>
                    <div className="min-w-0">
                        <div className="font-semibold">{title}</div>
                        {description ? <div className="mt-1">{description}</div> : null}
                    </div>
                </div>
                <div className="flex justify-end gap-2 whitespace-nowrap">
                    <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                        {cancelText}
                    </Button>
                    <Button
                        size="sm"
                        onClick={() => {
                            setOpen(false)
                            onConfirm()
                        }}
                    >
                        {okText}
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    )
}

export default RevertGroupButton
