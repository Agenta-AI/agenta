import {useState} from "react"

import type {AnnotationDto} from "@agenta/entities/annotation/dto"
import {projectIdAtom} from "@agenta/shared/state"
import {Button} from "@agenta/ui/ui"
import {PencilSimpleIcon} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {useTraceActionAccess} from "../useTraceActionAccess"

// The sheet holds the form, the field controls and the evaluator requests: first click only.
const TraceAnnotateSheet = dynamic(() => import("./TraceAnnotateSheet"), {ssr: false})

const textOf = (value: unknown) => (typeof value === "string" && value ? value : undefined)

/**
 * The trace drawer's "Annotate" slot, for the active span. It renders nothing while the trace
 * actions view is off or the user may not edit spans, and is disabled without a span.
 */
export const TraceAnnotateButton = (props: Record<string, unknown>) => {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const allowed = useTraceActionAccess(projectId, "edit_spans")
    const [open, setOpen] = useState(false)
    if (!allowed) return null

    const ids = (props.traceSpanIds ?? {}) as {traceId?: unknown; spanId?: unknown}
    const traceId = textOf(ids.traceId)
    const spanId = textOf(ids.spanId)

    return (
        <>
            <Button
                variant="outline"
                size="sm"
                disabled={!traceId || !spanId}
                onClick={() => setOpen(true)}
            >
                <PencilSimpleIcon size={14} />
                {textOf(props.label) ?? "Annotate"}
            </Button>
            {open ? (
                <TraceAnnotateSheet
                    traceId={traceId}
                    spanId={spanId}
                    annotations={Array.isArray(props.data) ? (props.data as AnnotationDto[]) : []}
                    onClose={() => setOpen(false)}
                />
            ) : null}
        </>
    )
}

export default TraceAnnotateButton
