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
    sharingWriteResultFromError,
    type AgentChannelConnection,
    type SharingPerson,
    type SharingWriteResult,
} from "@agenta/entity-ui/sharing"
import {agentConnectionsOf, type ChannelConnections} from "@agenta/settings-ui"
import {useDebounceInput} from "@agenta/shared/hooks"
import {userAtom} from "@agenta/shared/state"
import {message} from "@agenta/ui/app-message"
import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue, useSetAtom} from "jotai"

import {channelPlatformLabel} from "@/lib/sharingCopy"

import {useCurrentProject} from "../context/useCurrentProject"

const PLATFORMS = ["slack", "telegram", "whatsapp"] as const

/** One entry per channel app bound to the agent (a Slack app in one workspace), never a channel. */
const channelConnectionsOf = (connections: ChannelConnections): AgentChannelConnection[] =>
    PLATFORMS.flatMap((platform) =>
        agentConnectionsOf(connections, platform).map((connection) => ({
            platform: channelPlatformLabel[platform],
            workspace: connection.workspaceName ?? null,
        })),
    )

/**
 * The agent's "Private" / "Shared" control in the playground top bar, wired to the sharing
 * state of the agent and the project's members. `connections` are the agent's channel apps the
 * Publish panel already read, so the make-private warning costs no request of its own.
 */
export const AgentPrivacyHost = ({
    agentId,
    agentName,
    workspaceId,
    projectId,
    connections,
}: {
    agentId: string
    agentName: string
    workspaceId: string
    projectId: string
    connections: ChannelConnections
}) => {
    const project = useCurrentProject(workspaceId, projectId)
    const me = useAtomValue(userAtom)
    const queryClient = useQueryClient()
    const sharingQuery = useAtomValue(agentSharingQueryAtomFamily(agentId))
    const sharing = sharingQuery.data?.sharing

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

    const outcome = async (write: () => Promise<unknown>): Promise<SharingWriteResult> => {
        try {
            await write()
            // The archived-agents list is this app's own query: a private agent leaves it for
            // everyone else, so it re-reads like the lists the entity layer refreshes.
            void queryClient.invalidateQueries({
                queryKey: ["agent-workflows", "archived", projectId],
            })
            return "ok"
        } catch (error) {
            return sharingWriteResultFromError(error)
        }
    }

    return (
        <AgentPrivacyControl
            agentName={agentName}
            projectName={project?.project_name ?? ""}
            sharing={sharing}
            disclosure={sharingQuery.data?.disclosure}
            loading={sharingQuery.isPending}
            loadError={sharingQuery.isError && !sharingQuery.data}
            onRetry={() => void sharingQuery.refetch()}
            owner={owner}
            channelConnections={channelConnections}
            members={membersQuery.data?.members ?? []}
            membersSearch={typed}
            onMembersSearch={setTyped}
            membersLoading={membersQuery.isPending}
            membersError={membersQuery.isError}
            onSetVisibility={(visibility: Visibility) =>
                outcome(() => setVisibility({workflowId: agentId, visibility}))
            }
            onTransfer={(userId: string) => outcome(() => transfer({workflowId: agentId, userId}))}
            onTakeOwnership={() => outcome(() => takeOwnership({workflowId: agentId}))}
            onNotify={(text) => message.success(text)}
            onReload={() => void sharingQuery.refetch()}
        />
    )
}
