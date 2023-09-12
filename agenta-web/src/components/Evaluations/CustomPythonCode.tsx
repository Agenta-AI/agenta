import React, {useState} from "react"
import {Input, Form, Button, Row, Col, Typography, notification} from "antd"
import {StoreCustomEvaluationSuccessResponse} from "@/lib/Types"
import {saveCutomCodeEvaluation} from "@/lib/services/api"

interface ICustomPythonProps {
    classes: any
    appName: string
}

const CustomPythonCode: React.FC<ICustomPythonProps> = ({classes, appName}) => {
    const {TextArea} = Input
    const {Title} = Typography
    const [form] = Form.useForm()

    const [submitting, setSubmittingData] = useState(false)

    let prevKey = ""
    const showNotification = (config: Parameters<typeof notification.open>[0]) => {
        if (prevKey) notification.destroy(prevKey)
        prevKey = (config.key || "") as string
        notification.open(config)
    }

    const handlerToSubmitFormData = async (values: any) => {
        setSubmittingData(true)
        const data = {
            evaluation_name: values.evaluationName,
            python_code: values.pythonCode,
            app_name: appName,
        }
        const response = await saveCutomCodeEvaluation(data)
        if (response.status === 200) {
            const data: StoreCustomEvaluationSuccessResponse = response.data

            // Diable submitting form data
            setSubmittingData(false)
            showNotification({
                type: "success",
                message: "Custom Evaluation",
                description: data.message,
                key: data.evaluation_id,
            })

            // Reset form fields
            form.resetFields()
        }
    }

    const isSaveButtonDisabled = () => {
        return (
            !form.isFieldsTouched(true) ||
            form.getFieldsError().filter(({errors}) => errors.length).length > 0
        )
    }

    return (
        <div className={classes.evaluationContainer}>
            <Title level={4}>Save Python Code Evaluation</Title>
            <Form form={form} onFinish={handlerToSubmitFormData}>
                <Row justify="start" gutter={24}>
                    <Col span={12}>
                        <Form.Item
                            label="Evaluation Name"
                            name="evaluationName"
                            rules={[{required: true, message: "Please enter evaluation name!"}]}
                        >
                            <Input disabled={submitting} placeholder="Input name of evaluation" />
                        </Form.Item>
                    </Col>
                    <Col span={12}>
                        <Form.Item
                            name="pythonCode"
                            rules={[{required: true, message: "Please input python code!"}]}
                        >
                            <TextArea
                                disabled={submitting}
                                rows={18}
                                placeholder="Input python code"
                            />
                        </Form.Item>
                    </Col>
                    <Col span={14}>
                        <Form.Item shouldUpdate>
                            {() => (
                                <Button
                                    htmlType="submit"
                                    type="primary"
                                    loading={submitting}
                                    disabled={isSaveButtonDisabled() || submitting}
                                >
                                    Save
                                </Button>
                            )}
                        </Form.Item>
                    </Col>
                </Row>
            </Form>
        </div>
    )
}

export default CustomPythonCode
