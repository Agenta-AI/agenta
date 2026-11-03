import {SharedGenerationResultUtils} from "@agenta/entity-ui"
import {openTraceDrawerAtom} from "@agenta/observability/traceDrawer"
import {useSetAtom} from "jotai"

/** The line under an output: the run's status, numbers and a button that opens its trace. */
export const PlaygroundTraceFooter = ({traceId}: {traceId: string}) => {
    const openTraceDrawer = useSetAtom(openTraceDrawerAtom)
    return (
        <div className="mt-2 flex flex-nowrap items-center justify-start gap-2 overflow-hidden">
            <SharedGenerationResultUtils
                traceId={traceId}
                onViewTrace={({traceId: id, spanId}) =>
                    openTraceDrawer({traceId: id, activeSpanId: spanId})
                }
            />
        </div>
    )
}
