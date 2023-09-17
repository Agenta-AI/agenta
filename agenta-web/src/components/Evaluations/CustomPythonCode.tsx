import React, {useState, useEffect} from "react"
import {useRouter} from "next/router"
import {Input, Form, Button, Row, Col, Typography, notification} from "antd"
import {CreateCustomEvaluationSuccessResponse} from "@/lib/Types"
import {saveCustomCodeEvaluation, fetchCustomEvaluationNames} from "@/lib/services/api"
import CodeBlock from "@/components/DynamicCodeBlock/CodeBlock"
import CopyButton from "../CopyButton/CopyButton"
import Editor from "@monaco-editor/react"

interface ICustomPythonProps {
    classes: any
    appName: string
    appTheme: string
}

interface ICustomEvalNames {
    id: string
    evaluation_name: string
}

const CustomPythonCode: React.FC<ICustomPythonProps> = ({classes, appName, appTheme}) => {
    const {Title} = Typography
    const [form] = Form.useForm()
    const router = useRouter()

    const [submitting, setSubmittingData] = useState(false)
    const [evalNames, setEvalNames] = useState<ICustomEvalNames[]>([])
    const [evalNameExist, setEvalNameExist] = useState<boolean>(false)

    let prevKey = ""
    const showNotification = (config: Parameters<typeof notification.open>[0]) => {
        if (prevKey) notification.destroy(prevKey)
        prevKey = (config.key || "") as string
        notification.open(config)
    }

    useEffect(() => {
        const evaluationNames = async () => {
            const response: any = await fetchCustomEvaluationNames(appName)
            if (response.status === 200) {
                setEvalNames(response.data)
            }
        }

        evaluationNames()
    }, [appName])

    const handlerToSubmitFormData = async (values: any) => {
        setSubmittingData(true)
        const data = {
            evaluation_name: values.evaluationName,
            python_code: values.pythonCode,
            app_name: appName,
        }
        const response = await saveCustomCodeEvaluation(data)
        if (response.status === 200) {
            const data: CreateCustomEvaluationSuccessResponse = response.data

            // Disable submitting form data
            setSubmittingData(false)
            showNotification({
                type: "success",
                message: "Custom Evaluation",
                description: data.message,
                key: data.evaluation_id,
            })

            // Reset form fields and redirect user to evaluations page
            form.resetFields()
            router.push(`/apps/${appName}/evaluations/`)
        }
    }

    const isSaveButtonDisabled = () => {
        return (
            evalNameExist ||
            !form.isFieldsTouched(true) ||
            form.getFieldsError().filter(({errors}) => errors.length).length > 0
        )
    }

    const pythonDefaultEvalCode = () => {
        return `from typing import Dict

def evaluate(
    app_params: Dict[str, str], 
    inputs: Dict[str, str], 
    output: str, 
    correct_answer: str
) -> float:
    # ...
    return 0.75  # Replace with your calculated score`
    }

    const switchEditorThemeBasedOnTheme = () => {
        if (appTheme == "light") {
            return "vs-light"
        } else if (appTheme == "dark") {
            return "vs-dark"
        }
    }

    const checkForEvaluationName = async () => {
        const evalName = form.getFieldValue("evaluationName")
        if (evalNames.map((e) => e.evaluation_name).includes(evalName)) {
            showNotification({
                type: "error",
                message: "Custom Evaluation",
                duration: 5,
                description: "Evaluation name already exist. ",
            })
            setEvalNameExist(true)
        } else {
            setEvalNameExist(false)
        }
    }

    return (
        <div className={classes.evaluationContainer}>
            <Title level={4} className={classes.customTitle}>
                Save Python Code Evaluation
            </Title>
            <Form form={form} onFinish={handlerToSubmitFormData}>
                <Row justify="start" gutter={24}>
                    <Col span={12}>
                        <Form.Item
                            label="Evaluation Name"
                            name="evaluationName"
                            rules={[{required: true, message: "Please enter evaluation name!"}]}
                        >
                            <Input
                                disabled={submitting}
                                onChange={checkForEvaluationName}
                                placeholder="Input name of evaluation"
                            />
                        </Form.Item>
                        <div className={classes.exampleContainer}>
                            <h4>
                                Example Evaluation Function:
                                <CopyButton
                                    text="Copy"
                                    type="primary"
                                    size="small"
                                    target={pythonDefaultEvalCode()}
                                    className={classes.copyBtn}
                                />
                            </h4>
                            <CodeBlock
                                key={"python" + appName}
                                language={"python"}
                                value={pythonDefaultEvalCode()}
                            />
                            <h4 className={classes.levelFourHeading}>
                                Evaluation Function Description:
                            </h4>
                            <span>
                                The code must accept:
                                <ul>
                                    <li>The app variant parameters</li>
                                    <li>A list of inputs</li>
                                    <li>An output</li>
                                    <li>A target or correct answer</li>
                                </ul>
                            </span>
                            <h4>
                                <b>NOTE:</b> The function name of your code evaluation must be
                                "evaluate".
                            </h4>
                        </div>
                    </Col>
                    <Col span={12}>
                        <Form.Item
                            name="pythonCode"
                            rules={[{required: true, message: "Please input python code!"}]}
                        >
                            <Editor
                                height="600px"
                                width="100%"
                                language="python"
                                theme={switchEditorThemeBasedOnTheme()}
                                value={form.getFieldValue("pythonCode")}
                                onChange={(code) => form.setFieldsValue({pythonCode: code})}
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
                                    className={classes.submitBtn}
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
