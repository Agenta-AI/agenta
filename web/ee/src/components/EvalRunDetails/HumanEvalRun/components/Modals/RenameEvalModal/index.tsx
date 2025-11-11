import {useCallback, useMemo, useState} from "react"

import {message} from "antd"
import {useSWRConfig} from "swr"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"
import {useRunId} from "@/oss/contexts/RunIdContext"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {
    evalAtomStore,
    evaluationRunStateFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"

import {RenameEvalModalProps} from "../types"

import RenameEvalModalContent from "./assets/RenameEvalModalContent"

const RenameEvalModal = ({id, name, description, runId, ...props}: RenameEvalModalProps) => {
    const {mutate} = useSWRConfig()
    const contextRunId = useRunId() // Get runId from context
    const effectiveRunId = runId || contextRunId // Use prop runId if available, otherwise context
    const [editName, setEditName] = useState(name)
    const [editDescription, setEditDescription] = useState(description || "")
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const onAfterClose = useCallback(() => {
        setEditName(name)
        setEditDescription(description || "")
        setError(null)
        props.afterClose?.()
    }, [name, description])

    const handleSave = useCallback(async () => {
        setLoading(true)
        setError(null)

        // Use run-scoped atom with effectiveRunId (from prop or context)
        const state = evalAtomStore().get(evaluationRunStateFamily(effectiveRunId))

        try {
            await axios.patch(`/preview/evaluations/runs/${id}`, {
                run: {
                    ...state.rawRun,
                    id,
                    name: editName,
                    description: editDescription,
                },
            })
            await mutate(
                (key: string) => key.includes("/preview/evaluations/runs/") || key.includes(id),
                undefined,
                true,
            )

            message.success("Evaluation run updated")
            props.onCancel?.({} as any)
        } catch (err: any) {
            setError(err?.message || "Failed to update run")
        } finally {
            setLoading(false)
        }
    }, [id, editName, editDescription, mutate, runId])

    const isDisabled = useMemo(() => {
        return editName.trim() === name.trim() && editDescription.trim() === description?.trim()
    }, [editName, editDescription, name, description])

    return (
        <EnhancedModal
            title="Rename"
            onOk={handleSave}
            confirmLoading={loading}
            okText="Save"
            afterClose={onAfterClose}
            okButtonProps={{disabled: isDisabled}}
            {...props}
        >
            <RenameEvalModalContent
                loading={loading}
                error={error}
                editName={editName}
                setEditName={setEditName}
                editDescription={editDescription}
                setEditDescription={setEditDescription}
            />
        </EnhancedModal>
    )
}

export default RenameEvalModal
