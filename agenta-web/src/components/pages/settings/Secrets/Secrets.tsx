import {
    getLlmProviderKey,
    saveLlmProviderKey,
    removeSingleLlmProviderKey,
    getAllProviderLlmKeys,
    LlmProvider,
} from "@/lib/helpers/llmProviders"
import {Button, Input, Space, Typography, message} from "antd"
import {useState} from "react"

const {Title, Text} = Typography

export default function Secrets() {
    const [llmProviderKeys, setLlmProviderKeys] = useState(getAllProviderLlmKeys())
    const [messageAPI, contextHolder] = message.useMessage()

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
                    {llmProviderKeys.map(({title, key}: LlmProvider, i: number) => (
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
                                onClick={() => {
                                    saveLlmProviderKey(title, key)
                                    messageAPI.success("The secret is saved")
                                }}
                            >
                                Save
                            </Button>
                            <Button
                                disabled={!Boolean(key)}
                                onClick={() => {
                                    removeSingleLlmProviderKey(title)

                                    const newLlmProviderKeys = [...llmProviderKeys]
                                    newLlmProviderKeys[i].key = ""
                                    setLlmProviderKeys(newLlmProviderKeys)

                                    messageAPI.warning("The secret is deleted")
                                }}
                            >
                                Delete
                            </Button>
                        </Space>
                    ))}
                </div>
            </div>
        </div>
    )
}
