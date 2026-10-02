import {
    configureTraceDrawerReferences,
    type TraceDrawerReferenceSlots,
} from "@agenta/observability-ui/traceDrawer"

import {TracePrettyJson} from "./TracePrettyJson"
import {TraceSpanPanel} from "./TraceSpanPanel"

type Slot = TraceDrawerReferenceSlots[keyof TraceDrawerReferenceSlots]

/** Fills the drawer's data slots; their fallback renders nothing, which left every tab empty. */
export const registerTraceDrawerSlots = () => {
    configureTraceDrawerReferences({
        TraceSpanDrillInView: TraceSpanPanel as unknown as Slot,
        PrettyJsonView: TracePrettyJson as unknown as Slot,
    })
}
