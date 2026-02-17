import {memo, useEffect, useMemo, useState} from "react"

import {ModalProps} from "antd"
import clsx from "clsx"
import {useAtom, useSetAtom} from "jotai"
import {useLocalStorage} from "usehooks-ts"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"
import {useAppId} from "@/oss/hooks/useAppId"
import {evaluatorConfigsAtom} from "@/oss/lib/atoms/evaluation"
import useFetchEvaluatorsData from "@/oss/lib/hooks/useFetchEvaluatorsData"
import {Evaluator, SimpleEvaluator} from "@/oss/lib/Types"

import ConfigureEvaluator from "./ConfigureEvaluator"
import {initPlaygroundAtom, resetPlaygroundAtom} from "./ConfigureEvaluator/state/atoms"
import Evaluators from "./Evaluators"
import NewEvaluator from "./NewEvaluator"

interface EvaluatorsModalProps extends ModalProps {
    current: number
    setCurrent: React.Dispatch<React.SetStateAction<number>>
    openedFromNewEvaluation?: boolean
    appId?: string | null
}

const EvaluatorsModal = ({
    current,
    setCurrent,
    openedFromNewEvaluation = false,
    appId: appIdOverride,
    ...modalProps
}: EvaluatorsModalProps) => {
    const routeAppId = useAppId()
    const appId = appIdOverride ?? routeAppId
    const [debugEvaluator] = useLocalStorage("isDebugSelectionOpen", false)
    const [evaluatorConfigs] = useAtom(evaluatorConfigsAtom)
    const [selectedEvaluator, setSelectedEvaluator] = useState<Evaluator | null>(null)
    const {refetchEvaluatorConfigs, isLoadingEvaluatorConfigs: fetchingEvalConfigs} =
        useFetchEvaluatorsData({appId: appId ?? ""})
    const [editMode, setEditMode] = useState(false)
    const [cloneConfig, setCloneConfig] = useState(false)
    const [editEvalEditValues, setEditEvalEditValues] = useState<SimpleEvaluator | null>(null)
    const [evaluatorsDisplay, setEvaluatorsDisplay] = useLocalStorage<"card" | "list">(
        "evaluator_view",
        "list",
    )

    // Atom actions for initializing/resetting playground state
    const initPlayground = useSetAtom(initPlaygroundAtom)
    const resetPlayground = useSetAtom(resetPlaygroundAtom)

    // Initialize playground atoms when evaluator is selected
    useEffect(() => {
        if (selectedEvaluator) {
            initPlayground({
                evaluator: selectedEvaluator,
                existingConfig: editEvalEditValues,
                mode: editMode ? "edit" : cloneConfig ? "clone" : "create",
            })
        }
    }, [selectedEvaluator, editMode, cloneConfig, editEvalEditValues, initPlayground])

    // Reset playground when modal closes
    useEffect(() => {
        if (!modalProps.open) {
            resetPlayground()
        }
    }, [modalProps.open, resetPlayground])

    const handleCloseConfigureEvaluator = () => {
        modalProps.onCancel?.({} as any)
        setEditMode(false)
        setCloneConfig(false)
        setEditEvalEditValues(null)
        setSelectedEvaluator(null)
        resetPlayground()
    }

    const handleSuccessConfigureEvaluator = () => {
        refetchEvaluatorConfigs()
        setEditMode(false)
        if (openedFromNewEvaluation) {
            modalProps.onCancel?.({} as any)
        } else {
            setCurrent(0)
        }
        setSelectedEvaluator(null)
        resetPlayground()
    }

    const steps = useMemo(() => {
        return [
            {
                content: (
                    <Evaluators
                        evaluatorConfigs={evaluatorConfigs}
                        handleOnCancel={() => modalProps.onCancel?.({} as any)}
                        setCurrent={setCurrent}
                        setSelectedEvaluator={setSelectedEvaluator}
                        fetchingEvalConfigs={fetchingEvalConfigs}
                        setEditMode={setEditMode}
                        setEditEvalEditValues={setEditEvalEditValues}
                        onSuccess={refetchEvaluatorConfigs}
                        setCloneConfig={setCloneConfig}
                        setEvaluatorsDisplay={setEvaluatorsDisplay}
                        evaluatorsDisplay={evaluatorsDisplay}
                    />
                ),
            },
            {
                content: (
                    <NewEvaluator
                        setCurrent={setCurrent}
                        handleOnCancel={() => modalProps.onCancel?.({} as any)}
                        setSelectedEvaluator={setSelectedEvaluator}
                        setEvaluatorsDisplay={setEvaluatorsDisplay}
                        evaluatorsDisplay={evaluatorsDisplay}
                    />
                ),
            },
        ]
    }, [
        evaluatorConfigs,
        fetchingEvalConfigs,
        evaluatorsDisplay,
        modalProps.onCancel,
        setCurrent,
        refetchEvaluatorConfigs,
        setEvaluatorsDisplay,
    ])

    // Add ConfigureEvaluator step when an evaluator is selected
    if (selectedEvaluator) {
        steps.push({
            content: (
                <ConfigureEvaluator
                    onClose={handleCloseConfigureEvaluator}
                    onSuccess={handleSuccessConfigureEvaluator}
                />
            ),
        })
    }

    return (
        <EnhancedModal
            footer={null}
            closeIcon={null}
            title={null}
            width="90vw"
            className="[&_>_div]:!h-full [&_.ant-modal-content]:!h-full !overflow-y-hidden min-w-[600px] max-w-[95vw] min-h-[600px]"
            classNames={{body: "!h-full !overflow-auto"}}
            maskClosable={false}
            styles={{
                container: {
                    height: "85vh",
                },
            }}
            {...modalProps}
        >
            <div
                className={clsx([
                    "transition-all duration-300 ease-in-out !h-full w-full max-w-full overflow-hidden",
                    "[&_>_div]:!h-full",
                    {
                        "max-w-[600px]": current === 2 && !debugEvaluator,
                        "max-w-[95vw]": current !== 2 || debugEvaluator,
                    },
                ])}
            >
                {steps[current]?.content}
            </div>
        </EnhancedModal>
    )
}

export default memo(EvaluatorsModal)
