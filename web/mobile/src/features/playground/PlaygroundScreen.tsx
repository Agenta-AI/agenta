import {AppPlaygroundScreen} from "./AppPlaygroundScreen"
import {EvaluatorPlaygroundScreen} from "./EvaluatorPlaygroundScreen"

/**
 * The playground. Both playground routes load this one module, so the evaluator playground
 * shares the app playground's code and adds only its own header and selection.
 */
export const PlaygroundScreen = ({
    mode = "app",
    workspaceId,
    projectId,
    appId = "",
}: {
    mode?: "app" | "evaluator"
    workspaceId: string
    projectId: string
    appId?: string
}) =>
    mode === "evaluator" ? (
        <EvaluatorPlaygroundScreen workspaceId={workspaceId} projectId={projectId} />
    ) : (
        <AppPlaygroundScreen workspaceId={workspaceId} projectId={projectId} appId={appId} />
    )
