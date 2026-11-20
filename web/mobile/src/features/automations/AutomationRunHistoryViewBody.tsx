import {useCallback} from "react"

import {
    AutomationRunHistoryError,
    AutomationRunHistoryView,
    useAutomation,
} from "@agenta/automation-ui"
import {useT} from "@agenta/i18n"
import automationsEditorCatalog from "@agenta/i18n/catalogs/automations.editor"
import {sessionRoutePath} from "@agenta/sessions/link"
import {useViewTitle, type ViewProps} from "@agenta/ui/view-stack"
import {useRouter} from "next/router"

import {AutomationRunConversation} from "./AutomationRunConversation"
import type {AutomationRunHistoryViewParams} from "./automationRunHistoryView"
import {AutomationRunNowButton} from "./AutomationRunNowButton"

/** The body of the run history view: the shared view in its panel frame, with this app's chat. */
const AutomationRunHistoryViewBody = ({params}: ViewProps<AutomationRunHistoryViewParams>) => {
    const t = useT(automationsEditorCatalog)
    useViewTitle(t("automations.editor.runHistory"))
    const router = useRouter()
    const {automation, error, refetch} = useAutomation(params.automationId, params.kind)
    const base = `/w/${params.workspaceId}/p/${params.projectId}`

    const renderConversation = useCallback(
        (sessionId: string) => (
            <AutomationRunConversation
                sessionId={sessionId}
                projectId={params.projectId}
                workspaceId={params.workspaceId}
                agentId={automation?.agentId ?? null}
            />
        ),
        [automation?.agentId, params.projectId, params.workspaceId],
    )
    // New tabs need the app's base path: without it a link opens the old app.
    const sessionHref = useCallback(
        (sessionId: string) => `${router.basePath}${sessionRoutePath(base, sessionId)}`,
        [base, router.basePath],
    )

    // The automation did not load: say so and offer a retry, rather than an empty history.
    if (error && !automation) return <AutomationRunHistoryError onRetry={() => void refetch()} />

    return (
        <div className="flex h-full min-h-0 flex-col">
            <AutomationRunHistoryView
                automation={automation}
                frame="panel"
                initialRunId={params.runId}
                runHistoryHref={`${router.basePath}${base}/automations/${encodeURIComponent(params.automationId)}?view=runs`}
                sessionHref={sessionHref}
                runNow={
                    automation ? (
                        <AutomationRunNowButton automation={automation} base={base} dirty={false} />
                    ) : null
                }
                renderConversation={renderConversation}
            />
        </div>
    )
}

export default AutomationRunHistoryViewBody
