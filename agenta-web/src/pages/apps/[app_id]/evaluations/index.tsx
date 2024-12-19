import AbTestingEvaluation from "@/components/HumanEvaluations/AbTestingEvaluation"
import AutoEvaluation from "@/components/pages/evaluations/autoEvaluation/AutoEvaluation"
import SingleModelEvaluation from "@/components/HumanEvaluations/SingleModelEvaluation"
import {useQueryParam} from "@/hooks/useQuery"
import {_Evaluation, JSSTheme} from "@/lib/Types"
import {ChartDonut, ListChecks, TestTube} from "@phosphor-icons/react"
import {Tabs, TabsProps, Typography} from "antd"
import {createUseStyles} from "react-jss"

import "@ag-grid-community/styles/ag-grid.css"
import "@ag-grid-community/styles/ag-theme-alpine.css"

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
    const classes = useStyles()
    const [selectedEvaluation, setSelectedEvaluation] = useQueryParam(
        "selectedEvaluation",
        "auto_evaluation",
    )

    const items: TabsProps["items"] = [
        {
            key: "auto_evaluation",
            label: "Automatic Evaluation",
            icon: <ChartDonut size={16} />,
            children: <AutoEvaluation />,
        },
        {
            key: "human_annotation",
            label: "Human annotation",
            icon: <ListChecks size={16} />,
            children: <SingleModelEvaluation viewType="evaluation" />,
        },
        {
            key: "human_ab_testing",
            label: "Human A/B Testing",
            icon: <TestTube size={16} />,
            children: <AbTestingEvaluation viewType="evaluation" />,
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
