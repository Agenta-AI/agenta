import {
    SAVE_AS_TEMPLATE_MESSAGE,
    SHARE_TEMPLATE_IN_MARKETPLACE_MESSAGE,
} from "@agenta/entities/workflow"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    SimpleTooltip,
} from "@agenta/ui/ui"
import {Export} from "@phosphor-icons/react"
import {useAtomValue, useStore} from "jotai"

import {pendingTasksAtom, stashPendingTaskAtom} from "../home/pendingTask"

/**
 * The /w playground header's template menu, on this surface: save the agent as a template zip,
 * or share it in the marketplace. The requests are shared; the delivery is this app's: each item
 * parks its message as the CURRENT session's pending task, which the conversation sends like a
 * typed message without touching the composer, so an unsent draft stays where it is.
 *
 * Only an unsent request disables it. While the agent runs, a second request queues behind the
 * run, which is visible and removable like any queued message.
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

    const sendTemplateRequest = (text: string) => {
        // Read the store, not the render: a double tap lands before the re-render.
        if (store.get(pendingTasksAtom)[sessionId]) return
        store.set(stashPendingTaskAtom, {sessionId, task: {agentId, text}})
    }

    return (
        <DropdownMenu>
            <SimpleTooltip title="Template options">
                <span className="inline-flex shrink-0">
                    <DropdownMenuTrigger asChild disabled={pending}>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Template options"
                            data-testid="template-options-button"
                        >
                            <Export size={16} />
                        </Button>
                    </DropdownMenuTrigger>
                </span>
            </SimpleTooltip>
            <DropdownMenuContent align="end">
                <DropdownMenuItem
                    onSelect={() => sendTemplateRequest(SAVE_AS_TEMPLATE_MESSAGE)}
                    data-testid="template-options-save-zip"
                >
                    Save as template (.zip)
                </DropdownMenuItem>
                <DropdownMenuItem
                    onSelect={() => sendTemplateRequest(SHARE_TEMPLATE_IN_MARKETPLACE_MESSAGE)}
                    data-testid="template-options-share-marketplace"
                >
                    Share as template in the marketplace
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
