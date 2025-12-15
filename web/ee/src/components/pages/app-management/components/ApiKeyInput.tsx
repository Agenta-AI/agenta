import {useMemo, useState} from "react"

import {Button, Input, Space, Typography} from "antd"

import {message} from "@/oss/components/AppMessageContext"
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

    // Don't rely solely on useOrgData during onboarding as it might be stale
    // We will resolve it via waitForWorkspaceContext
    const initialWorkspaceId: string = useMemo(
        () => selectedOrg?.default_workspace.id || "",
        [selectedOrg],
    )

    const handleGenerateApiKey = async () => {
        try {
            setIsLoadingApiKey(true)

            let projectId = getProjectValues().projectId
            let finalWorkspaceId = initialWorkspaceId

            // Always wait for context during onboarding to ensure we have the correct workspace
            // The hook might return the default workspace which could be wrong if the user just created a new one
            if (!projectId || !finalWorkspaceId) {
                try {
                    const context = await waitForWorkspaceContext({
                        timeoutMs: 3000,
                        requireProjectId: true,
                        requireWorkspaceId: true,
                        requireOrgData: true,
                    })
                    projectId = context.projectId
                    // We temporarily set finalWorkspaceId from context, but we will verify it against the project below
                    finalWorkspaceId = context.workspaceId || ""
                } catch (e) {
                    console.warn("waitForWorkspaceContext failed or timed out", e)
                }
            }

            // Verify workspace ID by fetching project details
            // This fixes the issue where the URL workspace might differ from the project's actual workspace
            try {
                const projects = await fetchAllProjects()

                let project
                if (projectId) {
                    project = projects.find((p) => p.project_id === projectId)
                }

                if (!project && projects.length > 0) {
                    // Fallback: if project not found or not set, pick the first one
                    project = projects[0]
                    projectId = project.project_id
                }

                if (project) {
                    finalWorkspaceId = project.workspace_id
                }
            } catch (e) {
                console.error("Failed to fetch projects manually", e)
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
