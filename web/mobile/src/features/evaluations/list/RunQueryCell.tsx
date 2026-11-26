import {useMemo} from "react"

import {
    flattenQueryConditions,
    liveQueryRevisionQueryAtomFamily,
} from "@agenta/entities/evaluationRun"
import {SkeletonBlock} from "@agenta/ui/ui"
import {atom, useAtomValue} from "jotai"

import {queryConditionLines} from "./queryConditionLines"

const IDLE = atom({data: undefined, isPending: false, isError: false})

/**
 * The trace filter a live evaluation watches, one condition per line ("Trace Type is
 * invocation"), and its sampling rate when it has one. Read only once the row is near the screen.
 */
export const RunQueryCell = ({
    queryRevisionId,
    inView,
}: {
    queryRevisionId: string | null
    inView: boolean
}) => {
    const revisionAtom =
        queryRevisionId && inView ? liveQueryRevisionQueryAtomFamily(queryRevisionId) : IDLE
    const query = useAtomValue(revisionAtom)
    const revision = query.data ?? null
    const lines = useMemo(
        () => queryConditionLines(flattenQueryConditions(revision?.data?.filtering)),
        [revision],
    )
    const rate = revision?.data?.windowing?.rate

    if (!queryRevisionId) return <span className="text-[13px] text-muted-foreground">—</span>
    if (!inView || query.isPending) {
        return <SkeletonBlock active className="h-4 w-3/4 rounded" />
    }
    if (query.isError || !revision) {
        return <span className="text-[13px] text-muted-foreground">—</span>
    }
    return (
        <span className="flex min-w-0 flex-col gap-0.5 text-[12px] text-muted-foreground">
            {lines.length === 0 ? <span>No filters</span> : null}
            {lines.map((line, index) => (
                <span key={index} className="truncate">
                    <span className="font-medium text-foreground">{line.field}</span>{" "}
                    {line.operator}{" "}
                    <span className="font-medium text-foreground">{line.value}</span>
                </span>
            ))}
            {typeof rate === "number" ? (
                <span className="truncate">
                    Sampling: {Math.round(rate <= 1 ? rate * 100 : rate)}%
                </span>
            ) : null}
        </span>
    )
}
