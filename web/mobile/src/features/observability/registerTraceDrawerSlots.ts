import {
    configureTraceDrawerReferences,
    type TraceDrawerReferenceSlots,
} from "@agenta/observability-ui/traceDrawer"
import dynamic from "next/dynamic"

import {TracePrettyJson} from "./TracePrettyJson"
import {TraceSpanPanel} from "./TraceSpanPanel"

type Slot = TraceDrawerReferenceSlots["TraceSpanDrillInView"]

// The shadcn picker loads on first open. The global drawers sit in the app shell, so a static
// import here would put the picker in every page.
const AddToQueuePicker = dynamic(() => import("@/features/annotations/AddToQueuePicker"), {
    ssr: false,
})

/** Fills the drawer's data slots; their fallback renders nothing, which left every tab empty. */
export const registerTraceDrawerSlots = () => {
    configureTraceDrawerReferences({
        TraceSpanDrillInView: TraceSpanPanel as unknown as Slot,
        PrettyJsonView: TracePrettyJson as unknown as Slot,
        AddToQueuePopover: AddToQueuePicker,
    })
}
