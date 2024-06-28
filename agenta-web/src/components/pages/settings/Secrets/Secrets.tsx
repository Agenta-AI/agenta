import {
    getLlmProviderKey,
    saveLlmProviderKey,
    removeSingleLlmProviderKey,
    getAllProviderLlmKeys,
    LlmProvider,
    getApikeys,
} from "@/lib/helpers/llmProviders"
import {Button, Input, Space, Typography, message} from "antd"
import {useState} from "react"
import {createUseStyles} from "react-jss"

const {Title, Text} = Typography

const useStyles = createUseStyles({
    title: {
        marginTop: 0,
    },
    container: {
        margin: "0px 0",
    },
    apiContainer: {
        marginBottom: 10,
    },
    input: {
        display: "flex",
        alignItems: "center",
        width: 420,
    },
})

export default function Secrets() {
    const classes = useStyles()
    const [llmProviderKeys, setLlmProviderKeys] = useState(getAllProviderLlmKeys())
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

            <div>
                <Title level={5}>Available Providers</Title>

                <div className={classes.container}>
                    {llmProviderKeys.map(({title, key}: LlmProvider, i: number) => (
                        <div key={i} className={classes.apiContainer}>
                            <Space direction="horizontal" key={i}>
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
                                    className={classes.input}
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
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
