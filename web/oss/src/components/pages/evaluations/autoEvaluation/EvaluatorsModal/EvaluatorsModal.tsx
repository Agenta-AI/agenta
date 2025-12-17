// @ts-nocheck
import {memo, useEffect, useMemo, useState} from "react"

import {ModalProps} from "antd"
import clsx from "clsx"
import {useAtom} from "jotai"
import {useLocalStorage} from "usehooks-ts"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"
import {useAppId} from "@/oss/hooks/useAppId"
import {evaluatorConfigsAtom} from "@/oss/lib/atoms/evaluation"
import {groupVariantsByParent} from "@/oss/lib/helpers/variantHelper"
import useFetchEvaluatorsData from "@/oss/lib/hooks/useFetchEvaluatorsData"
import useStatelessVariants from "@/oss/lib/hooks/useStatelessVariants"
import {Evaluator, EvaluatorConfig, Variant} from "@/oss/lib/Types"
import {useTestsetsData} from "@/oss/state/testset"

import ConfigureEvaluator from "./ConfigureEvaluator"
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
    const [debugEvaluator, setDebugEvaluator] = useLocalStorage("isDebugSelectionOpen", false)
    const [evaluatorConfigs] = useAtom(evaluatorConfigsAtom)
    const [selectedEvaluator, setSelectedEvaluator] = useState<Evaluator | null>(null)
    const {refetchEvaluatorConfigs, isLoadingEvaluatorConfigs: fetchingEvalConfigs} =
        useFetchEvaluatorsData({appId: appId ?? ""})
    const [selectedTestcase, setSelectedTestcase] = useState<{
        testcase: Record<string, any> | null
    }>({
        testcase: null,
    })
    const [selectedVariant, setSelectedVariant] = useState<Variant | null>(null)
    const [editMode, setEditMode] = useState(false)
    const [cloneConfig, setCloneConfig] = useState(false)
    const [editEvalEditValues, setEditEvalEditValues] = useState<EvaluatorConfig | null>(null)
    const [evaluatorsDisplay, setEvaluatorsDisplay] = useLocalStorage<"card" | "list">(
        "evaluator_view",
        "list",
    )
    const [selectedTestset, setSelectedTestset] = useState("")
    const {testsets} = useTestsetsData()

    useEffect(() => {
        if (testsets?.length) {
            setSelectedTestset(testsets[0]._id)
        }
    }, [testsets])

    const {variants: data} = useStatelessVariants()

    const variants = useMemo(() => groupVariantsByParent(data, true), [data])

    useEffect(() => {
        if (variants?.length) {
            setSelectedVariant(variants[0])
        }
    }, [data])

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
        setSelectedEvaluator,
        debugEvaluator,
        selectedTestcase,
        selectedVariant,
        selectedTestset,
        editMode,
        cloneConfig,
        editEvalEditValues,
        variants,
        testsets,
    ])

    if (selectedEvaluator) {
        steps.push({
            content: (
                <ConfigureEvaluator
                    selectedEvaluator={selectedEvaluator}
                    setCurrent={setCurrent}
                    handleOnCancel={() => {
                        modalProps.onCancel?.({} as any)
                        setEditMode(false)
                        setCloneConfig(false)
                        setEditEvalEditValues(null)
                    }}
                    variants={variants || []}
                    testsets={testsets || []}
                    onSuccess={() => {
                        refetchEvaluatorConfigs()
                        setEditMode(false)
                        if (openedFromNewEvaluation) {
                            modalProps.onCancel?.({} as any)
                        } else {
                            setCurrent(0)
                        }
                    }}
                    selectedTestcase={selectedTestcase}
                    selectedVariant={selectedVariant}
                    setSelectedVariant={setSelectedVariant}
                    editMode={editMode}
                    editEvalEditValues={editEvalEditValues}
                    setEditEvalEditValues={setEditEvalEditValues}
                    setEditMode={setEditMode}
                    cloneConfig={cloneConfig}
                    setCloneConfig={setCloneConfig}
                    setSelectedTestcase={setSelectedTestcase}
                    setDebugEvaluator={setDebugEvaluator}
                    debugEvaluator={debugEvaluator}
                    selectedTestset={selectedTestset}
                    setSelectedTestset={setSelectedTestset}
                    appId={appId}
                />
            ),
        })
    }

    return (
        <EnhancedModal
            footer={null}
            closeIcon={null}
            title={null}
            height="85vh"
            width="90vw"
            className="[&_>_div]:!h-full [&_.ant-modal-content]:!h-full !overflow-y-hidden min-w-[600px] max-w-[95vw] min-h-[600px]"
            classNames={{body: "!h-full !overflow-auto"}}
            maskClosable={false}
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
