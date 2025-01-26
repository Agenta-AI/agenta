import {useVaultSecret} from "@/hooks/useVaultSecret"
import {type LlmProvider} from "@/lib/helpers/llmProviders"
import {Button, Input, Space, Typography, message} from "antd"
import {useEffect, useState} from "react"

const {Title, Text} = Typography

export default function Secrets() {
    const {secrets, handleModifyVaultSecret, handleDeleteVaultSecret} = useVaultSecret()
    const [llmProviderKeys, setLlmProviderKeys] = useState<LlmProvider[]>([])
    const [loadingSecrets, setLoadingSecrets] = useState<Record<string, boolean>>({})
    const [messageAPI, contextHolder] = message.useMessage()

    useEffect(() => {
        setLlmProviderKeys(secrets)
    }, [secrets])

    const setSecretLoading = (id: string | undefined, isLoading: boolean) => {
        if (!id) return
        setLoadingSecrets((prev) => ({...prev, [id]: isLoading}))
    }

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
                                    disabled={!key}
                                    loading={loadingSecrets[secretId || ""] === true}
                                    onClick={async () => {
                                        try {
                                            setSecretLoading(secretId, true)
                                            await handleModifyVaultSecret({
                                                name,
                                                title,
                                                key,
                                                id: secretId,
                                            })
                                            messageAPI.success("The secret is saved")
                                        } finally {
                                            setSecretLoading(secretId, false)
                                        }
                                    }}
                                >
                                    Save
                                </Button>
                                <Button
                                    disabled={!Boolean(key)}
                                    loading={loadingSecrets[secretId || ""] === true}
                                    onClick={async () => {
                                        try {
                                            setSecretLoading(secretId, true)
                                            await handleDeleteVaultSecret({
                                                name,
                                                id: secretId,
                                                title,
                                                key,
                                            })
                                            const newLlmProviderKeys = [...llmProviderKeys]
                                            newLlmProviderKeys[i].key = ""
                                            newLlmProviderKeys[i].id = ""
                                            setLlmProviderKeys(newLlmProviderKeys)
                                            messageAPI.warning("The secret is deleted")
                                        } finally {
                                            setSecretLoading(secretId, false)
                                        }
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
