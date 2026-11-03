import {useMemo} from "react"

import {
    appWorkflowsListQueryAtom,
    appWorkflowsListQueryStateAtom,
    type Workflow,
} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"

import type {DraftApp} from "./newEvaluationDraft"

/** The app's type as /w labels it. */
export const appTypeLabel = (app: Workflow): "Chat" | "Completion" | "Custom" =>
    app.flags?.is_custom ? "Custom" : app.flags?.is_chat ? "Chat" : "Completion"

export const toDraftApp = (app: Workflow): DraftApp => ({
    id: app.id,
    name: app.name || app.slug || app.id,
    isCustom: Boolean(app.flags?.is_custom),
})

/** The apps of the project, never evaluators. Apps are non-evaluator workflows. */
export const useEvaluableApps = () => {
    const state = useAtomValue(appWorkflowsListQueryStateAtom)
    const query = useAtomValue(appWorkflowsListQueryAtom)
    const apps = useMemo(
        () => state.data.filter((workflow) => !workflow.flags?.is_evaluator),
        [state.data],
    )
    return {apps, isPending: state.isPending, isError: state.isError, refetch: query.refetch}
}
