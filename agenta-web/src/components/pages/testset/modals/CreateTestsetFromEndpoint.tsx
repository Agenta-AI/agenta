import React, {useState} from "react"
import {JSSTheme} from "@/lib/Types"
import {ArrowLeft} from "@phosphor-icons/react"
import {Button, Collapse, Form, Input, message, Typography} from "antd"
import {createUseStyles} from "react-jss"
import {useRouter} from "next/router"
import {importTestsetsViaEndpoint, useLoadTestsetsList} from "@/services/testsets/api"

const {Text} = Typography

const useStyles = createUseStyles((theme: JSSTheme) => ({
    headerText: {
        lineHeight: theme.lineHeightLG,
        fontSize: theme.fontSizeHeading4,
        fontWeight: theme.fontWeightStrong,
    },
    label: {
        fontWeight: theme.fontWeightMedium,
    },
}))

type FieldType = {
    name: string
    endpoint: string
}

type Props = {
    setCurrent: React.Dispatch<React.SetStateAction<number>>
    onCancel: () => void
}

const CreateTestsetFromEndpoint: React.FC<Props> = ({setCurrent, onCancel}) => {
    const classes = useStyles()
    const router = useRouter()
    const [form] = Form.useForm()
    const testsetName = Form.useWatch("name", form)
    const testsetEndpoint = Form.useWatch("endpoint", form)
    const appId = router.query.app_id as string
    const [uploadLoading, setUploadLoading] = useState(false)
    const {mutate} = useLoadTestsetsList(appId)

    const onFinish = async (values: FieldType) => {
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
            await importTestsetsViaEndpoint(formData)
            mutate()
            onCancel()
        } catch (_) {
            // Errors will be handled by Axios interceptor
            // Do nothing here
        } finally {
            setUploadLoading(false)
        }
    }

    return (
        <section className="grid gap-4">
            <div className="flex items-center gap-2">
                <Button
                    icon={<ArrowLeft size={14} className="mt-0.5" />}
                    className="flex items-center justify-center"
                    onClick={() => setCurrent(0)}
                />

                <Text className={classes.headerText}>Import from endpoint</Text>
            </div>

            <div className="flex flex-col gap-6">
                <Text>Currently, we only support the JSON format</Text>

                <Form onFinish={onFinish} form={form} className="flex flex-col gap-6">
                    <div className="grid gap-1">
                        <Text className={classes.label}>Test Set Name</Text>
                        <Form.Item<FieldType>
                            name="name"
                            rules={[{required: true, type: "string", whitespace: true}]}
                            className="mb-0"
                        >
                            <Input placeholder="Test Set Name" />
                        </Form.Item>
                    </div>

                    <div className="grid gap-1">
                        <Text className={classes.label}>Test Set Endpoint</Text>
                        <Form.Item<FieldType>
                            name="endpoint"
                            rules={[{required: true, type: "url"}]}
                            className="mb-0"
                        >
                            <Input placeholder="Endpoint URL" />
                        </Form.Item>
                    </div>
                </Form>

                <div>
                    <Collapse
                        defaultActiveKey={["1"]}
                        expandIconPosition="end"
                        items={[
                            {
                                key: "1",
                                label: "Instructions",
                                children: (
                                    <div className="flex flex-col items-start gap-4">
                                        <Text>
                                            Currently, we only support the JSON format which must
                                            meet the following requirements:
                                        </Text>
                                        <div className="flex flex-col">
                                            <Text>1. A JSON with an array of rows</Text>
                                            <Text>
                                                2. Each row in the array should be an object of
                                                column header name as key and row data as value
                                            </Text>
                                        </div>
                                        <pre>
                                            {JSON.stringify(
                                                [
                                                    {
                                                        recipe_name: "Chicken Parmesan",
                                                        correct_answer: "Chicken",
                                                    },
                                                    {
                                                        recipe_name: "a, special, recipe",
                                                        correct_answer: "Beef",
                                                    },
                                                ],
                                                null,
                                                2,
                                            )}
                                        </pre>
                                        <Typography.Link
                                            href="https://docs.agenta.ai/evaluation/create-test-sets"
                                            target="_blank"
                                        >
                                            <Button>Read the docs</Button>
                                        </Typography.Link>
                                    </div>
                                ),
                            },
                        ]}
                    />
                </div>
            </div>

            <div className="flex justify-end gap-2 mt-3">
                <Button disabled={uploadLoading} onClick={onCancel}>
                    Cancel
                </Button>
                <Button
                    disabled={!testsetName && !testsetEndpoint}
                    loading={uploadLoading}
                    type="primary"
                    onClick={() => form.submit()}
                >
                    Create test set
                </Button>
            </div>
        </section>
    )
}

export default CreateTestsetFromEndpoint
