import {useState} from "react"

import {Button} from "@agenta/ui/ui"
import {ListChecks} from "@phosphor-icons/react"
import dynamic from "next/dynamic"

// The picker and its queue list load the first time a reader opens it.
const AddToQueuePicker = dynamic(() => import("../../annotations/AddToQueuePicker"), {ssr: false})

/**
 * The annotation queue picker for test cases, open under the control that asked for it. It
 * mounts only while open, so the control itself never waits for the picker code. Put it inside
 * a `relative` element that wraps the control: it anchors to that element's lower right corner.
 */
export const TestcaseQueuePicker = ({
    itemIds,
    open,
    onOpenChange,
}: {
    /** Saved test case ids; a row that is not saved yet has none */
    itemIds: string[]
    open: boolean
    onOpenChange: (open: boolean) => void
}) =>
    open ? (
        <span className="pointer-events-none absolute right-0 bottom-0">
            <AddToQueuePicker
                itemType="testcases"
                itemIds={itemIds}
                open
                onOpenChange={onOpenChange}
                toggleOnTriggerClick={false}
            >
                <span />
            </AddToQueuePicker>
        </span>
    ) : null

/** A button that opens the queue picker for the given test cases. Off when there are none. */
export const TestcaseQueueButton = ({
    itemIds,
    label,
    disabled = false,
}: {
    itemIds: string[]
    label: string
    disabled?: boolean
}) => {
    const [open, setOpen] = useState(false)
    return (
        <span className="relative inline-flex">
            <Button
                variant="outline"
                size="sm"
                disabled={disabled || itemIds.length === 0}
                onClick={() => setOpen(true)}
            >
                <ListChecks aria-hidden size={14} />
                {label}
            </Button>
            <TestcaseQueuePicker itemIds={itemIds} open={open} onOpenChange={setOpen} />
        </span>
    )
}
