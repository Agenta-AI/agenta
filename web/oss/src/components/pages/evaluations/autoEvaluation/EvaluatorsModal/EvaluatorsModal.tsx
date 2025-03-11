// @ts-nocheck
import {useEffect, useState} from "react"

import {Modal} from "antd"
import {useAtom} from "jotai"
import {createUseStyles} from "react-jss"
import {useLocalStorage} from "usehooks-ts"

import {useAppsData} from "@/oss/contexts/app.context"
import {useAppId} from "@/oss/hooks/useAppId"
import {evaluatorConfigsAtom, evaluatorsAtom} from "@/oss/lib/atoms/evaluation"
import {useVariants} from "@/oss/lib/hooks/useVariants"
import {Evaluator, EvaluatorConfig, testset, Variant} from "@/oss/lib/Types"
import {fetchAllEvaluatorConfigs, fetchAllEvaluators} from "@/oss/services/evaluations/api"
import {fetchTestsets} from "@/oss/services/testsets/api"

import ConfigureEvaluator from "./ConfigureEvaluator"
import Evaluators from "./Evaluators"
import NewEvaluator from "./NewEvaluator"

type EvaluatorsModalProps = {
    current: number
    setCurrent: React.Dispatch<React.SetStateAction<number>>
    openedFromNewEvaluation?: boolean
} & React.ComponentProps<typeof Modal>

const useStyles = createUseStyles(() => ({
    modalWrapper: ({current, debugEvaluator}: {current: number; debugEvaluator: boolean}) => ({
        height: "95vh",
        width: `${current === 2 && !debugEvaluator ? "600px" : "90vw"} !important`,
        maxWidth: "1800px",
        maxHeight: "1100px",
        minWidth: current === 2 && !debugEvaluator ? "600px" : "1000px",
        minHeight: "800px",
        transition: "width 0.3s ease",
        "& > div": {
            height: "100%",
        },
        "& .ant-modal-content": {
            height: "100%",
            "& .ant-modal-body": {
                height: "100%",
            },
        },
    }),
}))

const EvaluatorsModal = ({
    current,
    setCurrent,
    openedFromNewEvaluation = false,
    ...props
}: EvaluatorsModalProps) => {
    const appId = useAppId()
    const [debugEvaluator, setDebugEvaluator] = useLocalStorage("isDebugSelectionOpen", false)
    const classes = useStyles({current, debugEvaluator})
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

    useEffect(() => {
        if (data?.variants?.length) {
            setSelectedVariant(data?.variants[0].variant)
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
                    variants={data?.variants || []}
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
        <Modal
            footer={null}
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
