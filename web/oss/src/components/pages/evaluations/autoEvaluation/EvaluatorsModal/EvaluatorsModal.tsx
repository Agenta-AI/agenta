// @ts-nocheck
import {useEffect, useMemo, useState} from "react"

import {ModalProps} from "antd"
import {useAtom} from "jotai"
import {useLocalStorage} from "usehooks-ts"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"
import {useAppsData} from "@/oss/contexts/app.context"
import {useAppId} from "@/oss/hooks/useAppId"
import {evaluatorConfigsAtom, evaluatorsAtom} from "@/oss/lib/atoms/evaluation"
import {groupVariantsByParent} from "@/oss/lib/helpers/variantHelper"
import {useVariants} from "@/oss/lib/hooks/useVariants"
import {Evaluator, EvaluatorConfig, testset, Variant} from "@/oss/lib/Types"
import {fetchAllEvaluatorConfigs, fetchAllEvaluators} from "@/oss/services/evaluations/api"
import {fetchTestsets} from "@/oss/services/testsets/api"

import ConfigureEvaluator from "./ConfigureEvaluator"
import Evaluators from "./Evaluators"
import NewEvaluator from "./NewEvaluator"

interface EvaluatorsModalProps extends ModalProps {
    current: number
    setCurrent: React.Dispatch<React.SetStateAction<number>>
    openedFromNewEvaluation?: boolean
}

const EvaluatorsModal = ({
    current,
    setCurrent,
    openedFromNewEvaluation = false,
    ...props
}: EvaluatorsModalProps) => {
    const appId = useAppId()
    const [debugEvaluator, setDebugEvaluator] = useLocalStorage("isDebugSelectionOpen", false)

    const [evaluators, setEvaluators] = useAtom(evaluatorsAtom)
    const [evaluatorConfigs, setEvaluatorConfigs] = useAtom(evaluatorConfigsAtom)
    const [selectedEvaluator, setSelectedEvaluator] = useState<Evaluator | null>(null)
    const [testsets, setTestsets] = useState<testset[] | null>(null)
    const [fetchingEvalConfigs, setFetchingEvalConfigs] = useState(false)
    const [selectedTestcase, setSelectedTestcase] = useState<{
        testcase: Record<string, any> | null
    }>({
        testcase: null,
    })
    const {currentApp} = useAppsData()
    const [selectedVariant, setSelectedVariant] = useState<Variant | null>(null)
    const [editMode, setEditMode] = useState(false)
    const [cloneConfig, setCloneConfig] = useState(false)
    const [editEvalEditValues, setEditEvalEditValues] = useState<EvaluatorConfig | null>(null)
    const [evaluatorsDisplay, setEvaluatorsDisplay] = useLocalStorage<"card" | "list">(
        "evaluator_view",
        "list",
    )
    const [selectedTestset, setSelectedTestset] = useState("")

    const evalConfigFetcher = () => {
        setFetchingEvalConfigs(true)
        fetchAllEvaluatorConfigs(appId)
            .then(setEvaluatorConfigs)
            .catch(console.error)
            .finally(() => setFetchingEvalConfigs(false))
    }

    const {data} = useVariants(currentApp)({appId})

    const variants = useMemo(() => groupVariantsByParent(data?.variants, true), [data?.variants])

    useEffect(() => {
        if (variants?.length) {
            setSelectedVariant(variants[0])
        }
    }, [data])

    useEffect(() => {
        Promise.all([fetchAllEvaluators(), fetchAllEvaluatorConfigs(appId), fetchTestsets()]).then(
            ([evaluators, configs, testsets]) => {
                setEvaluators(evaluators)
                setEvaluatorConfigs(configs)
                setTestsets(testsets)
                if (testsets.length) {
                    setSelectedTestset(testsets[0]._id)
                }
            },
        )
    }, [appId])

    const steps = [
        {
            content: (
                <Evaluators
                    evaluatorConfigs={evaluatorConfigs}
                    handleOnCancel={() => props.onCancel?.({} as any)}
                    setCurrent={setCurrent}
                    setSelectedEvaluator={setSelectedEvaluator}
                    fetchingEvalConfigs={fetchingEvalConfigs}
                    setEditMode={setEditMode}
                    setEditEvalEditValues={setEditEvalEditValues}
                    onSuccess={() => evalConfigFetcher()}
                    setCloneConfig={setCloneConfig}
                    setEvaluatorsDisplay={setEvaluatorsDisplay}
                    evaluatorsDisplay={evaluatorsDisplay}
                />
            ),
        },
        {
            content: (
                <NewEvaluator
                    evaluators={evaluators}
                    setCurrent={setCurrent}
                    handleOnCancel={() => props.onCancel?.({} as any)}
                    setSelectedEvaluator={setSelectedEvaluator}
                    setEvaluatorsDisplay={setEvaluatorsDisplay}
                    evaluatorsDisplay={evaluatorsDisplay}
                />
            ),
        },
    ]

    if (selectedEvaluator) {
        steps.push({
            content: (
                <ConfigureEvaluator
                    selectedEvaluator={selectedEvaluator}
                    setCurrent={setCurrent}
                    handleOnCancel={() => {
                        props.onCancel?.({} as any)
                        setEditMode(false)
                        setCloneConfig(false)
                        setEditEvalEditValues(null)
                    }}
                    variants={variants || []}
                    testsets={testsets}
                    onSuccess={() => {
                        evalConfigFetcher()
                        setEditMode(false)
                        if (openedFromNewEvaluation) {
                            props.onCancel?.({} as any)
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
                />
            ),
        })
    }

    return (
        <EnhancedModal
            footer={null}
            closeIcon={null}
            title={null}
            height={800}
            width={current === 2 && !debugEvaluator ? "600px" : "90vw"}
            className="[&_>div]:!h-full [&_.ant-modal-content]:!h-full !overflow-y-hidden transition-width duration-300 ease-in-out min-w-[800px] max-w-[1800px]"
            classNames={{body: "!h-full !overflow-auto"}}
            maskClosable={false}
            {...props}
        >
            {steps[current]?.content}
        </EnhancedModal>
    )
}

export default EvaluatorsModal
