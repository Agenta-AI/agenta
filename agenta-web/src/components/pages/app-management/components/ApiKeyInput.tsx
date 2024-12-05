import React, {useEffect, useState} from "react"
import {Space, Input, Button, Typography, message} from "antd"
import {isDemo} from "@/lib/helpers/utils"
import {dynamicContext, dynamicService} from "@/lib/helpers/dynamic"

const apiKeysService: any = dynamicService("apiKeys/api")

const {Text} = Typography

interface ApiKeyInputProps {
    apiKeyValue: string
    onApiKeyChange: React.Dispatch<React.SetStateAction<string>>
}

const ApiKeyInput: React.FC<ApiKeyInputProps> = ({apiKeyValue, onApiKeyChange}) => {
    const [isLoadingApiKey, setIsLoadingApiKey] = useState(false)
    const [useOrgData, setUseOrgData] = useState<Function>(() => () => "")
    const {selectedOrg} = useOrgData()

    useEffect(() => {
        dynamicContext("org.context", {useOrgData}).then((context) => {
            setUseOrgData(() => context.useOrgData)
        })
    }, [])

    const workspaceId: string = selectedOrg?.default_workspace.id || ""

    const handleGenerateApiKey = async () => {
        try {
            setIsLoadingApiKey(true)
            await apiKeysService.then(async (module: any) => {
                if (!module) return
                if (workspaceId && isDemo()) {
                    const {data} = await module.createApiKey(workspaceId)
                    onApiKeyChange(data)
                    message.success("Successfully generated API Key")
                }
            })
        } catch (error) {
            console.error(error)
            message.error("Unable to generate API Key")
        } finally {
            setIsLoadingApiKey(false)
        }
    }

    return (
        <Space direction="vertical">
            <Text>Use any of your api keys or generate a new one</Text>
            <Space>
                <Input
                    className="w-[300px]"
                    placeholder="Paste your api key here"
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
