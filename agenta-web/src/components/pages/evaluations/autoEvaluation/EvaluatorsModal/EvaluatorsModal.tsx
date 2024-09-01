import {useAppId} from "@/hooks/useAppId"
import {evaluatorConfigsAtom, evaluatorsAtom} from "@/lib/atoms/evaluation"
import {Evaluator, JSSTheme, testset, Variant} from "@/lib/Types"
import {fetchAllEvaluatorConfigs, fetchAllEvaluators} from "@/services/evaluations/api"
import {Modal} from "antd"
import {useAtom} from "jotai"
import React, {useEffect, useState} from "react"
import {createUseStyles} from "react-jss"
import ConfigureEvaluators from "./ConfigureEvaluators"
import CreateNewEvaluator from "./CreateNewEvaluator"
import ConfigureNewEvaluator from "./ConfigureNewEvaluator"
import {fetchVariants} from "@/services/api"
import {fetchTestsets} from "@/services/testsets/api"
import TestcaseTab from "./TestcaseTab/TestcaseTab"

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
                <ConfigureEvaluators
                    evaluatorConfigs={evaluatorConfigs}
                    handleOnCancel={() => props.onCancel?.({} as any)}
                    setCurrent={setCurrent}
                    setSelectedEvaluator={setSelectedEvaluator}
                    fetchingEvalConfigs={fetchingEvalConfigs}
                />
            ),
        },
        {
            content: (
                <CreateNewEvaluator
                    evaluators={evaluators}
                    setCurrent={setCurrent}
                    handleOnCancel={() => props.onCancel?.({} as any)}
                    setSelectedEvaluator={setSelectedEvaluator}
                />
            ),
        },
    ]

    if (selectedEvaluator) {
        steps.push({
            content: (
                <ConfigureNewEvaluator
                    selectedEvaluator={selectedEvaluator}
                    setCurrent={setCurrent}
                    handleOnCancel={() => props.onCancel?.({} as any)}
                    variants={variants}
                    testsets={testsets}
                    onSuccess={() => {
                        evalConfigFetcher()
                        setCurrent(0)
                    }}
                    selectedTestcase={selectedTestcase}
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
