import {Button, Input, Space, Typography, message, notification} from "antd"
import {useEffect, useState} from "react"
import {IOpenAIKeySuccess, IOpenAIKeyError, IRetrieveOpenAIKeySuccess} from "@/lib/Types"
import {saveOpenAIKey, fetchOpenAIKey, removeOpenAIKey} from "@/lib/services/api"

export default function ApiKeys() {
    const {Title, Text} = Typography

    const [retrieveAIKey, setRetrieveAIKey] = useState("")
    const [openAIKey, setOpenAIKey] = useState<undefined | string>(undefined)
    const [savingKey, setSavingKey] = useState<boolean>(false)
    const [deletingKey, setDeletingKey] = useState<boolean>(false)

    useEffect(() => {
        const retrieveOpenAIKey = async () => {
            const response: IRetrieveOpenAIKeySuccess = await fetchOpenAIKey()
            if (response.data.status) {
                if (openAIKey === undefined) {
                    setOpenAIKey(response.data.data.api_key || "")
                    setRetrieveAIKey(response.data.data.api_key || "")
                }
            } else {
                notification.error({
                    message: "OpenAI API Key",
                    description: "Could not retrieve API Key. Please try again!",
                    duration: 5,
                })
            }
        }

        retrieveOpenAIKey()
    })

    const saveOpenAIKeyToDBHandler = async () => {
        setSavingKey(true)

        if (openAIKey === "" || openAIKey === undefined) {
            notification.error({
                message: "OpenAI API Key",
                description: "Could not save API Key. Please try again!",
                duration: 5,
            })
            setSavingKey(false)
        } else {
            const data = {
                api_key: openAIKey,
            }
            try {
                const response: IOpenAIKeySuccess = await saveOpenAIKey(data)
                if (response.data.status) {
                    notification.success({
                        message: "OpenAI API Key",
                        description: `${response.data.message}`,
                        duration: 5,
                    })
                    setSavingKey(false)
                }
            } catch (error: IOpenAIKeyError) {
                if (!error.response?.data?.status) {
                    notification.error({
                        message: "OpenAI API Key",
                        description: `${error.response?.data?.message}`,
                        duration: 5,
                    })
                    setSavingKey(false)
                } else {
                    notification.error({
                        message: "OpenAI API Key",
                        description: "Could not save API Key. Please try again!",
                        duration: 5,
                    })
                    setSavingKey(false)
                }
            }
        }
    }

    const removeOpenAIKeyHandler = async () => {
        setDeletingKey(true)

        if (openAIKey === "" || openAIKey === undefined) {
            notification.error({
                message: "OpenAI API Key",
                description: "Could not save API Key. Please try again!",
                duration: 5,
            })
            setDeletingKey(false)
        } else {
            try {
                const response: IOpenAIKeySuccess = await removeOpenAIKey()
                if (response.data.status) {
                    notification.success({
                        message: "OpenAI API Key",
                        description: `${response.data.message}`,
                        duration: 5,
                    })
                    setDeletingKey(false)
                }
            } catch (error: IOpenAIKeyError) {
                if (!error.response?.data?.status) {
                    notification.error({
                        message: "OpenAI API Key",
                        description: `${error.response?.data?.message}`,
                        duration: 5,
                    })
                    setDeletingKey(false)
                } else {
                    notification.error({
                        message: "OpenAI API Key",
                        description: "Could not remove API Key. Please try again!",
                        duration: 5,
                    })
                    setDeletingKey(false)
                }
            }
        }
    }

    return (
        <div>
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
                            value={openAIKey}
                            onChange={(e) => setOpenAIKey(e.target.value)}
                            addonBefore="OpenAI"
                            visibilityToggle={false}
                            style={{minWidth: 300}}
                            disabled={savingKey}
                        />
                        <Button
                            onClick={saveOpenAIKeyToDBHandler}
                            loading={savingKey}
                            disabled={retrieveAIKey === openAIKey}
                        >
                            Save
                        </Button>
                        <Button onClick={removeOpenAIKeyHandler} loading={deletingKey}>
                            Delete
                        </Button>
                    </Space>
                </div>
            </div>
        </div>
    )
}
