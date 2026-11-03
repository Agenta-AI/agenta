import {
    configureTraceDrawerReferences,
    type TraceDrawerReferenceSlots,
} from "@agenta/observability-ui/traceDrawer"
import dynamic from "next/dynamic"

import {TraceSpanPanelSkeleton} from "./states/TraceSpanPanelSkeleton"
import {TracePrettyJson} from "./TracePrettyJson"

type Slot = TraceDrawerReferenceSlots["TraceSpanDrillInView"]

// The drill-in panel loads when a span is first on screen. It pulls in the JSON tree and its
// editor, which a page with no open trace never needs.
const TraceSpanPanel = dynamic(() => import("./TraceSpanPanel"), {
    ssr: false,
    loading: TraceSpanPanelSkeleton,
})

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
