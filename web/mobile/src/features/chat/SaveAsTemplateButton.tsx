import {SAVE_AS_TEMPLATE_MESSAGE} from "@agenta/entities/workflow"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {Export} from "@phosphor-icons/react"
import {useAtomValue, useStore} from "jotai"

import {pendingTasksAtom, stashPendingTaskAtom} from "../home/pendingTask"

/**
 * The /w playground header's Save as template, on this surface. The request is shared
 * (`SAVE_AS_TEMPLATE_MESSAGE`); the delivery is this app's: it parks the message as the CURRENT
 * session's pending task, which the conversation sends like a typed message without touching the
 * composer, so an unsent draft stays where it is.
 *
 * Only an unsent request disables it. While the agent runs, a second tap queues a second message
 * behind the run, which is visible and removable like any queued message.
 */
export const SaveAsTemplateButton = ({
    agentId,
    sessionId,
}: {
    agentId: string
    sessionId: string
}) => {
    const store = useStore()
    const pending = useAtomValue(pendingTasksAtom)[sessionId] !== undefined

    const saveAsTemplate = () => {
        // Read the store, not the render: a double tap lands before the re-render.
        if (store.get(pendingTasksAtom)[sessionId]) return
        store.set(stashPendingTaskAtom, {
            sessionId,
            task: {agentId, text: SAVE_AS_TEMPLATE_MESSAGE},
        })
    }

    return (
        <SimpleTooltip title="Ask the agent to package itself as a template you can share">
            <span className="inline-flex shrink-0">
                <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={saveAsTemplate}
                    aria-label="Save as template"
                    data-testid="save-as-template-button"
                >
                    <Export size={14} />
                    <span className="hidden sm:inline">Save as template</span>
                </Button>
            </span>
        </SimpleTooltip>
    )
}
