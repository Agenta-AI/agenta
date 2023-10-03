import {getOpenAIKey, removeOpenAIKey, saveOpenAIKey} from "@/lib/helpers/utils"
import {Button, Input, Space, Typography, message} from "antd"
import {useState} from "react"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles({
    title: {
        marginBottom: "30px !important",
    },
    container: {
        marginLeft: 0,
    },
    apiContainer: {
        margin: "0px 0",
    },
    input: {
        minWidth: 300,
    },
})

export default function ApiKeys() {
    const {Title, Text} = Typography

    const classes = useStyles()

    const savedOpenAiKey = getOpenAIKey()

    const [openAiKey, setOpenAiKey] = useState(savedOpenAiKey)
    const [messageAPI, contextHolder] = message.useMessage()

    const saveDisabled = openAiKey === savedOpenAiKey

    return (
        <div data-cy="apikeys">
            {contextHolder}
            <Title level={3} className={classes.title}>
                API Keys
            </Title>

            <Text>
                Currently, the API keys are solely saved in your browser and are not sent to our
                servers!
            </Text>

            <div className={classes.container}>
                <Title level={4}>LLM providers</Title>

                <div className={classes.apiContainer}>
                    <Space direction="horizontal">
                        <Input.Password
                            data-cy="apikeys-input"
                            value={openAiKey}
                            onChange={(e) => setOpenAiKey(e.target.value)}
                            addonBefore="OpenAI"
                            visibilityToggle={false}
                            className={classes.input}
                        />
                        <Button
                            data-cy="apikeys-save-button"
                            disabled={saveDisabled}
                            onClick={() => {
                                saveOpenAIKey(openAiKey)
                                messageAPI.success("The key is saved")
                            }}
                        >
                            Save
                        </Button>
                        <Button
                            onClick={() => {
                                removeOpenAIKey()
                                setOpenAiKey("")
                                messageAPI.warning("The key is deleted")
                            }}
                        >
                            Delete
                        </Button>
                    </Space>
                </div>
            </div>
        </div>
    )
}
