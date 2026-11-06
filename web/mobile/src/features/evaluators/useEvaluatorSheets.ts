import {useCallback, useState} from "react"

import type {EvaluatorEntry} from "@agenta/entities/workflow"

/** What the Evaluators page has open over the list. */
export type EvaluatorSheet = {kind: "human"; editing: EvaluatorEntry | null} | null

/** The page's create and edit surfaces. One is open at a time. */
export const useEvaluatorSheets = () => {
    const [sheet, setSheet] = useState<EvaluatorSheet>(null)
    const close = useCallback(() => setSheet(null), [])
    const openHuman = useCallback(
        (editing: EvaluatorEntry | null = null) => setSheet({kind: "human", editing}),
        [],
    )
    return {sheet, close, openHuman}
}
