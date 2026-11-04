import {useCallback, useEffect, useMemo, useState, type ReactNode} from "react"

import {
    agentWorkflowsListQueryStateAtom,
    SAVE_AS_TEMPLATE_MESSAGE,
    SHARE_TEMPLATE_IN_MARKETPLACE_MESSAGE,
} from "@agenta/entities/workflow"
import {
    AgentPrivacyDialog,
    AgentPrivacySummary,
    agentSharingCopy,
    useAgentSharingWrites,
} from "@agenta/entity-ui/sharing"
import {sessionShareSummary} from "@agenta/sessions-ui/sharing"
import {
    Button,
    Popover,
    PopoverContent,
    PopoverTrigger,
    Sheet,
    SheetContent,
    SheetTitle,
} from "@agenta/ui/ui"
import {Broadcast, FileZip, Storefront, UsersIcon} from "@phosphor-icons/react"
import {useAtom, useAtomValue, useStore} from "jotai"

import {useAgentPublishPanel} from "../agents/useAgentPublishPanel"
import {pendingTasksAtom, stashPendingTaskAtom} from "../home/pendingTask"

import {sessionBarPanelAtom} from "./sessionBarState"
import {SessionSharingControl} from "./SessionSharingControl"
import {ShareMenuItem} from "./ShareMenuItem"
import {SharePanel} from "./SharePanel"
import {useAgentPrivacyProps} from "./useAgentPrivacyProps"
import {useSessionSharing} from "./useSessionSharing"

/**
 * The session bar's Share and Publish. Share gathers who can use the agent, this chat's sharing
 * and the template requests; each row opens the flow that already owns it. On a phone both
 * buttons live in the ⋯ sheet, which reaches them through `sessionBarPanelAtom`.
 */
export const ShareMenu = ({
    agentId,
    sessionId,
    sessionName,
    showSession,
    canRequestTemplate,
    workspaceId,
    projectId,
    phone,
}: {
    agentId: string
    sessionId: string
    sessionName: string
    /** False on first run, where no chat exists to share yet. */
    showSession: boolean
    /** False without a live conversation (read-only replay, or no session yet). */
    canRequestTemplate: boolean
    workspaceId: string
    projectId: string
    phone: boolean
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

    const agentName = agent?.name || agent?.slug || "Agent"
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

    const [barPanel, setBarPanel] = useAtom(sessionBarPanelAtom)
    const open = barPanel === "share"
    const close = () => setBarPanel(null)

    // Nothing is read until Share first opens; the dialog outlives the panel that opened it.
    const [engaged, setEngaged] = useState(false)
    const [privacyDialogOpen, setPrivacyDialogOpen] = useState(false)
    useEffect(() => {
        if (open) setEngaged(true)
    }, [open])
    const privacy = useAgentPrivacyProps({
        agentId,
        agentName,
        access: agentsQuery.data ? (agent ? (agent.access ?? null) : undefined) : undefined,
        workspaceId,
        projectId,
        connections: publish.connections,
        onOpenChannels: publish.openHub,
        onChanged: reloadChannels,
        engaged: engaged || privacyDialogOpen,
    })
    const writes = useAgentSharingWrites(privacy)
    const {sharing} = useSessionSharing(sessionId, projectId)

    // The phone's ⋯ sheet asks for the hub here, where the panel lives.
    const {openHub} = publish
    useEffect(() => {
        if (barPanel !== "publish") return
        setBarPanel(null)
        openHub()
    }, [barPanel, openHub, setBarPanel])

    const sendTemplateRequest = (text: string) => {
        // Read the store, not the render: a double tap lands before the re-render.
        if (store.get(pendingTasksAtom)[sessionId]) return
        store.set(stashPendingTaskAtom, {sessionId, task: {agentId, text}})
    }

    const templateRow = (
        testId: string,
        text: string,
        icon: ReactNode,
        title: string,
        note: string,
    ) => (
        <button
            type="button"
            disabled={pending}
            data-testid={testId}
            onClick={() => {
                close()
                sendTemplateRequest(text)
            }}
            className="hover:bg-accent text-foreground flex w-full cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent px-2 py-1.5 text-left text-sm [font-family:inherit] disabled:cursor-not-allowed disabled:opacity-50"
        >
            <ShareMenuItem icon={icon} title={title} description={note} />
        </button>
    )

    const panel = (
        <SharePanel
            agentAccessLabel={agentSharingCopy.panelTitle}
            agentAccess={
                <AgentPrivacySummary
                    {...privacy}
                    writes={writes}
                    onChange={() => {
                        close()
                        setPrivacyDialogOpen(true)
                    }}
                />
            }
            session={
                showSession
                    ? {
                          name: sessionName,
                          hint: sharing?.my_role === "owner" ? sessionShareSummary(sharing) : null,
                          control: (
                              <SessionSharingControl
                                  sessionId={sessionId}
                                  sessionName={sessionName}
                                  workspaceId={workspaceId}
                                  projectId={projectId}
                                  agentId={agentId}
                                  onOpened={close}
                              />
                          ),
                      }
                    : null
            }
            reuse={
                canRequestTemplate ? (
                    <>
                        {templateRow(
                            "share-menu-save-zip",
                            SAVE_AS_TEMPLATE_MESSAGE,
                            <FileZip />,
                            "Save as template",
                            "Download a .zip to reuse it",
                        )}
                        {templateRow(
                            "share-menu-share-marketplace",
                            SHARE_TEMPLATE_IN_MARKETPLACE_MESSAGE,
                            <Storefront />,
                            "Share in the marketplace",
                            "Let other teams start from it",
                        )}
                    </>
                ) : null
            }
        />
    )

    return (
        <>
            {phone ? (
                <Sheet open={open} onOpenChange={(next) => setBarPanel(next ? "share" : null)}>
                    <SheetContent
                        side="responsive"
                        aria-describedby={undefined}
                        className="flex flex-col overflow-y-auto pb-[env(safe-area-inset-bottom)]"
                    >
                        <SheetTitle className="px-4 pt-4 text-base">Share</SheetTitle>
                        {panel}
                    </SheetContent>
                </Sheet>
            ) : (
                <>
                    <Popover
                        open={open}
                        onOpenChange={(next) => setBarPanel(next ? "share" : null)}
                    >
                        <PopoverTrigger asChild>
                            <Button variant="outline" size="sm" data-testid="share-menu-share">
                                <UsersIcon data-icon="inline-start" />
                                Share
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent
                            align="end"
                            aria-label="Share"
                            className="w-[380px] overflow-hidden p-0"
                        >
                            <p className="m-0 px-3.5 pt-3.5 text-[15px] font-semibold">Share</p>
                            {panel}
                        </PopoverContent>
                    </Popover>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={publish.openHub}
                        data-testid="share-menu-publish"
                    >
                        <Broadcast data-icon="inline-start" />
                        Publish
                    </Button>
                </>
            )}
            <AgentPrivacyDialog
                {...privacy}
                open={privacyDialogOpen}
                onOpenChange={setPrivacyDialogOpen}
                writes={writes}
            />
            {publish.panel}
        </>
    )
}
