import {HumanEvaluationListTableDataType} from "@/components/Evaluations/HumanEvaluationResult"
import AbTestingEvaluation from "@/components/pages/evaluations/abTestingEvaluation/AbTestingEvaluation"
import AutoEvaluation from "@/components/pages/evaluations/autoEvaluation/AutoEvaluation"
import SingleModelEvaluation from "@/components/pages/evaluations/singleModelEvaluation/SingleModelEvaluation"
import {useAppId} from "@/hooks/useAppId"
import {useQueryParam} from "@/hooks/useQuery"
import {_Evaluation, JSSTheme, SingleModelEvaluationListTableDataType} from "@/lib/Types"
import {fetchAllEvaluations} from "@/services/evaluations/api"
import {
    fetchAbTestingEvaluationResult,
    fetchSingleModelEvaluationResult,
} from "@/services/human-evaluations/api"
import {ChartDonut, ListChecks, TestTube} from "@phosphor-icons/react"
import {Tabs, TabsProps, Typography} from "antd"
import React, {useEffect, useState} from "react"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        display: "flex",
        flexDirection: "column",
        gap: theme.marginLG,
    },
    title: {
        fontSize: theme.fontSizeLG,
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeightHeading4,
    },
    evaluationTabContainer: {
        "& .ant-tabs-nav": {
            marginBottom: theme.marginLG,
        },
        "& .ant-tabs-tab-btn": {
            display: "flex",
            alignItems: "center",
            "& .ant-tabs-tab-icon": {
                display: "flex",
            },
        },
    },
}))

const EvaluationsPage = () => {
    const appId = useAppId()
    const classes = useStyles()
    const [autoEvaluationList, setAutoEvaluationList] = useState<_Evaluation[]>([])
    const [singleModelEvalList, setSingleModelEvalList] = useState<
        SingleModelEvaluationListTableDataType[]
    >([])
    const [abTestingEvalList, setAbTestingEvalList] = useState<HumanEvaluationListTableDataType[]>(
        [],
    )
    const [selectedEvaluation, setSelectedEvaluation] = useQueryParam(
        "selectedEvaluation",
        "auto_evaluation",
    )
    const [fetchingEvaluations, setFetchingEvaluations] = useState(false)

    useEffect(() => {
        if (!appId) return

        setFetchingEvaluations(true)
        Promise.all([
            fetchAllEvaluations(appId),
            fetchSingleModelEvaluationResult(appId),
            fetchAbTestingEvaluationResult(appId),
        ])
            .then(([autoEvalResult, singleModelEvalResult, abTestingEvalResult]) => {
                setAutoEvaluationList(autoEvalResult)
                setSingleModelEvalList(singleModelEvalResult as any)
                setAbTestingEvalList(abTestingEvalResult)
            })
            .catch(console.error)
            .finally(() => setFetchingEvaluations(false))
    }, [appId])

    const items: TabsProps["items"] = [
        {
            key: "auto_evaluation",
            label: "Automatic Evaluation",
            icon: <ChartDonut size={16} />,
            children: (
                <AutoEvaluation
                    evaluationList={autoEvaluationList}
                    fetchingEvaluations={fetchingEvaluations}
                />
            ),
        },
        {
            key: "ab_testing_evaluation",
            label: "A/B Testing Evaluation",
            icon: <TestTube size={16} />,
            children: (
                <AbTestingEvaluation
                    evaluationList={abTestingEvalList}
                    fetchingEvaluations={fetchingEvaluations}
                />
            ),
        },
        {
            key: "single_model_evaluation",
            label: "Single Model Evaluation",
            icon: <ListChecks size={16} />,
            children: (
                <SingleModelEvaluation
                    evaluationList={singleModelEvalList}
                    fetchingEvaluations={fetchingEvaluations}
                />
            ),
        },
    ]

    return (
        <div className={classes.container}>
            <Typography.Text className={classes.title}>Evaluations</Typography.Text>

            <Tabs
                className={classes.evaluationTabContainer}
                items={items}
                defaultActiveKey={selectedEvaluation}
                onChange={setSelectedEvaluation}
            />
        </div>
    )
}

export default EvaluationsPage
