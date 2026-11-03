import {useCallback, useMemo} from "react"

import {extractAgData, traceSpanMolecule} from "@agenta/entities/trace"
import {getHostQueryClient} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {atom, useAtomValue} from "jotai"

export type SpansStatus = "loading" | "error" | "ready"

/**
 * The `ag.data` of each selected span, read from the server copy. The span molecule's merged
 * data would carry any draft another surface left on the span, and the rows must hold what the
 * trace recorded.
 */
export const useSelectedSpansData = (spanIds: readonly string[]) => {
    const key = spanIds.join(",")
    const queriesAtom = useMemo(
        () =>
            atom((get) =>
                key
                    .split(",")
                    .filter(Boolean)
                    .map((id) => get(traceSpanMolecule.selectors.query(id))),
            ),
        [key],
    )
    const queries = useAtomValue(queriesAtom)
    const projectId = useAtomValue(projectIdAtom)

    const status: SpansStatus = queries.some((query) => query.isError)
        ? "error"
        : queries.every((query) => query.data)
          ? "ready"
          : "loading"

    const spansData = useMemo(
        () =>
            status === "ready"
                ? queries.map((query) => extractAgData(query.data ?? null))
                : [],
        [queries, status],
    )

    const retry = useCallback(() => {
        const client = getHostQueryClient()
        for (const id of key.split(",").filter(Boolean)) {
            void client.refetchQueries({queryKey: ["span", projectId, id]})
        }
    }, [key, projectId])

    return {status, spansData, retry}
}
