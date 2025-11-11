import {useMemo, useState} from "react"

import {Button, Input, Space, Typography, message} from "antd"

import {isDemo} from "@/oss/lib/helpers/utils"
import {createApiKey} from "@/oss/services/apiKeys/api"
import {useOrganizationData} from "@/oss/state/organization"

const {Text} = Typography

interface ApiKeyInputProps {
    apiKeyValue: string
    onApiKeyChange: React.Dispatch<React.SetStateAction<string>>
}

const ApiKeyInput: React.FC<ApiKeyInputProps> = ({apiKeyValue, onApiKeyChange}) => {
    const [isLoadingApiKey, setIsLoadingApiKey] = useState(false)
    const {selectedOrganization} = useOrganizationData()

    const workspaceId: string = useMemo(
        () => selectedOrganization?.default_workspace.id || "",
        [selectedOrganization],
    )

    const handleGenerateApiKey = async () => {
        try {
            setIsLoadingApiKey(true)

            if (workspaceId && isDemo()) {
                const {data} = await createApiKey(workspaceId)
                onApiKeyChange(data)
                message.success("Successfully generated API Key")
            }
        } catch (error) {
            console.error(error)
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
