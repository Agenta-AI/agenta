import {UploadOutlined} from "@ant-design/icons"
import {Alert, Button, Form, Input, Space, Spin, Upload, message} from "antd"
import {useState} from "react"
import axios from "axios"
import {useRouter} from "next/router"

export default function AddANewTestset() {
    const router = useRouter()
    const {app_name} = router.query
    const [form] = Form.useForm()
    const [uploadLoading, setUploadLoading] = useState(false)

    const onFinish = async (values: any) => {
        const {file} = values

        if (!values.file) {
            message.error("Please select a file to upload")
            return
        }

        if (file && file.length > 0) {
            const formData = new FormData()
            formData.append("file", file[0].originFileObj)
            if (values.testsetName && values.testsetName.trim() !== "") {
                formData.append("testset_name", values.testsetName)
            }
            formData.append("app_name", app_name?.toString() || "")

            try {
                setUploadLoading(true)
                // TODO: move to api.ts
                const response = await axios.post(
                    `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/testsets/upload`,
                    formData,
                    {
                        headers: {
                            "Content-Type": "multipart/form-data",
                        },
                    },
                )

                if (response.status === 200) {
                    // File uploaded successfully
                    const data = response.data

                    // settestset(data);
                    setUploadLoading(false)
                    form.resetFields()

                    router.push(`/apps/${app_name}/testsets`)
                } else {
                    // Handle error
                    console.error("Failed to upload file:", response.status)
                    setUploadLoading(false) // Set loading state to false after failed upload
                }
            } catch (error) {
                console.error("Error uploading file", error)
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
            <Space direction="vertical" style={{width: "50%"}}>
                <Alert
                    message="File format"
                    description={
                        <>
                            The test set should be in CSV format with the following requirements:
                            <br />
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
                    }
                    type="info"
                    style={{marginTop: 20, marginBottom: 40}}
                />
            </Space>

            <Spin spinning={uploadLoading}>
                <Form onFinish={onFinish} form={form} style={{maxWidth: 600}} {...layout}>
                    <Form.Item name="testsetName" label="Test set name" rules={[{type: "string"}]}>
                        <Input maxLength={25} />
                    </Form.Item>
                    <Form.Item
                        name="file"
                        valuePropName="fileList"
                        getValueFromEvent={(e) => e.fileList}
                        label="Test set source"
                    >
                        <Upload.Dragger name="file" accept=".csv" multiple={false} maxCount={1}>
                            <p className="ant-upload-drag-icon">
                                <UploadOutlined />
                            </p>
                            <p className="ant-upload-text">
                                Click or drag a CSV file to this area to upload
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
