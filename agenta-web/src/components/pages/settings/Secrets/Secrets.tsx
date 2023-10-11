import {getOpenAIKey, removeOpenAIKey, saveOpenAIKey} from "@/lib/helpers/utils"
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
        minWidth: 400,
    },
})

export default function Secrets() {
    const classes = useStyles()
    const savedOpenAiKey = getOpenAIKey()
    const [openAiKey, setOpenAiKey] = useState(savedOpenAiKey)
    const [messageAPI, contextHolder] = message.useMessage()

    const saveDisabled = openAiKey === savedOpenAiKey

    return (
        <div data-cy="secrets">
            {contextHolder}
            <Title level={3} className={classes.title}>
                Secrets
            </Title>

            <Text>
                Currently, the secrets are solely saved in your browser and are not sent to our
                servers!
            </Text>

            <div className={classes.container}>
                <Title level={5}>LLM providers</Title>

                <div className={classes.apiContainer}>
                    <Space direction="horizontal">
                        <Input.Password
                            data-cy="openai-api-input"
                            value={openAiKey}
                            onChange={(e) => setOpenAiKey(e.target.value)}
                            addonBefore="OpenAI API Key"
                            visibilityToggle={false}
                            className={classes.input}
                        />
                        <Button
                            data-cy="openai-api-save"
                            disabled={saveDisabled}
                            onClick={() => {
                                saveOpenAIKey(openAiKey)
                                messageAPI.success("The secret is saved")
                            }}
                        >
                            Save
                        </Button>
                        <Button
                            onClick={() => {
                                removeOpenAIKey()
                                setOpenAiKey("")
                                messageAPI.warning("The secret is deleted")
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
