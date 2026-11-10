import type {ComponentType, ReactNode} from "react"

import type {SimpleQueue} from "@agenta/entities/simpleQueue"
import dynamic from "next/dynamic"

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

/** Props every add-to-queue picker takes: the trigger is `children`, the picker opens beside it. */
export interface AddToQueuePopoverSlotProps {
    itemType: "traces" | "testcases"
    /** Item ids for the default add path. Omit when `onQueueSelected` is set. */
    itemIds?: string[]
    children: ReactNode
    disabled?: boolean
    onItemsAdded?: () => void
    open?: boolean
    onOpenChange?: (open: boolean) => void
    toggleOnTriggerClick?: boolean
    /** Picker mode: the caller owns the add, so picking a queue only reports it. */
    onQueueSelected?: (queue: SimpleQueue) => void
}

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

/**
 * Slots the drawer takes beyond the reference labels and sibling-drawer actions. Kept out of
 * `TraceDrawerReferenceSlots` so a host that types its registrations against that interface
 * (`TraceDrawerReferenceSlots[keyof TraceDrawerReferenceSlots]`) is not forced to widen them.
 */
export interface TraceDrawerPickerSlots {
    /**
     * The "add to annotation queue" picker. The default is the antd popover, loaded on first
     * render only. A host that cannot ship antd (`/m`) registers its own picker, and its bundle
     * then never requests the antd chunk.
     */
    AddToQueuePopover: ComponentType<AddToQueuePopoverSlotProps>
}

export type TraceDrawerSlots = TraceDrawerReferenceSlots & TraceDrawerPickerSlots

/** Renders the label text alone — enough to read the reference, with no lookup behaviour. */
const PlainReference: ComponentType<ReferenceLabelProps> = ({label}) => (
    <span className="text-colorText">{label ?? "—"}</span>
)

/** Renders nothing — an unregistered action is absent, not broken. */
const NoSlot: ComponentType<ActionSlotProps> = () => null

const DefaultAddToQueuePopover: ComponentType<AddToQueuePopoverSlotProps> = dynamic(
    () => import("@agenta/annotation-ui/add-to-queue").then((m) => m.default),
    {ssr: false},
)

const slots: TraceDrawerSlots = {
    TraceSpanDrillInView: NoSlot,
    PrettyJsonView: NoSlot,
    AddToTestsetButton: NoSlot,
    AnnotateDrawerButton: NoSlot,
    AddToQueuePopover: DefaultAddToQueuePopover,
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
export const configureTraceDrawerReferences = (next: Partial<TraceDrawerSlots>) => {
    Object.assign(slots, next)
}

/** The registered slots. Read at render time so a late registration still takes effect. */
export const getTraceDrawerReferences = (): TraceDrawerSlots => slots
