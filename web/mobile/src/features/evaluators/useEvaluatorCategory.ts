import {useCallback, useEffect, useState} from "react"

import type {EvaluatorCategory} from "@agenta/entities/workflow"
import {useRouter} from "next/router"

import {isEvaluatorCategory} from "./evaluatorsView"

/** The /w key, so a reader's last tab carries over from the old app. */
const STORAGE_KEY = "agenta:evaluators:category"

const readStored = (): EvaluatorCategory | null => {
    try {
        const value = window.localStorage.getItem(STORAGE_KEY)
        return isEvaluatorCategory(value) ? value : null
    } catch {
        return null
    }
}

const writeStored = (category: EvaluatorCategory) => {
    try {
        window.localStorage.setItem(STORAGE_KEY, category)
    } catch {
        // Storage can be blocked. The tab still works from the address.
    }
}

/**
 * The open tab. `?tab=` wins; with none, the last tab the reader used; with none, `automatic`.
 * The stored tab is read after mount, so the server render and the first client render agree.
 */
export const useEvaluatorCategory = () => {
    const router = useRouter()
    const [stored, setStored] = useState<EvaluatorCategory | null>(null)
    useEffect(() => setStored(readStored()), [])

    const tab = router.query.tab
    const category: EvaluatorCategory = isEvaluatorCategory(tab) ? tab : (stored ?? "automatic")

    const setCategory = useCallback(
        (next: EvaluatorCategory) => {
            writeStored(next)
            setStored(next)
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
