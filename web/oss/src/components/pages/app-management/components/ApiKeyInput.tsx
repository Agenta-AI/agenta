import {useMemo, useState} from "react"

import {Button, Input, Space, Typography} from "antd"

import {message} from "@/oss/components/AppMessageContext"
import {createApiKey} from "@/oss/services/apiKeys/api"
import {fetchAllProjects} from "@/oss/services/project"
import {useOrgData} from "@/oss/state/org"
import {getProjectValues} from "@/oss/state/project"
import {waitForWorkspaceContext} from "@/oss/state/url/postLoginRedirect"

interface ApiKeyInputProps {
    apiKeyValue: string
    onApiKeyChange: React.Dispatch<React.SetStateAction<string>>
}

const ApiKeyInput: React.FC<ApiKeyInputProps> = ({apiKeyValue, onApiKeyChange}) => {
    const [isLoadingApiKey, setIsLoadingApiKey] = useState(false)
    const {selectedOrg} = useOrgData()

    const workspaceId: string = useMemo(
        () => selectedOrg?.default_workspace.id || "",
        [selectedOrg],
    )

    const handleGenerateApiKey = async () => {
        try {
            setIsLoadingApiKey(true)

            let projectId = getProjectValues().projectId
            let finalWorkspaceId = workspaceId

            if (!projectId || !finalWorkspaceId) {
                try {
                    const context = await waitForWorkspaceContext({
                        timeoutMs: 3000,
                        requireProjectId: true,
                        requireWorkspaceId: true,
                        requireOrgData: true,
                    })
                    projectId = context.projectId
                    finalWorkspaceId = context.workspaceId || ""
                } catch (e) {
                    console.warn("waitForWorkspaceContext failed or timed out", e)
                }

                if (!projectId && finalWorkspaceId) {
                    try {
                        const projects = await fetchAllProjects()
                        if (projects.length > 0) {
                            // Find a project that belongs to this workspace
                            const project =
                                projects.find(
                                    (p) =>
                                        p.workspace_id === finalWorkspaceId ||
                                        p.organization_id === finalWorkspaceId,
                                ) || projects[0]
                            projectId = project.project_id
                        }
                    } catch (e) {
                        console.error("Failed to fetch projects manually", e)
                    }
                }
            }

            if (finalWorkspaceId) {
                const {data} = await createApiKey(finalWorkspaceId, false, projectId)
                onApiKeyChange(data)
                message.success("Successfully generated API Key")
            } else {
                message.error("Could not determine workspace. Please try refreshing.")
            }
        } catch (error) {
            console.error("handleGenerateApiKey error:", error)
            message.error("Unable to generate API Key")
        } finally {
            setIsLoadingApiKey(false)
        }
    }

    return (
        <Space orientation="vertical" size={0}>
            <Typography.Text className="font-medium">Create or enter your API key</Typography.Text>
            <Space>
                <Input
                    className="w-[300px]"
                    placeholder="Enter existing API key"
                    value={apiKeyValue}
                    onChange={(e) => onApiKeyChange(e.target.value)}
                />

                <Button type="primary" loading={isLoadingApiKey} onClick={handleGenerateApiKey}>
                    Generate API Key
                </Button>
            </Space>
        </Space>
    )
}

export default ApiKeyInput
