import {useCallback, useState} from "react"

import {
    AutomationRunHistoryError,
    AutomationRunHistoryView,
    useAutomation,
} from "@agenta/automation-ui"
import {useT} from "@agenta/i18n"
import automationsEditorCatalog from "@agenta/i18n/catalogs/automations.editor"
import {sessionRoutePath} from "@agenta/sessions/link"
import {useIsPhone} from "@agenta/ui/phone"
import {useViewForm, useViewTitle, type ViewProps} from "@agenta/ui/view-stack"
import {useRouter} from "next/router"

import {AutomationRunConversation} from "./AutomationRunConversation"
import type {AutomationRunHistoryViewParams} from "./automationRunHistoryView"
import {AutomationRunNowButton} from "./AutomationRunNowButton"

/** The body of the run history view: the shared view in its panel frame, with this app's chat. */
const AutomationRunHistoryViewBody = ({params}: ViewProps<AutomationRunHistoryViewParams>) => {
    const t = useT(automationsEditorCatalog)
    const phone = useIsPhone()
    // While one run fills the view, the pane header's Back returns to the list (one back per screen).
    const [runBack, setRunBack] = useState<(() => void) | null>(null)
    const [runTitle, setRunTitle] = useState<string | undefined>(undefined)
    const onRunBackChange = useCallback((back: (() => void) | null, title?: string) => {
        setRunBack(() => back)
        setRunTitle(title)
    }, [])
    // A phone header names the open run, not "Run history" beside a Back to "Run history".
    useViewTitle(phone && runTitle ? runTitle : t("automations.editor.runHistory"))
    useViewForm({
        dirty: false,
        valid: true,
        save: async () => true,
        back: runBack ?? undefined,
        backTitle: t("automations.editor.runHistory"),
    })
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
    if (error && !automation)
        return <AutomationRunHistoryError onRetry={() => void refetch()} phone={phone} />

    return (
        <div className="flex h-full min-h-0 flex-col">
            <AutomationRunHistoryView
                automation={automation}
                frame="panel"
                initialRunId={params.runId}
                phone={phone}
                runHistoryHref={`${router.basePath}${base}/automations/${encodeURIComponent(params.automationId)}?view=runs`}
                sessionHref={sessionHref}
                runNow={
                    automation ? (
                        <AutomationRunNowButton
                            automation={automation}
                            base={base}
                            dirty={Boolean(params.unsavedSettings)}
                            phone={phone}
                        />
                    ) : null
                }
                renderConversation={renderConversation}
                onRunBackChange={onRunBackChange}
            />
        </div>
    )
}

export default AutomationRunHistoryViewBody
