import {useCallback, useMemo} from "react"

import {
    COMPARE_QUERY_KEY,
    compareBlockReason,
    compareParamValue,
    compareRunIds,
    evaluationRunQueryAtomFamily,
} from "@agenta/entities/evaluationRun"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

const NONE: string[] = []

/**
 * The runs compared with `runId`, kept in `?compare=a,b` as in the old app. The base run, repeats
 * and runs past the limit are dropped. A run that cannot be compared (not finished, not on a test
 * set) compares nothing. A change replaces the address without a new history entry.
 */
export function useCompareRunIds(runId: string) {
    const router = useRouter()
    const run = useAtomValue(evaluationRunQueryAtomFamily(runId)).data
    const value = router.query[COMPARE_QUERY_KEY]
    const key = Array.isArray(value) ? value.join(",") : (value ?? "")
    const comparable = Boolean(run) && !compareBlockReason(run ?? {id: runId})
    const ids = useMemo(
        () => (comparable ? compareRunIds(key, runId) : NONE),
        [comparable, key, runId],
    )

    const setIds = useCallback(
        (next: readonly string[]) => {
            const {[COMPARE_QUERY_KEY]: _compare, ...rest} = router.query
            const param = compareParamValue(next)
            void router.replace(
                {
                    pathname: router.pathname,
                    query: param ? {...rest, [COMPARE_QUERY_KEY]: param} : rest,
                },
                undefined,
                {shallow: true},
            )
        },
        [router],
    )

    return [ids, setIds] as const
}
