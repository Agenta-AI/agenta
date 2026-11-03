import type {AddToQueuePopoverSlotProps} from "@agenta/observability-ui/traceDrawer"

import AddToQueuePicker from "@/features/annotations/AddToQueuePicker"

import {AddToTestsetDrawerButton} from "./addToTestset/AddToTestsetDrawerButton"

export type TraceDrawerHeaderActionProps = AddToQueuePopoverSlotProps | Record<string, unknown>

/**
 * Every trace drawer header action, in one chunk. `registerTraceDrawerSlots` loads this module
 * with a single `next/dynamic` loader and registers that one component under each slot name, so
 * a new header button adds no code to the app shell. The props tell the slots apart: the
 * add-to-queue picker always gets `itemType`, and the add to test set button gets `spanIds`.
 * Each action checks its own developer view and permission.
 */
const TraceDrawerHeaderAction = (props: TraceDrawerHeaderActionProps) =>
    "itemType" in props ? (
        <AddToQueuePicker {...(props as AddToQueuePopoverSlotProps)} />
    ) : (
        <AddToTestsetDrawerButton {...props} />
    )

export default TraceDrawerHeaderAction
