import {useAppId} from "@/hooks/useAppId"
import {evaluatorConfigsAtom, evaluatorsAtom} from "@/lib/atoms/evaluation"
import {Evaluator, EvaluatorConfig, JSSTheme, testset, Variant} from "@/lib/Types"
import {fetchAllEvaluatorConfigs, fetchAllEvaluators} from "@/services/evaluations/api"
import {Modal} from "antd"
import {useAtom} from "jotai"
import React, {useEffect, useState} from "react"
import {createUseStyles} from "react-jss"
import {fetchVariants} from "@/services/api"
import {fetchTestsets} from "@/services/testsets/api"
import TestcaseTab from "./TestcaseTab/TestcaseTab"
import ConfigureEvaluator from "./ConfigureEvaluator"
import NewEvaluator from "./NewEvaluator"
import Evaluators from "./Evaluators"
import {useLocalStorage} from "usehooks-ts"

type EvaluatorsModalProps = {} & React.ComponentProps<typeof Modal>

const useStyles = createUseStyles((theme: JSSTheme) => ({
    modalWrapper: {
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
    const [selectedTestcase, setSelectedTestcase] = useState<Record<string, any> | null>(null)
    const [selectedVariant, setSelectedVariant] = useState<Variant | null>(null)
    const [editMode, setEditMode] = useState(false)
    const [cloneConfig, setCloneConfig] = useState(false)
    const [editEvalEditValues, setEditEvalEditValues] = useState<EvaluatorConfig | null>(null)
    const [evaluatorsDisplay, setEvaluatorsDisplay] = useLocalStorage("evaluator_view", "card")

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
            setTestsets(testsets)
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
                    variants={variants}
                    testsets={testsets}
                    onSuccess={() => {
                        evalConfigFetcher()
                        setCurrent(0)
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
                />
            ),
        })

        if (testsets && testsets.length) {
            steps.push({
                content: (
                    <TestcaseTab
                        handleOnCancel={() => setCurrent(2)}
                        testsets={testsets}
                        setSelectedTestcase={setSelectedTestcase}
                        selectedTestcase={selectedTestcase}
                    />
                ),
            })
        }
    }

    return (
        <Modal
            footer={null}
            width={1200}
            closeIcon={null}
            title={null}
            className={classes.modalWrapper}
            {...props}
        >
            {steps[current]?.content}
        </Modal>
    )
}

export default EvaluatorsModal
