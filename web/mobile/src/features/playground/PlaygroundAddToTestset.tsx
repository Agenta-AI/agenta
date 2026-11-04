import {useEffect, useMemo} from "react"

import {traceDataSummaryAtomFamily} from "@agenta/entities/loadable"
import {message} from "@agenta/ui/app-message"
import {atom, useAtomValue} from "jotai"

import {AddToTestsetSheet} from "../observability/addToTestset/AddToTestsetSheet"

/**
 * "Add to test set" from the playground, as in /w: every finished run goes to the sheet as the
 * root span of its trace, which holds the run's inputs and outputs. The sheet opens when every
 * run's span is known. If one is missing,
 * nothing opens: a sheet with some of the runs would add fewer rows than the page shows.
 */
const PlaygroundAddToTestset = ({
    traceIds,
    onClose,
}: {
    /** The traces of the runs, read when the user picked the item. */
    traceIds: string[]
    onClose: () => void
}) => {
    const spansAtom = useMemo(
        () =>
            atom((get) => {
                const summaries = traceIds.map((id) => get(traceDataSummaryAtomFamily(id)))
                if (summaries.some((summary) => summary.isPending)) return null
                const ids = summaries.flatMap((summary) => summary.rootSpan?.span_id ?? [])
                return ids.length === traceIds.length ? ids : []
            }),
        [traceIds],
    )
    const spanIds = useAtomValue(spansAtom)
    const failed = spanIds?.length === 0

    useEffect(() => {
        if (!failed) return
        message.error("Couldn't load the selected spans")
        onClose()
    }, [failed, onClose])

    return spanIds?.length ? <AddToTestsetSheet spanIds={spanIds} onClose={onClose} /> : null
}

export default PlaygroundAddToTestset
