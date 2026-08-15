/**
 * Registers this app's components and actions with the packaged trace drawer.
 *
 * Three groups, all app-coupled for different reasons: `@/oss/components/References` is 20 files
 * of lookup UI, `DrillInView` is a large (currently forked) viewer, and the playground plus the
 * annotate/testset drawers sit ABOVE `@agenta/observability-ui` in the dependency order. The
 * drawer takes them as slots; without this call it renders plain labels and hides those actions.
 *
 * The casts belong here, not in the package: each component declares its own required props
 * while a slot contract is necessarily loose, and this is the one place that knows what the
 * drawer passes.
 */
import {bindTraceDrawerPlaygroundActions} from "@agenta/observability/traceDrawer"
import {
    configureTraceDrawerReferences,
    type TraceDrawerReferenceSlots,
} from "@agenta/observability-ui/traceDrawer"
import {hasAppReference} from "@agenta/playground"
import {openWorkflowRevisionDrawerAtom} from "@agenta/playground-ui/workflow-revision-drawer"
import {getDefaultStore} from "jotai"

import {TraceSpanDrillInView} from "@/oss/components/DrillInView"
import {PrettyJsonView} from "@/oss/components/DrillInView/PrettyJsonView"
import {
    ApplicationReferenceLabel,
    EnvironmentReferenceLabel,
    EvaluatorReferenceLabel,
    TestsetTag,
    VariantReferenceLabel,
} from "@/oss/components/References"
import ReferenceTag from "@/oss/components/References/ReferenceTag"
import AddToTestsetButton from "@/oss/components/SharedDrawers/AddToTestsetDrawer/components/AddToTestsetButton"
import AnnotateDrawerButton from "@/oss/components/SharedDrawers/AnnotateDrawer/assets/AnnotateDrawerButton"
import {buildPlaygroundUrl} from "@/oss/state/url/playground"

import {openTraceInPlaygroundAtom} from "./store/openInPlayground"

type Slot = TraceDrawerReferenceSlots[keyof TraceDrawerReferenceSlots]

export const registerTraceDrawerReferenceSlots = () => {
    configureTraceDrawerReferences({
        ApplicationReferenceLabel: ApplicationReferenceLabel as unknown as Slot,
        EnvironmentReferenceLabel: EnvironmentReferenceLabel as unknown as Slot,
        EvaluatorReferenceLabel: EvaluatorReferenceLabel as unknown as Slot,
        VariantReferenceLabel: VariantReferenceLabel as unknown as Slot,
        TestsetTag: TestsetTag as unknown as Slot,
        ReferenceTag: ReferenceTag as unknown as Slot,
        TraceSpanDrillInView: TraceSpanDrillInView as unknown as Slot,
        PrettyJsonView: PrettyJsonView as unknown as Slot,
        AddToTestsetButton: AddToTestsetButton as unknown as Slot,
        AnnotateDrawerButton: AnnotateDrawerButton as unknown as Slot,
    })

    const store = getDefaultStore()
    bindTraceDrawerPlaygroundActions({
        openTraceInPlayground: (payload) => store.set(openTraceInPlaygroundAtom, payload as never),
        openWorkflowRevisionDrawer: (payload) =>
            store.set(openWorkflowRevisionDrawerAtom, payload as never),
        hasAppReference: (span) => hasAppReference(span as never),
        buildPlaygroundUrl,
    })
}
