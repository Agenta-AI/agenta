import {useCallback, useMemo} from "react"

import {
    agentWorkflowsListQueryStateAtom,
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
import {Broadcast, FileZip, Stack, Storefront} from "@phosphor-icons/react"
import {useAtomValue, useStore} from "jotai"

import {useAgentPublishPanel} from "../agents/useAgentPublishPanel"
import {pendingTasksAtom, stashPendingTaskAtom} from "../home/pendingTask"

import {ShareMenuItem} from "./ShareMenuItem"

/** The session header's share actions: a Templates menu with the two template requests, then Publish. */
export const ShareMenu = ({
    agentId,
    sessionId,
    canRequestTemplate,
    workspaceId,
    projectId,
}: {
    agentId: string
    sessionId: string
    /** False without a live conversation (read-only replay, or no session yet). */
    canRequestTemplate: boolean
    workspaceId: string
    projectId: string
}) => {
    const store = useStore()
    const pending = useAtomValue(pendingTasksAtom)[sessionId] !== undefined

    // Names the agent on a connection and seeds a new Slack app's text.
    const agentsQuery = useAtomValue(agentWorkflowsListQueryStateAtom)
    const agent = useMemo(
        () => (agentsQuery.data ?? []).find((candidate) => candidate.id === agentId),
        [agentsQuery.data, agentId],
    )
    const resolveAgentName = useCallback(
        (id: string) => {
            const match = (agentsQuery.data ?? []).find((candidate) => candidate.id === id)
            return match ? match.name || match.slug || "Agent" : null
        },
        [agentsQuery.data],
    )

    const publish = useAgentPublishPanel({
        agentId,
        agentName: agent?.name || agent?.slug || undefined,
        agentDescription: agent?.description?.trim() || null,
        resolveAgentName,
        projectId,
        workspaceId,
        side: "right",
    })

    const sendTemplateRequest = (text: string) => {
        // Read the store, not the render: a double tap lands before the re-render.
        if (store.get(pendingTasksAtom)[sessionId]) return
        store.set(stashPendingTaskAtom, {sessionId, task: {agentId, text}})
    }

    return (
        <>
            {canRequestTemplate ? (
                <DropdownMenu>
                    <SimpleTooltip title="Templates">
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Templates"
                                className="h-7 w-7 shrink-0 p-0"
                                data-testid="template-menu-button"
                            >
                                <Stack size={14} />
                            </Button>
                        </DropdownMenuTrigger>
                    </SimpleTooltip>
                    <DropdownMenuContent align="end" className="w-72">
                        <DropdownMenuItem
                            className="gap-2.5 py-1.5"
                            disabled={pending}
                            onSelect={() => sendTemplateRequest(SAVE_AS_TEMPLATE_MESSAGE)}
                            data-testid="share-menu-save-zip"
                        >
                            <ShareMenuItem
                                icon={<FileZip />}
                                title="Save as template"
                                description="Download a .zip to reuse it"
                            />
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            className="gap-2.5 py-1.5"
                            disabled={pending}
                            onSelect={() =>
                                sendTemplateRequest(SHARE_TEMPLATE_IN_MARKETPLACE_MESSAGE)
                            }
                            data-testid="share-menu-share-marketplace"
                        >
                            <ShareMenuItem
                                icon={<Storefront />}
                                title="Share in the marketplace"
                                description="Let other teams start from it"
                            />
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            ) : null}
            <Button
                variant="ghost"
                size="sm"
                onClick={publish.openHub}
                data-testid="share-menu-publish"
            >
                <Broadcast data-icon="inline-start" />
                Publish
            </Button>
            {publish.panel}
        </>
    )
}
