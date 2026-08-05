import {useMemo, useState} from "react"

import {message} from "@agenta/ui/app-message"
import {Button, Input, Space, Typography} from "antd"

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

    const defaultWorkspaceId: string = useMemo(
        () => selectedOrg?.default_workspace.id || "",
        [selectedOrg],
    )

    const handleGenerateApiKey = async () => {
        try {
            setIsLoadingApiKey(true)

            let projectId = getProjectValues().projectId
            let finalWorkspaceId = defaultWorkspaceId

            try {
                const context = await waitForWorkspaceContext({
                    timeoutMs: 3000,
                    requireProjectId: true,
                    requireWorkspaceId: true,
                    requireOrgData: true,
                })

                if (context.projectId) {
                    projectId = context.projectId
                }

                if (context.workspaceId) {
                    finalWorkspaceId = context.workspaceId
                }
            } catch (e) {
                console.warn("waitForWorkspaceContext failed or timed out", e)
            }

            try {
                const projects = await fetchAllProjects()

                if (projectId) {
                    if (projects.length > 0) {
                        const project = projects.find((p) => p.project_id === projectId)
                        if (!project) {
                            message.error(
                                "Project context changed. Please refresh and try generating the API key again.",
                            )
                            return
                        }

                        finalWorkspaceId =
                            project.workspace_id || project.organization_id || finalWorkspaceId
                    }
                } else {
                    const scoped = finalWorkspaceId
                        ? projects.filter(
                              (project) =>
                                  project.workspace_id === finalWorkspaceId ||
                                  project.organization_id === finalWorkspaceId,
                          )
                        : projects

                    if (finalWorkspaceId && scoped.length === 0) {
                        message.error(
                            "No project found for the current workspace. Please refresh and try again.",
                        )
                        return
                    }

                    const preferredProject = scoped.find((project) => !project.is_demo) || scoped[0]

                    if (preferredProject) {
                        projectId = preferredProject.project_id
                        finalWorkspaceId =
                            preferredProject.workspace_id ||
                            preferredProject.organization_id ||
                            finalWorkspaceId
                    }
                }
            } catch (e) {
                console.error("Failed to fetch projects manually", e)
            }

            if (finalWorkspaceId && projectId) {
                const {data} = await createApiKey(finalWorkspaceId, false, projectId)
                onApiKeyChange(data)
                message.success("Successfully generated API Key")
            } else {
                message.error("Could not determine project/workspace. Please try refreshing.")
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
