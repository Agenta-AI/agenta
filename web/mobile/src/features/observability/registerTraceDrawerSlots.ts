import {
    type AddToQueuePopoverSlotProps,
    configureTraceDrawerReferences,
    type TraceDrawerReferenceSlots,
} from "@agenta/observability-ui/traceDrawer"
import dynamic from "next/dynamic"

import {TraceSpanPanelSkeleton} from "./states/TraceSpanPanelSkeleton"

type Slot = TraceDrawerReferenceSlots["TraceSpanDrillInView"]

// The drill-in panel loads when a span is first on screen. It pulls in the JSON tree and its
// editor, which a page with no open trace never needs.
const TraceSpanPanel = dynamic(() => import("./TraceSpanPanel"), {
    ssr: false,
    loading: TraceSpanPanelSkeleton,
})

// The readable JSON view (message blocks, collapsible keys, copy per row) loads with the first
// section shown in Pretty JSON mode. The slots are registered from the app shell.
const PrettyJsonView = dynamic(
    () => import("@agenta/observability-ui/drillIn").then((mod) => mod.PrettyJsonView),
    {ssr: false},
)

// Every header action (the add-to-queue picker, add to test set, annotate) is in one chunk
// behind one loader, registered under each slot name. The global drawers sit in the app shell, so
// a static import here would put the actions in every page, and a loader per action would grow
// the shell.
const HeaderAction = dynamic<AddToQueuePopoverSlotProps>(
    () => import("./TraceDrawerHeaderActions"),
    {ssr: false},
)

/** Fills the drawer's data slots; their fallback renders nothing, which left every tab empty. */
export const registerTraceDrawerSlots = () => {
    configureTraceDrawerReferences({
        TraceSpanDrillInView: TraceSpanPanel as unknown as Slot,
        PrettyJsonView: PrettyJsonView as unknown as Slot,
        AddToQueuePopover: HeaderAction,
        AddToTestsetButton: HeaderAction as unknown as Slot,
        AnnotateDrawerButton: HeaderAction as unknown as Slot,
    })
}
