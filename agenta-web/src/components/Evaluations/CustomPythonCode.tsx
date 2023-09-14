import React, {useState} from "react"
import {useRouter} from "next/router"
import {Input, Form, Button, Row, Col, Typography, notification} from "antd"
import {StoreCustomEvaluationSuccessResponse} from "@/lib/Types"
import {saveCustomCodeEvaluation} from "@/lib/services/api"
import CodeBlock from "@/components/DynamicCodeBlock/CodeBlock"
import CopyButton from "../CopyButton/CopyButton"
import AceEditor from "react-ace"
import "ace-builds/src-noconflict/mode-python"
import "ace-builds/src-noconflict/theme-github"
import "ace-builds/src-noconflict/theme-monokai"

interface ICustomPythonProps {
    classes: any
    appName: string
    appTheme: string
}

const CustomPythonCode: React.FC<ICustomPythonProps> = ({classes, appName, appTheme}) => {
    const {Title} = Typography
    const [form] = Form.useForm()
    const router = useRouter()

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
        const response = await saveCustomCodeEvaluation(data)
        if (response.status === 200) {
            const data: StoreCustomEvaluationSuccessResponse = response.data

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
            return "github"
        } else if (appTheme == "dark") {
            return "monokai"
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
                            <Input disabled={submitting} placeholder="Input name of evaluation" />
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
                        </div>
                    </Col>
                    <Col span={12}>
                        <Form.Item
                            name="pythonCode"
                            rules={[{required: true, message: "Please input python code!"}]}
                        >
                            <AceEditor
                                mode="python"
                                theme={switchEditorThemeBasedOnTheme()}
                                name="pythonCodeEditor"
                                editorProps={{$blockScrolling: true}}
                                width="100%"
                                height="600px"
                                fontSize={16}
                                showPrintMargin={false}
                                value={form.getFieldValue("pythonCode")}
                                onChange={(code) => form.setFieldsValue({pythonCode: code})}
                                placeholder="Start coding..."
                                setOptions={{
                                    enableBasicAutocompletion: true,
                                    enableLiveAutocompletion: false,
                                    enableSnippets: false,
                                    showLineNumbers: true,
                                    tabSize: 2,
                                }}
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
