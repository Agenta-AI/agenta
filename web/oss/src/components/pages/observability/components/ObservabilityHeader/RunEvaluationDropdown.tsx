import {memo, useCallback, useMemo, useState} from "react"

import {ChartDonutIcon, PlayIcon} from "@phosphor-icons/react"
import {Button, Dropdown, type MenuProps, Tooltip} from "antd"
import dynamic from "next/dynamic"

import type {EvalStepSlot} from "@/oss/components/pages/evaluations/NewEvaluation/evalSteps/types"

const NewEvaluationModal = dynamic(
    () => import("@/oss/components/pages/evaluations/NewEvaluation"),
    {ssr: false},
)

interface RunEvaluationDropdownProps {
    selectedTraceIds: string[]
    onModalClose?: () => void
    size?: "small" | "middle"
}

const RunEvaluationDropdown = ({
    selectedTraceIds,
    onModalClose,
    size = "middle",
}: RunEvaluationDropdownProps) => {
    const [isModalOpen, setIsModalOpen] = useState(false)
    const isDisabled = selectedTraceIds.length === 0

    const steps = useMemo<EvalStepSlot[]>(
        () => [
            {kind: "traces", required: true, preset: [...selectedTraceIds]},
            {kind: "evaluator", required: true},
            {kind: "advanced", required: true},
        ],
        [selectedTraceIds],
    )

    const handleMenuClick = useCallback<NonNullable<MenuProps["onClick"]>>(
        ({key}) => {
            if (key === "auto-eval" && !isDisabled) setIsModalOpen(true)
        },
        [isDisabled],
    )

    const menuItems = useMemo<NonNullable<MenuProps["items"]>>(
        () => [
            {
                key: "auto-eval",
                label: "Run auto evaluation",
                icon: <ChartDonutIcon size={14} />,
                disabled: isDisabled,
            },
        ],
        [isDisabled],
    )

    const handleModalClose = useCallback(() => {
        setIsModalOpen(false)
        onModalClose?.()
    }, [onModalClose])

    return (
        <>
            <Tooltip title={isDisabled ? "Select traces to run an evaluation" : undefined}>
                <span>
                    <Dropdown
                        trigger={["click"]}
                        placement="bottomRight"
                        menu={{items: menuItems, onClick: handleMenuClick}}
                    >
                        <Button
                            type="default"
                            size={size}
                            icon={<PlayIcon size={14} />}
                            disabled={isDisabled}
                            aria-label="Run evaluation"
                        >
                            Run
                        </Button>
                    </Dropdown>
                </span>
            </Tooltip>

            <NewEvaluationModal
                open={isModalOpen}
                onCancel={handleModalClose}
                onSuccess={handleModalClose}
                evaluationType="auto"
                preview={false}
                liveCompatibleEvaluatorsOnly
                steps={steps}
            />
        </>
    )
}

export default memo(RunEvaluationDropdown)
