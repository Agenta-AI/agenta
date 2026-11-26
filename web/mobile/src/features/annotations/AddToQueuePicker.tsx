import {useCallback, useState} from "react"

import {
    createQueueDrawerDefaultKindAtom,
    createQueueDrawerOpenAtom,
    createQueueDrawerSelectionAtom,
} from "@agenta/annotation"
import type {AddToQueuePopoverSlotProps} from "@agenta/observability-ui/traceDrawer"
import {Popover, PopoverAnchor, PopoverContent} from "@agenta/ui/ui"
import {useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {useProjectPermission} from "@/features/context/useProjectPermission"
import {useDeveloperViewEnabled} from "@/features/developer/developerViewAccess"

import {AddToQueuePickerPanel} from "./AddToQueuePickerPanel"
import {createQueueFollowUpAtom} from "./createQueueFollowUpAtom"
import {useAddToQueuePicker} from "./useAddToQueuePicker"

const PickerBody = ({
    onClose,
    ...args
}: Pick<AddToQueuePopoverSlotProps, "itemType" | "itemIds" | "onItemsAdded" | "onQueueSelected"> & {
    onClose: () => void
}) => {
    const picker = useAddToQueuePicker({...args, onClose})
    const setKind = useSetAtom(createQueueDrawerDefaultKindAtom)
    const setSelection = useSetAtom(createQueueDrawerSelectionAtom)
    const setSheetOpen = useSetAtom(createQueueDrawerOpenAtom)
    const setFollowUp = useSetAtom(createQueueFollowUpAtom)
    const projectId = useRouter().query.project_id
    const canEdit = useProjectPermission(
        typeof projectId === "string" ? projectId : "",
        "edit_evaluation_queues",
    )
    // The sheet host mounts only while the view is enabled, so "New" shows only then. Creating
    // a queue also needs the edit right.
    const createEnabled = useDeveloperViewEnabled("annotation-queues") === true && canEdit
    // The sheet host is mounted once in the app shell, so it outlives this popover content.
    const openCreate = () => {
        setKind(args.itemType)
        setSelection(args.itemIds?.length ? {itemType: args.itemType, itemIds: args.itemIds} : null)
        // Picker mode: the caller adds the items, so it gets the new queue like a picked one.
        const {onQueueSelected} = args
        setFollowUp(onQueueSelected ? {itemType: args.itemType, run: onQueueSelected} : null)
        onClose()
        setSheetOpen(true)
    }
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
            onNew={createEnabled ? openCreate : undefined}
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
