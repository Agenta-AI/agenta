import {useMemo, useState} from "react"

import {Button, Input, Space, Typography, message} from "antd"

import {isDemo} from "@/oss/lib/helpers/utils"
import {createApiKey} from "@/oss/services/apiKeys/api"
import {fetchAllProjects} from "@/oss/services/project"
import {useOrgData} from "@/oss/state/org"
import {getProjectValues} from "@/oss/state/project"
import {waitForWorkspaceContext} from "@/oss/state/url/postLoginRedirect"

const {Text} = Typography

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

    console.log("ApiKeyInput rendered. WorkspaceId:", workspaceId)

    // Verify component mount
    useState(() => {
        console.log("ApiKeyInput mounted")
    })

    const handleGenerateApiKey = async () => {
        try {
            console.log("handleGenerateApiKey started")
            setIsLoadingApiKey(true)

            let projectId = getProjectValues().projectId
            let finalWorkspaceId = workspaceId
            console.log("Initial projectId:", projectId)
            console.log("Initial workspaceId:", finalWorkspaceId)

            if (!projectId || !finalWorkspaceId) {
                console.log("Waiting for workspace context...")
                try {
                    const context = await waitForWorkspaceContext({
                        timeoutMs: 3000,
                        requireProjectId: true,
                        requireWorkspaceId: true,
                        requireOrgData: true,
                    })
                    projectId = context.projectId
                    finalWorkspaceId = context.workspaceId || ""
                    console.log("Resolved context:", context)
                } catch (e) {
                    console.warn("waitForWorkspaceContext failed or timed out", e)
                }

                if (!projectId && finalWorkspaceId) {
                    console.log("Fetching projects manually...")
                    try {
                        const projects = await fetchAllProjects()
                        if (projects.length > 0) {
                            // Find a project that belongs to this workspace
                            const project = projects.find(p => p.workspace_id === finalWorkspaceId || p.organization_id === finalWorkspaceId) || projects[0]
                            projectId = project.project_id
                            console.log("Manually fetched project:", projectId)
                        }
                    } catch (e) {
                        console.error("Failed to fetch projects manually", e)
                    }
                }
            }

            console.log("Final WorkspaceId:", finalWorkspaceId)
            console.log("isDemo:", isDemo())

            if (finalWorkspaceId) {
                console.log("Calling createApiKey...")
                const {data} = await createApiKey(finalWorkspaceId, false, projectId)
                console.log("createApiKey success:", data)
                onApiKeyChange(data)
                message.success("Successfully generated API Key")
            } else {
                console.warn("Skipping createApiKey: workspaceId missing")
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
        <Space direction="vertical">
            <Text>Create or enter your API key</Text>
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
