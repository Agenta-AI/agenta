import {useMemo, useState} from "react"

import {
    agentSharingQueryAtomFamily,
    setAgentVisibilityAtom,
    sharingMembersQueryAtomFamily,
    takeAgentOwnershipAtom,
    transferAgentAtom,
    type Visibility,
} from "@agenta/entities/sharing"
import {
    AgentPrivacyControl,
    AgentPrivacyDialog,
    sharingWriteResultFromError,
    type AgentChannelConnection,
    type AgentPrivacyProps,
    type SharingPerson,
    type SharingWriteResult,
} from "@agenta/entity-ui/sharing"
import {EMPTY_CONNECTIONS, agentConnectionsOf, type ChannelConnections} from "@agenta/settings-ui"
import {useDebounceInput} from "@agenta/shared/hooks"
import {userAtom} from "@agenta/shared/state"
import {message} from "@agenta/ui/app-message"
import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue, useSetAtom} from "jotai"

import {channelPlatformLabel} from "@/lib/sharingCopy"

import {useCurrentProject} from "../context/useCurrentProject"

import {useDisclosureProviderLabel} from "./useDisclosureProviderLabel"

const PLATFORMS = ["slack", "telegram", "whatsapp"] as const

/** One entry per channel app bound to the agent (a Slack app in one workspace), never a channel.
 *  Only the ones that answer now: make-private turns these off. */
const channelConnectionsOf = (connections: ChannelConnections): AgentChannelConnection[] =>
    PLATFORMS.flatMap((platform) =>
        agentConnectionsOf(connections, platform)
            .filter((connection) => !connection.agentOff)
            .map((connection) => ({
                platform: channelPlatformLabel[platform],
                workspace: connection.workspaceName ?? null,
            })),
    )

/** The platforms with a connection of this agent that is still off. */
const channelsOffOf = (connections: ChannelConnections): string[] =>
    PLATFORMS.filter((platform) =>
        agentConnectionsOf(connections, platform).some((connection) => connection.agentOff),
    ).map((platform) => channelPlatformLabel[platform])

export interface AgentPrivacyHostOptions {
    agentId: string
    agentName: string
    workspaceId: string
    projectId: string
    /** The agent's channel apps, as the Publish panel already read them (no request here). */
    connections?: ChannelConnections
    /** Opens the agent's Publish panel; "Open Channels" links to it. */
    onOpenChannels?: () => void
    /** Runs after a successful write; make-private turns channel connections off. */
    onChanged?: () => void
}

/** The sharing state of the agent and the project's members, as the privacy UI reads them. */
const useAgentPrivacyProps = ({
    agentId,
    agentName,
    workspaceId,
    projectId,
    connections = EMPTY_CONNECTIONS,
    onOpenChannels,
    onChanged,
}: AgentPrivacyHostOptions): AgentPrivacyProps => {
    const project = useCurrentProject(workspaceId, projectId)
    const me = useAtomValue(userAtom)
    const queryClient = useQueryClient()
    const sharingQuery = useAtomValue(agentSharingQueryAtomFamily(agentId))
    const sharing = sharingQuery.data?.sharing
    const labels = useDisclosureProviderLabel(sharingQuery.data?.disclosure)

    const [search, setSearch] = useState("")
    const [typed, setTyped] = useDebounceInput<string>(search, setSearch, 250, "")
    const membersQuery = useAtomValue(sharingMembersQueryAtomFamily(search))
    const everyoneQuery = useAtomValue(sharingMembersQueryAtomFamily(""))

    const setVisibility = useSetAtom(setAgentVisibilityAtom)
    const transfer = useSetAtom(transferAgentAtom)
    const takeOwnership = useSetAtom(takeAgentOwnershipAtom)

    const ownerId = sharing?.policy.owner_user_id ?? null
    const owner = useMemo<SharingPerson | null>(() => {
        if (!ownerId) return null
        if (me?.id === ownerId) return {user_id: me.id, email: me.email, name: me.username || null}
        return everyoneQuery.data?.members.find((member) => member.user_id === ownerId) ?? null
    }, [everyoneQuery.data, me, ownerId])

    const channelConnections = useMemo(() => channelConnectionsOf(connections), [connections])
    const channelsOff = useMemo(() => channelsOffOf(connections), [connections])

    const outcome = async (write: () => Promise<unknown>): Promise<SharingWriteResult> => {
        try {
            await write()
            // The archived-agents list is this app's own query: a private agent leaves it for
            // everyone else, so it re-reads like the lists the entity layer refreshes.
            void queryClient.invalidateQueries({
                queryKey: ["agent-workflows", "archived", projectId],
            })
            onChanged?.()
            return "ok"
        } catch (error) {
            return sharingWriteResultFromError(error)
        }
    }

    return {
        agentName,
        projectName: project?.project_name ?? "",
        sharing,
        disclosure: sharingQuery.data?.disclosure,
        providerLabel: labels.label,
        // The accounts are named by display name: the dialog waits for them like for the state.
        // A failed re-read is a load error too, with the last state in hand: no write acts on it.
        loading: sharingQuery.isPending || labels.pending,
        loadError: sharingQuery.isError || labels.failed,
        onRetry: () => {
            if (sharingQuery.isError) void sharingQuery.refetch()
            labels.retry()
        },
        owner,
        channelConnections,
        channelsOff,
        onOpenChannels,
        members: membersQuery.data?.members ?? [],
        membersSearch: typed,
        onMembersSearch: setTyped,
        membersLoading: membersQuery.isPending,
        membersError: membersQuery.isError,
        onSetVisibility: (visibility: Visibility) =>
            outcome(() => setVisibility({workflowId: agentId, visibility})),
        onTransfer: (userId: string) => outcome(() => transfer({workflowId: agentId, userId})),
        onTakeOwnership: () => outcome(() => takeOwnership({workflowId: agentId})),
        onNotify: (text) => message.success(text),
        onReload: () => void sharingQuery.refetch(),
    }
}

/**
 * The agent's "Private" / "Shared" control in the playground top bar, wired to the sharing
 * state of the agent and the project's members.
 */
export const AgentPrivacyHost = (options: AgentPrivacyHostOptions) => (
    <AgentPrivacyControl {...useAgentPrivacyProps(options)} />
)

/**
 * "Privacy and owner" on its own, for the channel screens' Share links. Mount it only while it
 * is open: it reads the agent's sharing state.
 */
export const AgentPrivacyDialogHost = ({
    onClose,
    ...options
}: AgentPrivacyHostOptions & {onClose: () => void}) => (
    <AgentPrivacyDialog
        {...useAgentPrivacyProps(options)}
        open
        onOpenChange={(open) => !open && onClose()}
    />
)
