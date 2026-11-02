import {useCallback, useState} from "react"

import type {AddToQueuePopoverSlotProps} from "@agenta/observability-ui/traceDrawer"
import {Popover, PopoverAnchor, PopoverContent} from "@agenta/ui/ui"

import {AddToQueuePickerPanel} from "./AddToQueuePickerPanel"
import {useAddToQueuePicker} from "./useAddToQueuePicker"

const PickerBody = ({
    onClose,
    ...args
}: Pick<AddToQueuePopoverSlotProps, "itemType" | "itemIds" | "onItemsAdded" | "onQueueSelected"> & {
    onClose: () => void
}) => {
    const picker = useAddToQueuePicker({...args, onClose})
    return (
        <AddToQueuePickerPanel
            queues={picker.rows}
            status={picker.status}
            search={picker.search}
            onSearchChange={picker.setSearch}
            submittingId={picker.submittingId}
            emptyMessage={picker.emptyMessage}
            onSelect={(id) => void picker.select(id)}
            onRetry={picker.retry}
        />
    )
}

/**
 * The shadcn add-to-queue picker. /m registers it in the trace drawer's `AddToQueuePopover` slot,
 * so the antd popover is never requested. The queue list loads only while the picker is open.
 */
const AddToQueuePicker = ({
    itemType,
    itemIds,
    children,
    disabled,
    onItemsAdded,
    open: controlledOpen,
    onOpenChange,
    toggleOnTriggerClick = true,
    onQueueSelected,
}: AddToQueuePopoverSlotProps) => {
    const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
    const open = controlledOpen ?? uncontrolledOpen

    const setOpen = useCallback(
        (next: boolean) => {
            if (controlledOpen === undefined) setUncontrolledOpen(next)
            onOpenChange?.(next)
        },
        [controlledOpen, onOpenChange],
    )
    const close = useCallback(() => setOpen(false), [setOpen])

    return (
        <Popover
            open={open}
            onOpenChange={(next) => {
                if (disabled && next) return
                setOpen(next)
            }}
        >
            <PopoverAnchor asChild>
                <span
                    className={
                        disabled
                            ? "inline-flex pointer-events-none opacity-50"
                            : "inline-flex cursor-pointer"
                    }
                    onClick={() => {
                        if (!disabled && toggleOnTriggerClick) setOpen(!open)
                    }}
                >
                    {children}
                </span>
            </PopoverAnchor>
            <PopoverContent
                align="end"
                collisionPadding={16}
                className="w-[min(20rem,calc(100vw-2rem))] p-0"
            >
                <PickerBody
                    itemType={itemType}
                    itemIds={itemIds}
                    onItemsAdded={onItemsAdded}
                    onQueueSelected={onQueueSelected}
                    onClose={close}
                />
            </PopoverContent>
        </Popover>
    )
}

export default AddToQueuePicker
