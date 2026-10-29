import type {ComponentType, ReactNode} from "react"

/**
 * Host slots for the reference labels the trace drawer renders.
 *
 * `@/oss/components/References` is 20 files and ~3.5k lines of app-coupled lookup UI, so the
 * drawer takes the components as slots rather than dragging that closure into the package. Same
 * contract as `configureUserReference` in `@agenta/ui`: the host registers once at boot, the
 * package renders whatever it was given, and a host that registers nothing gets a plain label
 * instead of a crash.
 */

export interface ReferenceLabelProps {
    projectId?: string | null
    projectURL?: string
    openExternally?: boolean
    hovercardPlacement?: string
    label?: ReactNode
    [key: string]: unknown
}

/** Props the drawer passes to a drill-in view; the host component may accept more. */
export type DrillInViewProps = Record<string, unknown>

/** Props the drawer passes to a slotted action button. */
export type ActionSlotProps = Record<string, unknown>

export interface TraceDrawerReferenceSlots {
    ApplicationReferenceLabel: ComponentType<ReferenceLabelProps>
    EnvironmentReferenceLabel: ComponentType<ReferenceLabelProps>
    EvaluatorReferenceLabel: ComponentType<ReferenceLabelProps>
    VariantReferenceLabel: ComponentType<ReferenceLabelProps>
    TestsetTag: ComponentType<ReferenceLabelProps>
    ReferenceTag: ComponentType<ReferenceLabelProps>
    /**
     * The JSON/drill-in viewers. They live in the app because their closure is large and
     * currently forked; the drawer only needs to render them.
     */
    TraceSpanDrillInView: ComponentType<DrillInViewProps>
    PrettyJsonView: ComponentType<DrillInViewProps>
    /**
     * Actions owned by sibling drawers and the playground. These sit ABOVE this package in the
     * dependency order (`@agenta/playground`, the annotate/testset drawers), so they are handed
     * in rather than imported — otherwise the layering inverts.
     */
    AddToTestsetButton: ComponentType<ActionSlotProps>
    AnnotateDrawerButton: ComponentType<ActionSlotProps>
}

/** Renders the label text alone — enough to read the reference, with no lookup behaviour. */
const PlainReference: ComponentType<ReferenceLabelProps> = ({label}) => (
    <span className="text-colorText">{label ?? "—"}</span>
)

/** Renders nothing — an unregistered action is absent, not broken. */
const NoSlot: ComponentType<ActionSlotProps> = () => null

const slots: TraceDrawerReferenceSlots = {
    TraceSpanDrillInView: NoSlot,
    PrettyJsonView: NoSlot,
    AddToTestsetButton: NoSlot,
    AnnotateDrawerButton: NoSlot,
    ApplicationReferenceLabel: PlainReference,
    EnvironmentReferenceLabel: PlainReference,
    EvaluatorReferenceLabel: PlainReference,
    VariantReferenceLabel: PlainReference,
    TestsetTag: PlainReference,
    ReferenceTag: PlainReference,
}

/**
 * Register the host's reference components. Call once at boot, before the drawer renders.
 *
 * @example
 * configureTraceDrawerReferences({ApplicationReferenceLabel, TestsetTag, ...})
 */
export const configureTraceDrawerReferences = (next: Partial<TraceDrawerReferenceSlots>) => {
    Object.assign(slots, next)
}

/** The registered slots. Read at render time so a late registration still takes effect. */
export const getTraceDrawerReferences = (): TraceDrawerReferenceSlots => slots
