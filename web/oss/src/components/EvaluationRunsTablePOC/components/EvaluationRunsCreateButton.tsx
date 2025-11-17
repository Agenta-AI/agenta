import {useEffect} from "react"

import {Plus} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"
import {useAtom, useAtomValue} from "jotai"

import {evaluationRunsCreateModalOpenAtom, evaluationRunsTableHeaderStateAtom} from "../atoms/view"

const EvaluationRunsCreateButton = () => {
    const {createEnabled, createTooltip} = useAtomValue(evaluationRunsTableHeaderStateAtom)
    const [createOpen, setCreateOpen] = useAtom(evaluationRunsCreateModalOpenAtom)

    useEffect(() => {
        if (!createEnabled && createOpen) {
            setCreateOpen(false)
        }
    }, [createEnabled, createOpen, setCreateOpen])

    return (
        <Tooltip title={createTooltip ?? undefined}>
            <div className="inline-flex">
                <Button
                    type="primary"
                    icon={<Plus size={16} />}
                    disabled={!createEnabled}
                    onClick={() => {
                        if (!createEnabled) return
                        setCreateOpen(true)
                    }}
                >
                    New Evaluation
                </Button>
            </div>
        </Tooltip>
    )
}

export default EvaluationRunsCreateButton
