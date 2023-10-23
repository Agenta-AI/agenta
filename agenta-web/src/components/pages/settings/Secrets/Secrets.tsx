import {
    getLlmProviderKeys,
    saveLlmProviderKey,
    llmAvailableProviders,
    removeSingleLlmProviderKey,
    getSingleLlmProviderKey,
} from "@/lib/helpers/utils"
import {Button, Input, Space, Typography, message} from "antd"
import {useState} from "react"
import {createUseStyles} from "react-jss"

const {Title, Text} = Typography

const useStyles = createUseStyles({
    title: {
        marginTop: 0,
    },
    container: {
        marginLeft: 0,
    },
    apiContainer: {
        margin: "0px 0",
    },
    input: {
        display: "flex",
        alignItems: "center",
        width: 420,
        marginBottom: 8,
        marginLeft: 8,
    },
})

export default function Secrets() {
    const classes = useStyles()
    const [llmProviderKeys, setLlmProviderKeys] = useState(getLlmProviderKeys())
    const [messageAPI, contextHolder] = message.useMessage()

    return (
        <div data-cy="secrets">
            {contextHolder}
            <Title level={3} className={classes.title}>
                LLM Keys
            </Title>

            <Text>
                Currently, the secrets are solely saved in your browser and are not sent to our
                servers!
            </Text>

            <div className={classes.container}>
                <Title level={5}>Providers API Key</Title>

                <div className={classes.apiContainer}>
                    {llmAvailableProviders.map((provider, i) => (
                        <Space direction="horizontal" key={`space-${i}`}>
                            <Input.Password
                                data-cy="openai-api-input"
                                value={llmProviderKeys[provider]}
                                onChange={(e) => {
                                    const newLlmProviderKeys = {...llmProviderKeys}
                                    newLlmProviderKeys[provider] = e.target.value
                                    setLlmProviderKeys(newLlmProviderKeys)
                                }}
                                addonBefore={`${provider}`}
                                visibilityToggle={false}
                                className={classes.input}
                            />
                            <Button
                                data-cy="openai-api-save"
                                disabled={
                                    llmProviderKeys[provider] ===
                                        getSingleLlmProviderKey(provider) ||
                                    !llmProviderKeys[provider]
                                }
                                onClick={() => {
                                    saveLlmProviderKey(provider, llmProviderKeys[provider])
                                    messageAPI.success("The secret is saved")
                                }}
                            >
                                Save
                            </Button>
                            <Button
                                onClick={() => {
                                    removeSingleLlmProviderKey(provider)

                                    const newLlmProviderKeys = {...llmProviderKeys}
                                    newLlmProviderKeys[provider] = ""
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
