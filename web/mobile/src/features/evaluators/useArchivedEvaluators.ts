import type {EvaluatorCategory} from "@agenta/entities/workflow"

import {useEvaluatorEntries} from "./useEvaluators"

/** The archived evaluators of one category, newest archive first. The list is small: one query. */
export const useArchivedEvaluators = (args: {
    projectId: string
    category: EvaluatorCategory
    search: string
    enabled?: boolean
}) => useEvaluatorEntries({...args, mode: "archived"})
