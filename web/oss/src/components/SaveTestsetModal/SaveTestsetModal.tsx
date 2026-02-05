import {useCallback, useState} from "react"

import EnhancedModal from "@agenta/oss/src/components/EnhancedUIs/Modal"
import {message} from "@agenta/ui/app-message"
import {Input} from "antd"

import useFocusInput from "@/oss/hooks/useFocusInput"
import {createNewTestset} from "@/oss/services/testsets/api"

import {SaveTestsetModalProps} from "./types"

const SaveTestsetModal: React.FC<SaveTestsetModalProps> = ({
    evaluation,
    rows,
    onSuccess,
    ...props
}) => {
    const [submitLoading, setSubmitLoading] = useState(false)
    const [testsetName, setTestsetName] = useState("")
    const {inputRef} = useFocusInput({isOpen: props.open as boolean})

    const onClose = useCallback(() => {
        setTestsetName("")
        setSubmitLoading(false)
        props.onCancel?.({} as any)
    }, [props])

    const handleSave = useCallback(() => {
        try {
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

            createNewTestset(testsetName, newRows)
                .then(() => onSuccess?.(testsetName))
                .catch(console.error)
                .finally(() => {
                    setSubmitLoading(false)
                })
        } catch (error) {
            console.error("Error creating testset:", error)
            message.error("Failed to create testset. Please try again!")
        } finally {
            setSubmitLoading(false)
        }
    }, [rows, evaluation, testsetName, onSuccess])

    return (
        <EnhancedModal
            title="Add new testset"
            okText="Create"
            onOk={handleSave}
            confirmLoading={submitLoading}
            okButtonProps={{disabled: !testsetName}}
            onCancel={onClose}
            afterOpenChange={(open) => {
                if (open) {
                    inputRef.current?.input?.focus()
                }
            }}
            {...props}
        >
            <Input
                ref={inputRef}
                placeholder="Testset name"
                onChange={(e) => setTestsetName(e.target.value)}
                value={testsetName}
                className="my-3"
            />
        </EnhancedModal>
    )
}

export default SaveTestsetModal
