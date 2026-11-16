import {useCallback, useMemo} from "react"

import {
    agentWorkflowsListQueryStateAtom,
    SAVE_AS_TEMPLATE_MESSAGE,
    SHARE_TEMPLATE_IN_MARKETPLACE_MESSAGE,
} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import chatShareMenuCatalog from "@agenta/i18n/catalogs/chat.shareMenu"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    SimpleTooltip,
} from "@agenta/ui/ui"
import {Broadcast, ExportIcon, FileZip, Storefront} from "@phosphor-icons/react"
import {useAtomValue, useStore} from "jotai"

import {useAgentPublishPanel} from "../agents/useAgentPublishPanel"
import {pendingTasksAtom, stashPendingTaskAtom} from "../home/pendingTask"

import {AgentPrivacyHost} from "./AgentPrivacyHost"
import {ShareMenuItem} from "./ShareMenuItem"

/**
 * The session header's share actions: a Templates menu with the two template requests, the
 * agent's privacy control, then Publish. Templates only for someone who can send here.
 */
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
    const t = useT(chatShareMenuCatalog)
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
            return match ? match.name || match.slug || t("chat.shareMenu.agent") : null
        },
        [agentsQuery.data],
    )

    const agentName = agent?.name || agent?.slug || t("chat.shareMenu.agent")
    const publish = useAgentPublishPanel({
        agentId,
        agentName: agent?.name || agent?.slug || undefined,
        agentDescription: agent?.description?.trim() || null,
        resolveAgentName,
        projectId,
        workspaceId,
        side: "right",
    })
    const {reload} = publish
    // A privacy write can change the agent's channel connections: read them again after it.
    const reloadChannels = useCallback(() => void reload().catch(() => null), [reload])

    const sendTemplateRequest = (text: string) => {
        // Read the store, not the render: a double tap lands before the re-render.
        if (store.get(pendingTasksAtom)[sessionId]) return
        store.set(stashPendingTaskAtom, {sessionId, task: {agentId, text}})
    }

    return (
        <>
            {canRequestTemplate ? (
                <DropdownMenu>
                    <SimpleTooltip title={t("chat.shareMenu.templates")}>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={t("chat.shareMenu.templates")}
                                className="h-7 w-7 shrink-0 p-0"
                                data-testid="template-menu-button"
                            >
                                <ExportIcon size={14} />
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
                                title={t("chat.shareMenu.saveAsTemplate")}
                                description={t("chat.shareMenu.downloadZip")}
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
                                title={t("chat.shareMenu.shareInMarketplace")}
                                description={t("chat.shareMenu.letOtherTeams")}
                            />
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            ) : null}
            {canRequestTemplate ? (
                <span aria-hidden className="h-5 w-px shrink-0 bg-colorBorderSecondary" />
            ) : null}
            {/* Who can see this agent: between Templates and Publish, at every width. */}
            <AgentPrivacyHost
                agentId={agentId}
                agentName={agentName}
                access={agentsQuery.data ? (agent ? (agent.access ?? null) : undefined) : undefined}
                workspaceId={workspaceId}
                projectId={projectId}
                connections={publish.connections}
                onOpenChannels={publish.openHub}
                onChanged={reloadChannels}
            />
            <Button
                variant="ghost"
                size="sm"
                onClick={publish.openHub}
                data-testid="share-menu-publish"
            >
                <Broadcast data-icon="inline-start" />
                {t("chat.shareMenu.publish")}
            </Button>
            {publish.panel}
        </>
    )
}
