import {Skeleton} from "@agenta/primitive-ui/components/skeleton"

import {
    sessionTraceCountAtomFamily,
    sessionsLoadingAtom,
} from "@/oss/state/newObservability/atoms/queries"

import {useSessionAtomValue} from "../../assets/sessionCellStore"

export const TracesCountCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useSessionAtomValue(sessionsLoadingAtom)
    const traceCount = useSessionAtomValue(sessionTraceCountAtomFamily(sessionId))

    if (isLoading)
        return (
            <div className="flex w-full flex-col gap-3">
                <Skeleton className="h-4 w-2/5" />
            </div>
        )

    return <>{traceCount}</>
}
