import EvaluationResults from "@/components/pages/evaluations/evaluationResults/EvaluationResults"
import Evaluators from "@/components/pages/evaluations/evaluators/Evaluators"
import {useAppId} from "@/hooks/useAppId"
import {useQueryParam} from "@/hooks/useQuery"
import {JSSTheme} from "@/lib/Types"
import {evaluatorConfigsAtom, evaluatorsAtom} from "@/lib/atoms/evaluation"
import {fetchAllEvaluatorConfigs, fetchAllEvaluators} from "@/services/evaluations"
import {SlidersOutlined, UnorderedListOutlined} from "@ant-design/icons"
import {Tabs} from "antd"
import {useAtom} from "jotai"
import React, {useEffect} from "react"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    root: {
        "& .ant-tabs-nav": {
            position: "sticky",
            top: 0,
            zIndex: 1,
            background: theme.colorBgContainer,
            marginBottom: 0,
        },
    },
}))

interface Props {}

const Evaluations: React.FC<Props> = () => {
    const [tab, setTab] = useQueryParam("tab", "results")
    const appId = useAppId()
    const classes = useStyles()
    const setEvaluators = useAtom(evaluatorsAtom)[1]
    const setEvaluatorConfigs = useAtom(evaluatorConfigsAtom)[1]

    useEffect(() => {
        Promise.all([fetchAllEvaluators(), fetchAllEvaluatorConfigs(appId)]).then(
            ([evaluators, configs]) => {
                setEvaluators(evaluators)
                setEvaluatorConfigs(configs)
            },
        )
    }, [appId])

    return (
        <div className={classes.root}>
            <Tabs
                destroyInactiveTabPane
                activeKey={tab}
                items={[
                    {
                        key: "results",
                        label: "Results",
                        icon: <UnorderedListOutlined />,
                        children: <EvaluationResults />,
                    },
                    {
                        key: "evaluators",
                        label: "Evaluators",
                        icon: <SlidersOutlined />,
                        children: <Evaluators />,
                    },
                ]}
                onChange={setTab}
            />
        </div>
    )
}

export default Evaluations
