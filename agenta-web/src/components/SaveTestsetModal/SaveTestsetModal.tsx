import {Evaluation, EvaluationScenario} from "@/lib/Types"
import {EvaluationFlow} from "@/lib/enums"
import {createNewTestset} from "@/lib/services/api"
import {Form, Input, Modal, message} from "antd"
import React, {Dispatch, SetStateAction} from "react"

type EvaluationRow = EvaluationScenario & {
    evaluationFlow: EvaluationFlow
} & {[variantId: string]: string}

interface SaveTestsetModalProps {
    appId: string
    isTestsetModalOpen: boolean
    setIsTestsetModalOpen: Dispatch<SetStateAction<boolean>>
    evaluation: Evaluation
    rows: EvaluationRow[]
}

const SaveTestsetModal: React.FC<SaveTestsetModalProps> = ({
    setIsTestsetModalOpen,
    appId,
    isTestsetModalOpen,
    evaluation,
    rows,
}) => {
    const [form] = Form.useForm()

    const handleSave = async () => {
        const testsetName = form.getFieldValue("name")
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

        await createNewTestset(appId, testsetName, newRows)
            .then(() => {
                message.success(`Row added to the "${testsetName}" test set!`)
            })
            .finally(() => setIsTestsetModalOpen(false))
    }

    return (
        <Modal
            title="Add new test set"
            okText="Submit"
            open={isTestsetModalOpen}
            destroyOnClose
            onCancel={() => setIsTestsetModalOpen(false)}
            onOk={() => handleSave()}
        >
            <Form form={form}>
                <Form.Item
                    rules={[{required: true, message: "Please enter test set name!"}]}
                    name="name"
                >
                    <Input placeholder="Test set name" />
                </Form.Item>
            </Form>
        </Modal>
    )
}

export default SaveTestsetModal
