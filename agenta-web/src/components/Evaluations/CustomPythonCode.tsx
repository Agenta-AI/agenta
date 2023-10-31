import React, {useState, useEffect} from "react"
import {useRouter} from "next/router"
import {Input, Form, Button, Row, Col, Typography, notification} from "antd"
import {CreateCustomEvaluationSuccessResponse} from "@/lib/Types"
import {
    saveCustomCodeEvaluation,
    fetchCustomEvaluationNames,
    editCustomEvaluationDetail,
} from "@/lib/services/api"
import Editor from "@monaco-editor/react"

interface ICustomPythonProps {
    classes: any
    appId: string
    appTheme: string
    editMode: boolean
    editCode?: string
    editName?: string
    editId?: string
}

interface ICustomEvalNames {
    id: string
    evaluation_name: string
}

const CustomPythonCode: React.FC<ICustomPythonProps> = ({
    classes,
    appId,
    appTheme,
    editMode,
    editCode = "",
    editName = "",
    editId = "",
}) => {
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
            const response: any = await fetchCustomEvaluationNames(appId)
            if (response.status === 200) {
                setEvalNames(response.data)
            }
        }

        evaluationNames()
    }, [appId])

    const handlerToSubmitFormData = async (values: any) => {
        setSubmittingData(true)
        const data = {
            evaluation_name: values.evaluationName, // TODO: Change to evaluation id!
            python_code: values.pythonCode,
            app_id: appId,
        }
        const response = editMode
            ? await editCustomEvaluationDetail(editId, data)
            : await saveCustomCodeEvaluation(data)
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
            router.push(`/apps/${appId}/evaluations/`)
        }
    }

    const isSaveButtonDisabled = () => {
        return (
            evalNameExist ||
            !form.isFieldsTouched(true) ||
            form.getFieldsError().filter(({errors}) => errors.length).length > 0
        )
    }

    const isEditButtonDisabled = () => {
        return evalNameExist
    }

    const pythonDefaultEvalCode = () => {
        if (editMode) {
            return editCode
        } else {
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
        if (evalName === editName) {
            return
        } else if (evalNames.map((e) => e.evaluation_name).includes(evalName)) {
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
                {editMode ? "Edit Python Code Evaluation" : "Save Python Code Evaluation"}
            </Title>
            <Form
                form={form}
                onFinish={handlerToSubmitFormData}
                initialValues={{
                    evaluationName: editName,
                    pythonCode: pythonDefaultEvalCode(),
                }}
            >
                <Row justify="start" gutter={24}>
                    <Col span={8}>
                        <Form.Item
                            label="Evaluation Name"
                            name="evaluationName"
                            rules={[{required: true, message: "Please enter evaluation name!"}]}
                        >
                            <Input
                                disabled={submitting}
                                onChange={checkForEvaluationName}
                                placeholder="Input name of evaluation"
                                data-cy="code-evaluation-input"
                            />
                        </Form.Item>
                        <div className={classes.exampleContainer}>
                            <h4 className={classes.levelFourHeading}>
                                Writing the custom evaluation code:
                            </h4>
                            <span>
                                The function name of your code evaluation must be "evaluate". and
                                must accept the following parameters:
                                <ul>
                                    <li>
                                        The variant parameters (prompt, etc..) as a Dict[str,str]
                                    </li>
                                    <li>A list of inputs as List[str]</li>
                                    <li>The output of the LLM app as a string</li>
                                    <li>A target or correct answer as a string</li>
                                </ul>
                                And return a float value indicating the score of the evaluation.
                            </span>
                        </div>
                    </Col>
                    <Col span={16}>
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
                                    data-cy="code-evaluation-save-button"
                                    htmlType="submit"
                                    type="primary"
                                    loading={submitting}
                                    className={classes.submitBtn}
                                    disabled={
                                        (editMode
                                            ? isEditButtonDisabled()
                                            : isSaveButtonDisabled()) || submitting
                                    }
                                >
                                    {editMode ? "Save Changes" : "Save"}
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
