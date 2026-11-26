import {
    executionByMessageIdAtomFamily,
    isChatModeAtom,
    resultsByKeyAtomFamily,
    type MessageExecution,
} from "@agenta/playground/state"
import type {Getter} from "jotai"

/** The traces of this page's finished runs: each test case run, and each chat turn. */
export const runTraceIds = (get: Getter, loadableId: string): string[] => {
    // A run with repeats keeps each repeat's trace, the first one included, in `repetitions`.
    const runs = Object.values(get(resultsByKeyAtomFamily(loadableId)))
        .filter((result) => result?.status === "success")
        .flatMap((result) =>
            result.repetitions?.length
                ? result.repetitions.map((repeat) => repeat.traceId)
                : [result.traceId],
        )
    const turns = get(isChatModeAtom)
        ? Object.values(
              get(executionByMessageIdAtomFamily(loadableId)) as Record<string, MessageExecution>,
          )
              .filter((execution) => execution?.status === "complete")
              .map((execution) => execution.traceId)
        : []
    return [...new Set([...runs, ...turns])].filter((id): id is string => Boolean(id))
}
