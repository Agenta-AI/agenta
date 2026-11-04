import {useCallback, useState} from "react"

import dynamic from "next/dynamic"

import type {CreatableKind} from "../list/CreateEvaluationMenu"
import {EvaluationsScreen} from "../list/EvaluationsScreen"
import {useEvaluationRunsFilters} from "../list/useEvaluationRunsFilters"

import type {NewEvaluationKind} from "./newEvaluationDraft"

// The wizard and its pickers cost nothing until a reader starts an evaluation.
const NewEvaluationSheet = dynamic(
    () => import("./NewEvaluationSheet").then((module) => module.NewEvaluationSheet),
    {ssr: false},
)

const WIZARD_KINDS: readonly CreatableKind[] = ["auto", "human"]

/** The runs list with the wizard behind its create entry. */
export const EvaluationsRoute = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    const filters = useEvaluationRunsFilters()
    const [kind, setKind] = useState<NewEvaluationKind | null>(null)
    // Load the sheet at the first open, then keep it so it can close with its animation.
    const [loaded, setLoaded] = useState(false)

    const handleCreate = useCallback((next: CreatableKind) => {
        if (next === "custom") return
        setLoaded(true)
        setKind(next)
    }, [])

    // A started auto run shows on its own tab. A human run opens its page instead.
    const handleStarted = useCallback(
        (started: NewEvaluationKind) => {
            if (started === "auto") filters.setKind("auto")
        },
        [filters],
    )

    return (
        <>
            <EvaluationsScreen
                workspaceId={workspaceId}
                projectId={projectId}
                onCreate={handleCreate}
                createKinds={WIZARD_KINDS}
            />
            {loaded ? (
                <NewEvaluationSheet
                    kind={kind}
                    projectId={projectId}
                    base={`/w/${workspaceId}/p/${projectId}`}
                    appId={filters.appId}
                    onClose={() => setKind(null)}
                    onStarted={handleStarted}
                />
            ) : null}
        </>
    )
}
