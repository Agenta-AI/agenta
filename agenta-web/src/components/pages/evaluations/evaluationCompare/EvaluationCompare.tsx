import {useAppTheme} from "@/components/Layout/ThemeContextProvider"
import {useAppId} from "@/hooks/useAppId"
import {JSSTheme, _Evaluation, _EvaluationScenario} from "@/lib/Types"
import {fetchAllEvaluationScenarios, fetchEvaluation} from "@/services/evaluations"
import {ColDef} from "ag-grid-community"
import {AgGridReact} from "ag-grid-react"
import {Space, Spin, Tag, Typography} from "antd"
import dayjs from "dayjs"
import {useRouter} from "next/router"
import React, {useEffect, useMemo, useState} from "react"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    header: {
        margin: "1rem 0",
        "& > h3": {
            textAlign: "center",
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

const EvaluationCompareMode: React.FC<Props> = () => {
    const router = useRouter()
    const appId = useAppId()
    const classes = useStyles()
    const {appTheme} = useAppTheme()
    const evaluationIds = router.query.evaluations as string
    const [scenarios, setScenarios] = useState<_EvaluationScenario[]>([])
    const [evalaution, setEvaluation] = useState<_Evaluation[]>()
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

        evalaution.map(
            (evalaution) =>
                evalaution?.variants.forEach((variant, index) => {
                    colDefs.push({
                        headerName: `Output (${variant.variantName})`,
                        field: `outputs.${index}`,
                        valueGetter: (params) => {
                            return params.data?.outputs[index].value || ""
                        },
                    })
                }),
        )

        scenarios.map(
            (scenario) =>
                scenario?.evaluators_configs.forEach((config, index) => {
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
                }),
        )

        return colDefs
    }, [evalaution, scenarios])

    useEffect(() => {
        const fetcher = async () => {
            setFetching(true)

            try {
                const evaluationIdsArray = evaluationIds?.split(",") || []

                const fetchPromises = evaluationIdsArray.map((evalId) => {
                    return Promise.all([
                        fetchAllEvaluationScenarios(appId, evalId),
                        fetchEvaluation(evalId),
                    ])
                })

                const results = await Promise.all(fetchPromises)
                const fetchedScenarios = results.map(([[scenarios]]) => scenarios)
                const fetchedEvaluations = results.map(([_, evaluation]) => evaluation)

                setScenarios(fetchedScenarios)
                setEvaluation(fetchedEvaluations)
            } catch (error) {
                console.error(error)
            } finally {
                setFetching(false)
            }
        }

        fetcher()
    }, [appId, evaluationIds])

    const handleDeleteVariant = (variantId: string) => {
        console.log(variantId)
    }

    return (
        <div>
            <div className={classes.header}>
                <Typography.Title level={3}>
                    Testset: {evalaution ? evalaution[0]?.testset.name : ""}
                </Typography.Title>
                <Space>
                    <Typography.Text>Variants:</Typography.Text>
                    {evalaution?.map(
                        (evalaution) =>
                            evalaution?.variants?.map((variant) => (
                                <Tag
                                    color="blue"
                                    key={variant.variantId}
                                    onClose={() => handleDeleteVariant(variant.variantId)}
                                    closable
                                >
                                    {variant.variantName}
                                </Tag>
                            )),
                    )}
                </Space>
            </div>

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

export default EvaluationCompareMode
