import {useAppTheme} from "@/components/Layout/ThemeContextProvider"
import {useAppId} from "@/hooks/useAppId"
import {JSSTheme, _Evaluation, _EvaluationScenario} from "@/lib/Types"
import {fetchAllEvaluationScenarios, fetchEvaluation} from "@/services/evaluations"
import {DeleteOutlined, DownloadOutlined} from "@ant-design/icons"
import {ColDef} from "ag-grid-community"
import {AgGridReact} from "ag-grid-react"
import {Spin, Typography} from "antd"
import dayjs from "dayjs"
import {useRouter} from "next/router"
import React, {useEffect, useMemo, useState} from "react"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    header: {
        marginTop: "1rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",

        "& > h3": {
            margin: 0,
        },

        "& > :last-child": {
            display: "flex",
            alignItems: "center",
            gap: "1rem",
        },
    },
    date: {
        fontSize: "0.75rem",
        color: theme.colorTextSecondary,
        display: "inline-block",
        marginBottom: "1rem",
    },
    table: {
        height: 500,
    },
}))

interface Props {}

const EvaluationScenarios: React.FC<Props> = () => {
    const router = useRouter()
    const appId = useAppId()
    const classes = useStyles()
    const {appTheme} = useAppTheme()
    const evaluationId = router.query.evaluation_id as string
    const [scenarios, setScenarios] = useState<_EvaluationScenario[]>([])
    const [evalaution, setEvaluation] = useState<_Evaluation>()
    const [fetching, setFetching] = useState(false)

    const colDefs = useMemo(() => {
        const colDefs: ColDef<_EvaluationScenario>[] = []
        if (!scenarios.length || !evalaution) return colDefs

        scenarios[0]?.inputs.forEach((input, index) => {
            colDefs.push({
                headerName: `Input: ${input.name}`,
                field: `inputs.${index}`,
                valueGetter: (params) => {
                    return params.data?.inputs[index].value || ""
                },
            })
        })
        colDefs.push({
            headerName: "Expected Output",
            field: "correct_answer",
            valueGetter: (params) => {
                return params.data?.correct_answer?.value || ""
            },
        })
        evalaution?.variants.forEach((variant, index) => {
            colDefs.push({
                headerName: `Output (${variant.variantName})`,
                field: `outputs.${index}`,
                valueGetter: (params) => {
                    return params.data?.outputs[index].value || ""
                },
            })
        })
        scenarios[0]?.evaluators_configs.forEach((config, index) => {
            colDefs.push({
                headerName: `Evaluator: ${config.name}`,
                field: `results`,
                valueGetter: (params) => {
                    return (
                        params.data?.results.find(
                            (item) => item.evaluator.key === config.evaluator_key,
                        )?.result || ""
                    )
                },
            })
        })
        return colDefs
    }, [evalaution, scenarios])

    const fetcher = () => {
        setFetching(true)
        Promise.all([
            fetchAllEvaluationScenarios(appId, evaluationId),
            fetchEvaluation(evaluationId),
        ])
            .then(([scenarios, evaluation]) => {
                setScenarios(scenarios)
                setEvaluation(evaluation)
            })
            .catch(console.error)
            .finally(() => setFetching(false))
    }

    useEffect(() => {
        fetcher()
    }, [appId, evaluationId])

    return (
        <div>
            <div className={classes.header}>
                <Typography.Title level={3}>
                    Evaluation Result (Testset: {evalaution?.testset.name || ""})
                </Typography.Title>
                <div>
                    <DownloadOutlined />
                    <DeleteOutlined />
                </div>
            </div>
            <Typography.Text className={classes.date}>
                {dayjs(evalaution?.created_at).format("MM DD YYYY | H:M a")}
            </Typography.Text>

            <Spin spinning={fetching}>
                <div
                    className={`${
                        appTheme === "dark" ? "ag-theme-alpine-dark" : "ag-theme-alpine"
                    } ${classes.table}`}
                >
                    <AgGridReact<_EvaluationScenario>
                        rowData={scenarios}
                        columnDefs={colDefs}
                        getRowId={(params) => params.data.id}
                    />
                </div>
            </Spin>
        </div>
    )
}

export default EvaluationScenarios
