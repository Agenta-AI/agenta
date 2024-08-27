import {useAppId} from "@/hooks/useAppId"
import {evaluatorConfigsAtom, evaluatorsAtom} from "@/lib/atoms/evaluation"
import {Evaluator, JSSTheme, Variant} from "@/lib/Types"
import {fetchAllEvaluatorConfigs, fetchAllEvaluators} from "@/services/evaluations/api"
import {Modal} from "antd"
import {useAtom} from "jotai"
import React, {useEffect, useState} from "react"
import {createUseStyles} from "react-jss"
import ConfigureEvaluators from "./ConfigureEvaluators"
import CreateNewEvaluator from "./CreateNewEvaluator"
import ConfigureNewEvaluator from "./ConfigureNewEvaluator"
import {fetchVariants} from "@/services/api"

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

    useEffect(() => {
        Promise.all([
            fetchAllEvaluators(),
            fetchAllEvaluatorConfigs(appId),
            fetchVariants(appId),
        ]).then(([evaluators, configs, variants]) => {
            setEvaluators(evaluators)
            setEvaluatorConfigs(configs)
            setVariants(variants)
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
                />
            ),
        })
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
