import React, {useEffect, useState} from "react"
import {useAppId} from "@/hooks/useAppId"
import {Evaluation, EvaluationScenario} from "@/lib/Types"
import {EvaluationFlow} from "@/lib/enums"
import {createNewTestset} from "@/lib/services/api"
import {Form, Input, Modal} from "antd"

type EvaluationRow = EvaluationScenario & {
    evaluationFlow: EvaluationFlow
} & {[variantId: string]: string}

type SaveTestsetModalProps = {
    evaluation: Evaluation
    rows: EvaluationRow[]
    onSuccess: (testsetName: string) => void
} & React.ComponentProps<typeof Modal>

const SaveTestsetModal: React.FC<SaveTestsetModalProps> = ({
    evaluation,
    rows,
    onSuccess,
    ...props
}) => {
    const appId = useAppId()
    const [form] = Form.useForm()
    const [submitLoading, setSubmitLoading] = useState(false)

    useEffect(() => {
        form.resetFields()
    }, [props.open])

    const handleSave = (values: {testset_name: string}) => {
        setSubmitLoading(true)
        const newRows = rows.map((row, index) => {
            if (evaluation.testset.testsetChatColumn) {
                return {
                    chat: evaluation.testset.csvdata[index].chat,
                    correct_answer: row.correctAnswer,
                    annotation: row.note,
                }
            }
            return {
                [row.inputs[0].input_name]: row.inputs[0].input_value,
                correct_answer: row.correctAnswer,
                annotation: row.note,
            }
        })

        createNewTestset(appId, values.testset_name, newRows)
            .then(() => onSuccess(values.testset_name))
            .catch(console.error)
            .finally(() => {
                setSubmitLoading(false)
            })
    }

    return (
        <Modal
            title="Add new test set"
            okText="Submit"
            destroyOnClose
            onOk={form.submit}
            okButtonProps={{loading: submitLoading}}
            {...props}
        >
            <Form form={form} onFinish={handleSave}>
                <Form.Item
                    rules={[{required: true, message: "Please enter test set name!"}]}
                    name="testset_name"
                >
                    <Input placeholder="Test set name" />
                </Form.Item>
            </Form>
        </Modal>
    )
}

export default SaveTestsetModal
