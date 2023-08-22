import {getOpenAIKey, removeOpenAIKey, saveOpenAIKey} from "@/lib/helpers/utils"
import {Button, Input, Space, Typography, message} from "antd"
import {useState} from "react"
import { createUseStyles } from "react-jss"

const useStyles = createUseStyles({
    title:{
        marginBottom: "30px !important"
    },
    container:{
        marginLeft: 20,
    },
    apiContainer:{
        margin: "20px 0"
    },
    input:{
        minWidth: 300
    }
})

export default function ApiKeys() {
    const {Title, Text} = Typography

    const classes = useStyles()

    const savedOpenAiKey = getOpenAIKey()

    const [openAiKey, setOpenAiKey] = useState(savedOpenAiKey)
    const [messageAPI, contextHolder] = message.useMessage()

    const saveDisabled = openAiKey === savedOpenAiKey

    return (
        <div>
            {contextHolder}
            <Title level={3} className={classes.title}>
                API tokens
            </Title>

            <Text>
                Here is where you can put your API tokens to integrate with your own applications as
                well as provide your API credentials to LLM providers such as openAI.
            </Text>

            <div className={classes.container}>
                <Title level={4}>LLM providers</Title>

                <Text>
                    Agenta uses API keys from LLM providers to make API calls on your behalf. To get
                    started, you’ll need to crate account with supported provider and obtain the API
                    key. Once entered here, they’ll be securely encrypted and stored, but can be
                    removed any time.
                </Text>

                <div className={classes.apiContainer}>
                    <Space direction="horizontal">
                        <Input.Password
                            value={openAiKey}
                            onChange={(e) => setOpenAiKey(e.target.value)}
                            addonBefore="OpenAI"
                            visibilityToggle={false}
                            className={classes.input}
                        />
                        <Button
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
