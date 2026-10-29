import type {AnnotationDto} from "@agenta/entities/annotation/dto"
import type {TraceSpanNode as EntityTraceSpanNode} from "@agenta/entities/trace"

/** A span carrying the annotations the drawer/table stores attach to it. */
export interface TraceSpanNode extends EntityTraceSpanNode {
    /** Attached by the trace/session drawer stores when annotation data is loaded */
    annotations?: AnnotationDto[]
}
