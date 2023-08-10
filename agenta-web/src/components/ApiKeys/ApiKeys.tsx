import {getOpenAIKey, removeOpenAIKey, saveOpenAIKey} from "@/lib/helpers/utils"
import {Button, Input, Space, Typography, message} from "antd"
import {useState} from "react"

export default function ApiKeys() {
    const {Title, Text} = Typography

    const savedOpenAiKey = getOpenAIKey()

    const [openAiKey, setOpenAiKey] = useState(savedOpenAiKey)
    const [messageAPI, contextHolder] = message.useMessage()

    const saveDisabled = openAiKey === savedOpenAiKey

    return (
        <div>
            {contextHolder}
            <Title level={3} style={{marginBottom: 30}}>
                API tokens
            </Title>

            <Text>
                Here is where you can put your API tokens to integrate with your own applications as
                well as provide your API credentials to LLM providers such as openAI.
            </Text>

            <div style={{marginLeft: 20}}>
                <Title level={4}>LLM providers</Title>

                <Text>
                    Agenta uses API keys from LLM providers to make API calls on your behalf. To get
                    started, you’ll need to crate account with supported provider and obtain the API
                    key. Once entered here, they’ll be securely encrypted and stored, but can be
                    removed any time.
                </Text>

                <div style={{margin: "20px 0"}}>
                    <Space direction="horizontal">
                        <Input.Password
                            value={openAiKey}
                            onChange={(e) => setOpenAiKey(e.target.value)}
                            addonBefore="OpenAI"
                            visibilityToggle={false}
                            style={{minWidth: 300}}
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
