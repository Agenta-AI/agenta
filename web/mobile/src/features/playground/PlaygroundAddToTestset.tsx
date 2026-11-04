import {useEffect, useMemo, useState} from "react"

import {traceDataSummaryAtomFamily} from "@agenta/entities/loadable"
import {
    executionByMessageIdAtomFamily,
    isChatModeAtom,
    resultsByKeyAtomFamily,
    type MessageExecution,
} from "@agenta/playground/state"
import {message} from "@agenta/ui/app-message"
import {atom, useAtomValue, useStore, type Getter} from "jotai"

import {AddToTestsetSheet} from "../observability/addToTestset/AddToTestsetSheet"

/** The traces of this page's finished runs: each test case run, and each chat turn. */
const runTraceIds = (get: Getter, loadableId: string): string[] => {
    const runs = Object.values(get(resultsByKeyAtomFamily(loadableId)))
        .filter((result) => result?.status === "success")
        .map((result) => result.traceId)
    const turns = get(isChatModeAtom)
        ? Object.values(
              get(executionByMessageIdAtomFamily(loadableId)) as Record<string, MessageExecution>,
          )
              .filter((execution) => execution?.status === "complete")
              .map((execution) => execution.traceId)
        : []
    return [...new Set([...runs, ...turns])].filter((id): id is string => Boolean(id))
}

/**
 * "Add to test set" from the playground, as in /w: every finished run goes to the sheet as the
 * root span of its trace, which holds the run's inputs and outputs. The runs are read once, when
 * the user picks the item; the sheet opens when their spans are known.
 */
const PlaygroundAddToTestset = ({
    loadableId,
    onClose,
}: {
    loadableId: string
    onClose: () => void
}) => {
    const store = useStore()
    const [traceIds] = useState(() => runTraceIds(store.get, loadableId))
    const spansAtom = useMemo(
        () =>
            atom((get) => {
                const summaries = traceIds.map((id) => get(traceDataSummaryAtomFamily(id)))
                if (summaries.some((summary) => summary.isPending)) return null
                return summaries.flatMap((summary) => summary.rootSpan?.span_id ?? [])
            }),
        [traceIds],
    )
    const spanIds = useAtomValue(spansAtom)
    const noSpans = spanIds?.length === 0

    useEffect(() => {
        if (!noSpans) return
        message.error("Couldn't load the selected spans")
        onClose()
    }, [noSpans, onClose])

    return spanIds?.length ? <AddToTestsetSheet spanIds={spanIds} onClose={onClose} /> : null
}

export default PlaygroundAddToTestset
