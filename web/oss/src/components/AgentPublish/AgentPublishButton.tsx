import {useMemo} from "react"

import {AgentPublish, agentHostFromApiUrl} from "@agenta/settings-ui"
import {getAgentaApiUrl} from "@agenta/shared/api"
import {useAtomValue} from "jotai"

import {
    renderChannelsDrawer,
    useAgentChannels,
} from "@/oss/components/pages/overview/agent/useAgentChannels"
import {projectAtom, projectIdAtom} from "@/oss/state/project"

/**
 * The /w playground header's Publish control: the shared `AgentPublish`, fed this app's
 * channel connections and its 460px drawer. The /m session workspace renders the same one.
 */
const AgentPublishButton = ({
    agentId,
    agentName,
    agentDescription,
}: {
    agentId: string
    agentName?: string
    agentDescription?: string | null
}) => {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const project = useAtomValue(projectAtom)
    const host = useMemo(() => agentHostFromApiUrl(getAgentaApiUrl()), [])
    const {connections, loading, loadError, actions} = useAgentChannels(agentId)

    return (
        <AgentPublish
            agentId={agentId}
            agentName={agentName}
            agentDescription={agentDescription}
            projectId={projectId}
            workspaceId={project?.workspace_id || project?.organization_id || null}
            host={host}
            connections={connections}
            loading={loading}
            loadError={loadError}
            actions={actions}
            renderPanel={renderChannelsDrawer}
        />
    )
}

export default AgentPublishButton
