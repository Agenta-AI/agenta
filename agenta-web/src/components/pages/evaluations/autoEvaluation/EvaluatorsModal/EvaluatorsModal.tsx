import {useAppId} from "@/hooks/useAppId"
import {evaluatorConfigsAtom, evaluatorsAtom} from "@/lib/atoms/evaluation"
import {Evaluator, EvaluatorConfig, testset, Variant} from "@/lib/Types"
import {fetchAllEvaluatorConfigs, fetchAllEvaluators} from "@/services/evaluations/api"
import {Modal} from "antd"
import {useAtom} from "jotai"
import React, {useEffect, useState} from "react"
import {createUseStyles} from "react-jss"
import {fetchVariants} from "@/services/api"
import {fetchTestsets} from "@/services/testsets/api"
import ConfigureEvaluator from "./ConfigureEvaluator"
import NewEvaluator from "./NewEvaluator"
import Evaluators from "./Evaluators"
import {useLocalStorage} from "usehooks-ts"

type EvaluatorsModalProps = {} & React.ComponentProps<typeof Modal>

const useStyles = createUseStyles(() => ({
    modalWrapper: {
        transition: "width 0.3s ease",
        "& .ant-modal-content": {
            height: 800,
            "& .ant-modal-body": {
                height: "100%",
            },
        },
    },
}))

const EvaluatorsModal = ({...props}: EvaluatorsModalProps) => {
    const classes = useStyles()
    const appId = useAppId()
    const [current, setCurrent] = useState(0)
    const [evaluators, setEvaluators] = useAtom(evaluatorsAtom)
    const [evaluatorConfigs, setEvaluatorConfigs] = useAtom(evaluatorConfigsAtom)
    const [selectedEvaluator, setSelectedEvaluator] = useState<Evaluator | null>(null)
    const [variants, setVariants] = useState<Variant[] | null>(null)
    const [testsets, setTestsets] = useState<testset[] | null>(null)
    const [fetchingEvalConfigs, setFetchingEvalConfigs] = useState(false)
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
    const [selectedEvaluatorCategory, setSelectedEvaluatorCategory] = useState("view_all")
    const [debugEvaluator, setDebugEvaluator] = useLocalStorage("isDebugSelectionOpen", false)
    const [selectedTestset, setSelectedTestset] = useState("")

    const evalConfigFetcher = () => {
        setFetchingEvalConfigs(true)
        fetchAllEvaluatorConfigs(appId)
            .then(setEvaluatorConfigs)
            .catch(console.error)
            .finally(() => setFetchingEvalConfigs(false))
    }

    useEffect(() => {
        Promise.all([
            fetchAllEvaluators(),
            fetchAllEvaluatorConfigs(appId),
            fetchVariants(appId),
            fetchTestsets(appId),
        ]).then(([evaluators, configs, variants, testsets]) => {
            setEvaluators(evaluators)
            setEvaluatorConfigs(configs)
            setVariants(variants)
            if (variants.length) {
                setSelectedVariant(variants[0])
            }
            setTestsets(testsets)
            if (testsets.length) {
                setSelectedTestset(testsets[0]._id)
            }
        })
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
                    selectedEvaluatorCategory={selectedEvaluatorCategory}
                    setSelectedEvaluatorCategory={setSelectedEvaluatorCategory}
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
                    selectedEvaluatorCategory={selectedEvaluatorCategory}
                    setSelectedEvaluatorCategory={setSelectedEvaluatorCategory}
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
                    variants={variants}
                    testsets={testsets}
                    onSuccess={() => {
                        evalConfigFetcher()
                        setCurrent(0)
                        setEditMode(false)
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
        <Modal
            footer={null}
            style={{
                height: "95vh",
                width: current === 2 && !debugEvaluator ? "600px" : "90vw",
                maxWidth: "1800px",
                maxHeight: "1100px",
                minWidth: current === 2 && !debugEvaluator ? "600px" : "1200px",
                minHeight: "800px",
            }}
            closeIcon={null}
            title={null}
            className={classes.modalWrapper}
            maskClosable={false}
            centered
            {...props}
        >
            {steps[current]?.content}
        </Modal>
    )
}

export default EvaluatorsModal
