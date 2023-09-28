import {UploadOutlined} from "@ant-design/icons"
import {Alert, Button, Form, Input, Space, Spin, Upload, message} from "antd"
import {useState} from "react"
import axios from "@/lib/helpers/axiosConfig"
import {useRouter} from "next/router"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles({
    fileFormatBtn: {
        display: "flex",
        gap: "25px",
    },
    container: {
        width: "50%",
    },
    alert: {
        marginTop: 20,
        marginBottom: 40,
    },
    form: {
        maxWidth: 600,
    },
})

export default function AddANewTestset() {
    const classes = useStyles()
    const router = useRouter()
    const appId = router.query.app_id as string
    const [form] = Form.useForm()
    const [uploadLoading, setUploadLoading] = useState(false)
    const [uploadType, setUploadType] = useState<"JSON" | "CSV" | undefined>("CSV")

    const onFinish = async (values: any) => {
        const {file} = values

        if (!values.file) {
            message.error("Please select a file to upload")
            return
        }

        if (file && file.length > 0 && uploadType) {
            const formData = new FormData()
            formData.append("upload_type", uploadType)
            formData.append("file", file[0].originFileObj)
            if (values.testsetName && values.testsetName.trim() !== "") {
                formData.append("testset_name", values.testsetName)
            }
            formData.append("app_id", appId)

            try {
                setUploadLoading(true)
                // TODO: move to api.ts
                await axios.post(
                    `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/testsets/upload`,
                    formData,
                    {
                        headers: {
                            "Content-Type": "multipart/form-data",
                        },
                    },
                )
                form.resetFields()
                router.push(`/apps/${appId}/testsets`)
            } finally {
                setUploadLoading(false)
            }
        }
    }

    const layout = {
        labelCol: {span: 8},
        wrapperCol: {span: 16},
    }

    const tailLayout = {
        wrapperCol: {offset: 8, span: 16},
    }

    return (
        <div>
            <div className={classes.fileFormatBtn}>
                <Button
                    type={uploadType == "CSV" ? "primary" : "default"}
                    onClick={() => {
                        setUploadType("CSV")
                    }}
                >
                    csv
                </Button>
                <Button
                    type={uploadType == "JSON" ? "primary" : "default"}
                    onClick={() => {
                        setUploadType("JSON")
                    }}
                >
                    json
                </Button>
            </div>
            <Space direction="vertical" className={classes.container}>
                <Alert
                    message="File format"
                    description={
                        <>
                            The test set should be in {uploadType} format with the following
                            requirements:
                            <br />
                            {uploadType == "CSV" && (
                                <>
                                    1. Comma separated values
                                    <br />
                                    2. The first row should contain the headers
                                    <br />
                                    <br />
                                    Here is an example of a valid CSV file:
                                    <br />
                                    <br />
                                    recipe_name,correct_answer
                                    <br />
                                    Chicken Parmesan,Chicken
                                    <br />
                                    "a, special, recipe",Beef
                                    <br />
                                </>
                            )}
                            {uploadType == "JSON" && (
                                <>
                                    1. A json file with an array of rows
                                    <br />
                                    2. Each row in the array should be an object
                                    <br />
                                    of column header name as key and row data as value
                                    <br />
                                    <br />
                                    Here is an example of a valid JSON file:
                                    <br />
                                    <br />
                                    {`[{ "recipe_name": "Chicken Parmesan","correct_answer": "Chicken" },`}
                                    <br />
                                    {`{ "recipe_name": "a, special, recipe","correct_answer": "Beef" }]`}
                                </>
                            )}
                        </>
                    }
                    type="info"
                    className={classes.alert}
                />
            </Space>

            <Spin spinning={uploadLoading}>
                <Form onFinish={onFinish} form={form} className={classes.form} {...layout}>
                    <Form.Item name="testsetName" label="Test set name" rules={[{type: "string"}]}>
                        <Input maxLength={25} />
                    </Form.Item>
                    <Form.Item
                        name="file"
                        valuePropName="fileList"
                        getValueFromEvent={(e) => e.fileList}
                        label="Test set source"
                    >
                        <Upload.Dragger
                            name="file"
                            accept={uploadType == "CSV" ? ".csv" : ".json"}
                            multiple={false}
                            maxCount={1}
                        >
                            <p className="ant-upload-drag-icon">
                                <UploadOutlined />
                            </p>
                            <p className="ant-upload-text">
                                Click or drag a {uploadType} file to this area to upload
                            </p>
                        </Upload.Dragger>
                    </Form.Item>

                    <Form.Item {...tailLayout}>
                        <Button type="primary" htmlType="submit">
                            Add test set
                        </Button>
                    </Form.Item>
                </Form>
            </Spin>
        </div>
    )
}
