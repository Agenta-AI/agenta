import {
    getLlmProviderKey,
    saveLlmProviderKey,
    removeSingleLlmProviderKey,
    getAllProviderLlmKeys,
    LlmProvider,
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

            <div className={classes.container}>
                <Title level={5}>Available Providers</Title>

                <div className={classes.apiContainer}>
                    {llmProviderKeys.map(({title, key}: LlmProvider, i: number) => (
                        <div key={i}>
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
                                    disabled={key === getLlmProviderKey(key) || !key}
                                    onClick={() => {
                                        saveLlmProviderKey(i, key)
                                        messageAPI.success("The secret is saved")
                                    }}
                                >
                                    Save
                                </Button>
                                <Button
                                    onClick={() => {
                                        removeSingleLlmProviderKey(i)

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
