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

// Same for the live evaluation sheet, which also loads the trace filter dialog.
const LiveEvaluationSheet = dynamic(
    () => import("../live/LiveEvaluationSheet").then((module) => module.LiveEvaluationSheet),
    {ssr: false},
)

// The SDK setup sheet is only code to copy, so it loads at the first open as well.
const SdkEvaluationSheet = dynamic(
    () => import("./SdkEvaluationSheet").then((module) => module.SdkEvaluationSheet),
    {ssr: false},
)

const CREATE_KINDS: readonly CreatableKind[] = ["auto", "human", "online", "custom"]
// Live evaluations are project wide, so an app scoped list does not offer them.
const APP_CREATE_KINDS: readonly CreatableKind[] = ["auto", "human", "custom"]

/** The runs list with the wizard and the live evaluation sheet behind its create entry. */
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
    const [liveOpen, setLiveOpen] = useState(false)
    const [liveLoaded, setLiveLoaded] = useState(false)
    const [sdkOpen, setSdkOpen] = useState(false)
    const [sdkLoaded, setSdkLoaded] = useState(false)

    const handleCreate = useCallback((next: CreatableKind) => {
        if (next === "custom") {
            setSdkLoaded(true)
            setSdkOpen(true)
            return
        }
        if (next === "online") {
            setLiveLoaded(true)
            setLiveOpen(true)
            return
        }
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
                createKinds={filters.appId ? APP_CREATE_KINDS : CREATE_KINDS}
            />
            {loaded ? (
                <NewEvaluationSheet
                    kind={kind}
                    projectId={projectId}
                    base={`/w/${workspaceId}/p/${projectId}`}
                    appId={filters.appId}
                    onClose={() => setKind(null)}
                    onStarted={handleStarted}
                    // No playground on this page: the automatic create drawer may use its state.
                    allowAutomaticCreate
                />
            ) : null}
            {liveLoaded ? (
                <LiveEvaluationSheet
                    open={liveOpen}
                    projectId={projectId}
                    base={`/w/${workspaceId}/p/${projectId}`}
                    onClose={() => setLiveOpen(false)}
                    // A new live run shows on its own tab.
                    onCreated={() => filters.setKind("online")}
                />
            ) : null}
            {sdkLoaded ? (
                <SdkEvaluationSheet
                    open={sdkOpen}
                    workspaceId={workspaceId}
                    projectId={projectId}
                    onClose={() => setSdkOpen(false)}
                />
            ) : null}
        </>
    )
}
