import {JSSTheme} from "@/lib/Types"
import {PlusOutlined} from "@ant-design/icons"
import {Form, Input, Modal, Select} from "antd"
import React from "react"
import {createUseStyles} from "react-jss"

interface NewAnnotationConfigModalProps {
    setAnnotationQuestions: React.Dispatch<
        React.SetStateAction<
            {
                name: string
                question_type: string
                question: string
                rating: number
            }[]
        >
    >
    isNewAnnotationQuestionModalOpen: boolean
    setIsNewAnnotationQuestionModalOpen: React.Dispatch<React.SetStateAction<boolean>>
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    form: {margin: "20px 0"},
    formInput: {
        marginLeft: 10,
    },
}))

const NewAnnotationConfigModal: React.FC<NewAnnotationConfigModalProps> = ({
    isNewAnnotationQuestionModalOpen,
    setAnnotationQuestions,
    setIsNewAnnotationQuestionModalOpen,
}) => {
    const [form] = Form.useForm()
    const classes = useStyles()

    const onSubmit = (values: {
        name: string
        question_type: string
        question: string
        rating: number
    }) => {
        setAnnotationQuestions((prevState) => {
            return [
                ...prevState,
                {
                    name: values.name,
                    question: values.question,
                    question_type: values.question_type,
                    rating: values.rating,
                },
            ]
        })
        form.resetFields()
    }

    return (
        <Modal
            title="New Question"
            open={isNewAnnotationQuestionModalOpen}
            onCancel={() => setIsNewAnnotationQuestionModalOpen(false)}
            okText={"Create"}
            okButtonProps={{icon: <PlusOutlined />}}
            onOk={() => {
                form.submit()
                setIsNewAnnotationQuestionModalOpen(false)
            }}
            destroyOnClose
        >
            <Form
                requiredMark={false}
                form={form}
                name="new-question"
                onFinish={onSubmit}
                className={classes.form}
            >
                <Form.Item
                    label="Name"
                    name={"name"}
                    rules={[{required: true, message: "This field is required"}]}
                >
                    <Input className={classes.formInput} placeholder="Enter Question name" />
                </Form.Item>

                <Form.Item
                    label="Question Type"
                    name={"question_type"}
                    rules={[{required: true, message: "This field is required"}]}
                >
                    <Select
                        placeholder="Select Question Type"
                        data-cy="select-question-type"
                        className={classes.formInput}
                    >
                        {["Text Question", "Rating Question"].map((question) => (
                            <Select.Option
                                key={question}
                                value={question}
                                data-cy="select-question"
                            >
                                {question}
                            </Select.Option>
                        ))}
                    </Select>
                </Form.Item>

                <Form.Item
                    label="Question"
                    name={"question"}
                    rules={[{required: true, message: "This field is required"}]}
                >
                    <Input className={classes.formInput} placeholder="Enter Question" />
                </Form.Item>

                <Form.Item
                    label="Rating"
                    name={"rating"}
                    rules={[{required: true, message: "This field is required"}]}
                >
                    <Input className={classes.formInput} placeholder="Enter Rating" />
                </Form.Item>
            </Form>
        </Modal>
    )
}

export default NewAnnotationConfigModal
