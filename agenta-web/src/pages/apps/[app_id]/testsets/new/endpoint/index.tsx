import axios from "@/lib/helpers/axiosConfig"
import {getAgentaApiUrl} from "@/lib/helpers/utils"
import {Alert, Button, Form, Input, Spin, Typography, message} from "antd"
import {useRouter} from "next/router"
import {useState} from "react"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles({
    container: {
        display: "flex",
        flexDirection: "column",
        rowGap: 20,
        maxWidth: 800,
    },
    json: {
        overflow: "auto",
    },
    buttonContainer: {
        display: "flex",
        flexDirection: "row",
        justifyContent: "flex-end",
    },
})

type FieldType = {
    name: string
    endpoint: string
}

export default function ImportTestsetFromEndpoint() {
    const classes = useStyles()

    const router = useRouter()
    const appId = router.query.app_id as string

    const handleSubmit = async (values: FieldType) => {
        if (values.name.trim() === "" || values.endpoint.trim() === "") {
            message.error("Please fill out all fields")
            return
        }

        setUploadLoading(true)

        const formData = new FormData()
        formData.append("endpoint", values.endpoint)
        formData.append("testset_name", values.name)
        formData.append("app_id", appId)

        try {
            // TODO: move to api.ts
            await axios.post(`${getAgentaApiUrl()}/api/testsets/endpoint/`, formData, {
                headers: {"Content-Type": "multipart/form-data"},
            })
            router.push(`/apps/${appId}/testsets`)
        } catch (_) {
            // Errors will be handled by Axios interceptor
            // Do nothing here
        } finally {
            setUploadLoading(false)
        }
    }

    const [uploadLoading, setUploadLoading] = useState(false)

    return (
        <div className={classes.container}>
            <Typography.Title level={5}>Import a new Test Set from an endpoint</Typography.Title>

            <Alert
                message="Endpoint Test Set Format"
                description={
                    <>
                        Currently, we only support the JSON format which must meet the following
                        requirements:
                        <ol>
                            <li>A JSON with an array of rows</li>
                            <li>
                                Each row in the array should be an object of column header name as
                                key and row data as value
                            </li>
                        </ol>
                        Here is an example of a valid JSON file:
                        <pre className={classes.json}>
                            {JSON.stringify(
                                [
                                    {
                                        recipe_name: "Chicken Parmesan",
                                        correct_answer: "Chicken",
                                    },
                                    {recipe_name: "a, special, recipe", correct_answer: "Beef"},
                                ],
                                null,
                                2,
                            )}
                        </pre>
                    </>
                }
                type="info"
            />

            <Spin spinning={uploadLoading}>
                <Form onFinish={handleSubmit} layout="vertical">
                    <Form.Item<FieldType>
                        label="Test Set Name"
                        name="name"
                        rules={[{required: true, type: "string", whitespace: true}]}
                    >
                        <Input placeholder="Test Set Name" />
                    </Form.Item>

                    <Form.Item<FieldType>
                        label="Test Set Endpoint"
                        name="endpoint"
                        rules={[{required: true, type: "url"}]}
                    >
                        <Input placeholder="Endpoint URL" />
                    </Form.Item>

                    <div className={classes.buttonContainer}>
                        <Button htmlType="submit" type="primary">
                            Import Test Set
                        </Button>
                    </div>
                </Form>
            </Spin>
        </div>
    )
}
