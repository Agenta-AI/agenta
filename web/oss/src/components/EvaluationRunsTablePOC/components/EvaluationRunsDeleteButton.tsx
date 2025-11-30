import {useMemo, useEffect} from "react"

import {Trash} from "@phosphor-icons/react"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import DeleteEvaluationModalButton from "@/oss/components/DeleteEvaluationModal/DeleteEvaluationModalButton"

import {EVALUATION_RUNS_QUERY_KEY_ROOT} from "../atoms/tableStore"
import {
    evaluationRunsMetaUpdaterAtom,
    evaluationRunsSelectedRowKeysAtom,
    evaluationRunsSelectionSnapshotAtom,
    evaluationRunsDeleteContextAtom,
    evaluationRunsTableResetAtom,
    evaluationRunsDeleteModalOpenAtom,
} from "../atoms/view"

const EvaluationRunsDeleteButton = () => {
    const selection = useAtomValue(evaluationRunsSelectionSnapshotAtom)
    const deleteContext = useAtomValue(evaluationRunsDeleteContextAtom)
    const resetCallback = useAtomValue(evaluationRunsTableResetAtom)
    const setSelectedRowKeys = useSetAtom(evaluationRunsSelectedRowKeysAtom)
    const setMetaUpdater = useSetAtom(evaluationRunsMetaUpdaterAtom)

    const [open, setOpen] = useAtom(evaluationRunsDeleteModalOpenAtom)

    useEffect(() => {
        if (!selection.hasSelection && open) {
            setOpen(false)
        }
    }, [open, selection.hasSelection, setOpen])

    const evaluationType = useMemo(() => {
        if (selection.labels && selection.labels.length) {
            return selection.labels
        }
        return "selected evaluations"
    }, [selection.labels])

    const deletionConfig = useMemo(() => {
        if (!selection.hasSelection) return undefined
        return {
            evaluationKind: deleteContext.evaluationKind,
            projectId: deleteContext.projectId,
            previewRunIds: selection.previewRunIds,
            invalidateQueryKeys: [EVALUATION_RUNS_QUERY_KEY_ROOT],
            onSuccess: async () => {
                setSelectedRowKeys([])
                resetCallback?.()
                setMetaUpdater((prev) => ({...prev}))
                setOpen(false)
            },
            onError: () => {
                setOpen(false)
            },
        }
    }, [
        deleteContext.evaluationKind,
        deleteContext.projectId,
        resetCallback,
        selection.hasSelection,
        selection.previewRunIds,
        setMetaUpdater,
        setSelectedRowKeys,
    ])

    const enabledTooltip = selection.hasSelection ? "Delete selected evaluations" : undefined

    return (
        <DeleteEvaluationModalButton
            evaluationType={evaluationType}
            isMultiple={selection.rows.length > 1}
            deletionConfig={deletionConfig}
            disabled={!selection.hasSelection}
            disabledTooltip="Select evaluations to delete"
            enabledTooltip={enabledTooltip}
            buttonProps={{danger: true, icon: <Trash size={16} />}}
            open={open}
            onOpenChange={setOpen}
        >
            Delete
        </DeleteEvaluationModalButton>
    )
}

export default EvaluationRunsDeleteButton
