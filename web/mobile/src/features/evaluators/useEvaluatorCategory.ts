import {useCallback} from "react"

import type {EvaluatorCategory} from "@agenta/entities/workflow"
import {useRouter} from "next/router"

import {isEvaluatorCategory} from "./evaluatorsView"

/** The open tab: `?tab=` when it names one, else Automatic, as in /w. */
export const useEvaluatorCategory = () => {
    const router = useRouter()
    const tab = router.query.tab
    const category: EvaluatorCategory = isEvaluatorCategory(tab) ? tab : "automatic"

    const setCategory = useCallback(
        (next: EvaluatorCategory) => {
            void router.replace(
                {pathname: router.pathname, query: {...router.query, tab: next}},
                undefined,
                {shallow: true},
            )
        },
        [router],
    )

    return [category, setCategory] as const
}
