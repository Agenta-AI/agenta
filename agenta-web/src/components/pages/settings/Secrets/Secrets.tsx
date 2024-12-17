import {useVaultSecret} from "@/hooks/useVaultSecret"
import {getLlmProviderKey, type LlmProvider} from "@/lib/helpers/llmProviders"
import {isDemo} from "@/lib/helpers/utils"
import {Button, Input, Space, Typography, message} from "antd"
import {useEffect, useState} from "react"

const {Title, Text} = Typography

export default function Secrets() {
    const {secrets, handleModifyVaultSecret, handleDeleteVaultSecret} = useVaultSecret()
    const [llmProviderKeys, setLlmProviderKeys] = useState<LlmProvider[]>([])
    const [messageAPI, contextHolder] = message.useMessage()

    useEffect(() => {
        setLlmProviderKeys(secrets)
    }, [secrets])

    return (
        <div data-cy="secrets">
            {contextHolder}
            <Title level={3} className={"mt-0"}>
                LLM Keys
            </Title>

            <Text>
                Currently, the secrets are solely saved in your browser and are not sent to our
                servers!
            </Text>

            <div>
                <Title level={5}>Available Providers</Title>

                <div>
                    {llmProviderKeys.map(
                        ({name, title, key, id: secretId}: LlmProvider, i: number) => (
                            <Space direction="horizontal" key={i} className="mb-2 ml-2">
                                <Input.Password
                                    data-cy="openai-api-input"
                                    value={key}
                                    onChange={(e) => {
                                        const newLlmProviderKeys = [...llmProviderKeys]
                                        newLlmProviderKeys[i].key = e.target.value
                                        setLlmProviderKeys(newLlmProviderKeys)
                                    }}
                                    addonBefore={`${title}`}
                                    visibilityToggle={false}
                                    className={"w-[420px]"}
                                />
                                <Button
                                    data-cy="openai-api-save"
                                    type="primary"
                                    disabled={key === getLlmProviderKey(title) || !key}
                                    onClick={async () => {
                                        await handleModifyVaultSecret({
                                            name,
                                            title,
                                            key,
                                            id: secretId,
                                        })

                                        messageAPI.success("The secret is saved")
                                    }}
                                >
                                    Save
                                </Button>
                                <Button
                                    disabled={!Boolean(key)}
                                    onClick={async () => {
                                        await handleDeleteVaultSecret({
                                            name,
                                            id: secretId,
                                            title,
                                            key,
                                        })

                                        const newLlmProviderKeys = [...llmProviderKeys]
                                        newLlmProviderKeys[i].key = ""
                                        setLlmProviderKeys(newLlmProviderKeys)

                                        messageAPI.warning("The secret is deleted")
                                    }}
                                >
                                    Delete
                                </Button>
                            </Space>
                        ),
                    )}
                </div>
            </div>
        </div>
    )
}
