import {useAppId} from "@/hooks/useAppId"
import {JSSTheme} from "@/lib/Types"
import {EvaluationType} from "@/lib/enums"
import {Button, Form, Input, Select, Space, Typography} from "antd"
import React, {useState} from "react"
import {createUseStyles} from "react-jss"
import {v4 as uuidv4} from "uuid"
import NewAnnotationConfigModal from "./NewAnnotationConfigModal"
import {PlusOutlined, UserAddOutlined} from "@ant-design/icons"
import {useRouter} from "next/router"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    form: {
        padding: "10px 20px",
    },
    formInputs: {
        maxWidth: 500,
    },
    annotationQuestions: {
        border: `1px solid ${theme.colorBorder}`,
        width: "100%",
        maxWidth: 700,
        padding: 20,
        borderRadius: theme.borderRadius,
        "& span > span": {
            fontWeight: "bold",
        },
        margin: "10px 0",
    },
    btnGroup: {
        gap: "1rem",
        marginTop: "1.5rem",
    },
    actionBtn: {
        width: 150,
    },
}))

const NewAnnotationConfiguration = () => {
    const classes = useStyles()
    const appId = useAppId()
    const [form] = Form.useForm()
    const router = useRouter()
    const [isNewAnnotationQuestionModalOpen, setIsNewAnnotationQuestionModalOpen] = useState(false)
    const [annotations, setAnnotations] = useState<
        {name: string; id: string; type: EvaluationType}[]
    >([
        {name: "Single Evaluation", id: uuidv4(), type: EvaluationType.single_model_test},
        {name: "A/B Testing", id: uuidv4(), type: EvaluationType.human_a_b_testing},
    ])
    const [annotationQuestions, setAnnotationQuestions] = useState<
        {
            name: string
            question_type: string
            question: string
            rating: number
        }[]
    >([
        {
            question: "Rate the quality of the response",
            question_type: "score",
            name: "score",
            rating: 4,
        },
    ])

    const onSubmit = (values: any) => {
        router.push(`/apps/${appId}/annotations?tab=configuration`)
    }

    return (
        <>
            <div>
                <Typography.Title level={3}>New Annotation Configuration</Typography.Title>

                <Form
                    requiredMark={false}
                    form={form}
                    name="new-evaluation"
                    onFinish={onSubmit}
                    layout="vertical"
                    className={classes.form}
                >
                    <Form.Item
                        label="1. Configuration name"
                        rules={[{required: true, message: "This field is required"}]}
                        name="configuration_name"
                    >
                        <Input
                            placeholder="Enter Configuration name"
                            className={classes.formInputs}
                        />
                    </Form.Item>

                    <Form.Item
                        name="evaluation_type"
                        label="2. Annotation type"
                        rules={[{required: true, message: "This field is required"}]}
                    >
                        <Select
                            placeholder="Select Annotation"
                            data-cy="select-annotation-group"
                            className={classes.formInputs}
                        >
                            {annotations.map((annotation) => (
                                <Select.Option
                                    key={annotation.id}
                                    value={annotation.type}
                                    data-cy="select-annotation-option"
                                >
                                    {annotation.name}
                                </Select.Option>
                            ))}
                        </Select>
                    </Form.Item>

                    <Form.Item label="3. Guidelines (Optional)" name="annotation_guidelines">
                        <Input.TextArea
                            autoSize={{minRows: 5, maxRows: 5}}
                            style={{maxWidth: 700}}
                        />
                    </Form.Item>

                    <Form.Item
                        name={"annotation_questions"}
                        label="4. Questions"
                        data-cy="annotation_questions"
                    >
                        <div style={{display: "flex", flexDirection: "column"}}>
                            {annotationQuestions.map((questions, index) => {
                                return (
                                    <Space
                                        key={index}
                                        className={classes.annotationQuestions}
                                        direction="vertical"
                                    >
                                        <Typography.Text>
                                            <span>Question Type:</span> {questions.question_type}
                                        </Typography.Text>

                                        <Typography.Text>
                                            <span>Question:</span> {questions.question}
                                        </Typography.Text>

                                        <Typography.Text>
                                            <span>Name:</span> {questions.name}
                                        </Typography.Text>

                                        <Typography.Text>
                                            <span>Rating:</span> {questions.rating}
                                        </Typography.Text>
                                    </Space>
                                )
                            })}
                        </div>

                        <Button
                            type="dashed"
                            onClick={() => setIsNewAnnotationQuestionModalOpen(true)}
                        >
                            Add Question
                        </Button>
                    </Form.Item>

                    <Form.Item>
                        <Space className={classes.btnGroup}>
                            <Button
                                icon={<UserAddOutlined />}
                                size="large"
                                className={classes.actionBtn}
                            >
                                Invite
                            </Button>
                            <Button
                                type="primary"
                                icon={<PlusOutlined />}
                                size="large"
                                className={classes.actionBtn}
                                onClick={() => form.submit()}
                            >
                                Create
                            </Button>
                        </Space>
                    </Form.Item>
                </Form>
            </div>

            <NewAnnotationConfigModal
                setAnnotationQuestions={setAnnotationQuestions}
                isNewAnnotationQuestionModalOpen={isNewAnnotationQuestionModalOpen}
                setIsNewAnnotationQuestionModalOpen={setIsNewAnnotationQuestionModalOpen}
            />
        </>
    )
}

export default NewAnnotationConfiguration
