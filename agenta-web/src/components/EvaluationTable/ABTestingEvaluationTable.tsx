import {useState, useEffect} from "react"
import type {ColumnType} from "antd/es/table"
import {CaretRightOutlined, LineChartOutlined} from "@ant-design/icons"
import {Button, Col, Input, Row, Space, Spin, Table, Typography, message} from "antd"
import {
    updateEvaluationScenario,
    callVariant,
    fetchEvaluationResults,
    updateEvaluation,
} from "@/lib/services/api"
import {useVariants} from "@/lib/hooks/useVariant"
import {useRouter} from "next/router"
import {EvaluationFlow} from "@/lib/enums"
import {fetchVariants} from "@/lib/services/api"
import {createUseStyles} from "react-jss"
import {convertToCsv, downloadCsv} from "@/lib/helpers/utils"

const {Title} = Typography

interface EvaluationTableProps {
    evaluation: any
    columnsCount: number
    evaluationScenarios: ABTestingEvaluationTableRow[]
}

interface ABTestingEvaluationTableRow {
    id?: string
    inputs: {
        input_name: string
        input_value: string
    }[]
    outputs: {
        variant_name: string
        variant_output: string
    }[]
    columnData0: string
    columnData1: string
    vote: string
    evaluationFlow: EvaluationFlow
}
/**
 *
 * @param evaluation - Evaluation object
 * @param evaluationScenarios - Evaluation rows
 * @param columnsCount - Number of variants to compare face to face (per default 2)
 * @returns
 */

const useStyles = createUseStyles({
    appVariant: {
        backgroundColor: "rgb(201 255 216)",
        color: "rgb(0 0 0)",
        padding: 4,
        borderRadius: 5,
    },
    inputTestContainer: {
        display: "flex",
        justifyContent: "space-between",
    },
    inputTest: {
        backgroundColor: "rgb(201 255 216)",
        color: "rgb(0 0 0)",
        padding: 4,
        borderRadius: 5,
    },
    inputTestBtn: {
        width: "100%",
        display: "flex",
        justifyContent: "flex-end",
        "& button": {
            marginLeft: 10,
        },
    },
    recordInput: {
        marginBottom: 10,
    },
    // title: {
    //     fontSize: "2rem !important",
    //     marginBottom: "20px !important",
    // },
})

const ABTestingEvaluationTable: React.FC<EvaluationTableProps> = ({
    evaluation,
    evaluationScenarios,
    columnsCount,
}) => {
    const classes = useStyles()
    const router = useRouter()
    const appName = Array.isArray(router.query.app_name)
        ? router.query.app_name[0]
        : router.query.app_name || ""
    const variants = evaluation.variants

    const variantData = useVariants(appName, variants)

    const [rows, setRows] = useState<ABTestingEvaluationTableRow[]>([])
    const [evaluationStatus, setEvaluationStatus] = useState<EvaluationFlow>(evaluation.status)
    const [evaluationResults, setEvaluationResults] = useState<any>(null)
    const [rowData, setRowData] = useState<
        {appVariant1: string; inputs: string; vote: string; appVariant0: string}[]
    >([])
    const [columnDefs, setColumnDefs] = useState<{field: string; [key: string]: any}[]>([])

    useEffect(() => {
        if (evaluationScenarios) {
            setRows(evaluationScenarios)
        }
    }, [evaluationScenarios])

    useEffect(() => {
        const getRows = rows.map((data) => {
            return {
                inputs: data.inputs[0].input_value,
                appVariant0: data?.columnData0
                    ? data?.columnData0
                    : data.outputs[0]?.variant_output,
                appVariant1: data?.columnData1
                    ? data?.columnData1
                    : data.outputs[1]?.variant_output,
                vote: data.vote,
            }
        })
        setRowData(getRows)
    }, [rows])

    useEffect(() => {
        if (Array.isArray(rowData) && rowData.length > 0) {
            setColumnDefs(
                Object.keys(rowData[0]).map((key) => ({
                    field: key,
                })),
            )
        }
    }, [rowData])

    const handleInputChange = (
        e: React.ChangeEvent<HTMLInputElement>,
        rowIndex: number,
        inputFieldKey: number,
    ) => {
        const newRows = [...rows]
        newRows[rowIndex].inputs[inputFieldKey].input_value = e.target.value
        setRows(newRows)
    }

    useEffect(() => {
        if (evaluationStatus === EvaluationFlow.EVALUATION_FINISHED) {
            fetchEvaluationResults(evaluation.id)
                .then((data) => setEvaluationResults(data))
                .catch((err) => console.error("Failed to fetch results:", err))
                .then(() => {
                    updateEvaluation(evaluation.id, {status: EvaluationFlow.EVALUATION_FINISHED})
                })
                .catch((err) => console.error("Failed to fetch results:", err))
        }
    }, [evaluationStatus, evaluation.id])

    const handleVoteClick = (rowIndex: number, vote: string) => {
        const evaluation_scenario_id = rows[rowIndex].id

        if (evaluation_scenario_id) {
            setRowValue(rowIndex, "vote", "loading")
            // TODO: improve this to make it dynamic
            const appVariantNameX = variants[0].variantName
            const appVariantNameY = variants[1].variantName
            const outputVariantX = rows[rowIndex].columnData0
            const outputVariantY = rows[rowIndex].columnData1
            const data = {
                vote: vote,
                outputs: [
                    {variant_name: appVariantNameX, variant_output: outputVariantX},
                    {variant_name: appVariantNameY, variant_output: outputVariantY},
                ],
            }

            updateEvaluationScenario(
                evaluation.id,
                evaluation_scenario_id,
                data,
                evaluation.evaluationType,
            )
                .then((data) => {
                    setRowValue(rowIndex, "vote", vote)
                })
                .catch((err) => {
                    console.error(err)
                })
        }
    }

    const runAllEvaluations = async () => {
        setEvaluationStatus(EvaluationFlow.EVALUATION_STARTED)
        const promises: Promise<void>[] = []

        for (let i = 0; i < rows.length; i++) {
            promises.push(runEvaluation(i, rows.length - 1))
        }

        Promise.all(promises)
            .then(() => {
                console.log("All functions finished.")
                setEvaluationStatus(EvaluationFlow.EVALUATION_FINISHED)
            })
            .catch((err) => console.error("An error occurred:", err))
    }

    const runEvaluation = async (rowIndex: number, count: number = 1) => {
        const inputParamsDict = rows[rowIndex].inputs.reduce((acc: {[key: string]: any}, item) => {
            acc[item.input_name] = item.input_value
            return acc
        }, {})

        const columnsDataNames = ["columnData0", "columnData1"]
        columnsDataNames.forEach(async (columnName: any, idx: number) => {
            setRowValue(rowIndex, columnName, "loading...")
            try {
                let result = await callVariant(
                    inputParamsDict,
                    variantData[idx].inputParams!,
                    variantData[idx].optParams!,
                    variantData[idx].URIPath!,
                )
                setRowValue(rowIndex, columnName, result)
                setRowValue(rowIndex, "evaluationFlow", EvaluationFlow.COMPARISON_RUN_STARTED)
                if (idx === columnsDataNames.length - 1) {
                    if (count === 1 || count === rowIndex) {
                        message.success("Evaluation Results Saved")
                    }
                }
            } catch (e) {
                setRowValue(rowIndex, columnName, "")
            }
        })
    }

    const handleExportClick = () => {
        const csvData = convertToCsv(
            rowData,
            columnDefs.map((col) => col.field),
        )
        const filename = `${evaluation.evaluationType}.csv`
        downloadCsv(csvData, filename)
    }

    const setRowValue = (
        rowIndex: number,
        columnKey: keyof ABTestingEvaluationTableRow,
        value: any,
    ) => {
        const newRows = [...rows]
        newRows[rowIndex][columnKey] = value as never
        setRows(newRows)
    }

    const dynamicColumns: ColumnType<ABTestingEvaluationTableRow>[] = Array.from(
        {length: columnsCount},
        (_, i) => {
            const columnKey = `columnData${i}`

            return {
                title: (
                    <div>
                        <span>App Variant: </span>
                        <span className={classes.appVariant}>
                            {variants ? variants[i].variantName : ""}
                        </span>
                    </div>
                ),
                dataIndex: columnKey,
                key: columnKey,
                width: "20%",
                render: (text: any, record: ABTestingEvaluationTableRow, rowIndex: number) => {
                    if (record.outputs && record.outputs.length > 0) {
                        const outputValue = record.outputs.find(
                            (output: any) => output.variant_name === variants[i].variantName,
                        )?.variant_output
                        return <div>{outputValue}</div>
                    }
                    return text
                },
            }
        },
    )

    const columns = [
        {
            key: "1",
            title: (
                <div className={classes.inputTestContainer}>
                    <div>
                        <span> Inputs (Test set: </span>
                        <span className={classes.inputTest}>{evaluation.testset.name}</span>
                        <span> )</span>
                    </div>
                    <Button size="small" onClick={runAllEvaluations} icon={<CaretRightOutlined />}>
                        Run All
                    </Button>
                </div>
            ),
            dataIndex: "inputs",
            render: (text: any, record: ABTestingEvaluationTableRow, rowIndex: number) => (
                <div>
                    {record &&
                        record.inputs &&
                        record.inputs.length && // initial value of inputs is array with 1 element and variantInputs could contain more than 1 element
                        record.inputs.map((input: any, index: number) => (
                            <div className={classes.recordInput} key={index}>
                                <Input
                                    placeholder={input.input_name}
                                    value={input.input_value}
                                    onChange={(e) => handleInputChange(e, rowIndex, index)}
                                />
                            </div>
                        ))}

                    <div className={classes.inputTestBtn}>
                        <Button
                            onClick={() => runEvaluation(rowIndex)}
                            icon={<CaretRightOutlined />}
                        >
                            Run
                        </Button>
                    </div>
                </div>
            ),
        },
        ...dynamicColumns,
        {
            title: "Evaluate",
            dataIndex: "evaluate",
            key: "evaluate",
            width: 200,
            // fixed: 'right',
            render: (text: any, record: any, rowIndex: number) => (
                <Spin spinning={rows[rowIndex].vote === "loading" ? true : false}>
                    <Space>
                        <Button
                            type={record.vote === variants[0].variantName ? "primary" : "default"}
                            disabled={
                                record.evaluationFlow === EvaluationFlow.COMPARISON_RUN_STARTED ||
                                record.vote !== ""
                                    ? false
                                    : true
                            }
                            onClick={() => handleVoteClick(rowIndex, variants[0].variantName)}
                        >
                            {`Variant: ${variants[0].variantName}`}
                        </Button>
                        <Button
                            type={record.vote === variants[1].variantName ? "primary" : "default"}
                            disabled={
                                record.evaluationFlow === EvaluationFlow.COMPARISON_RUN_STARTED ||
                                record.vote !== ""
                                    ? false
                                    : true
                            }
                            onClick={() => handleVoteClick(rowIndex, variants[1].variantName)}
                        >
                            {`Variant: ${variants[1].variantName}`}
                        </Button>
                        <Button
                            type={record.vote === "0" ? "primary" : "default"}
                            disabled={
                                record.evaluationFlow === EvaluationFlow.COMPARISON_RUN_STARTED ||
                                record.vote !== ""
                                    ? false
                                    : true
                            }
                            danger
                            onClick={() => handleVoteClick(rowIndex, "0")}
                        >
                            Both are bad
                        </Button>
                    </Space>
                </Spin>
            ),
        },
    ]

    return (
        <div>
            <Title level={2}>A/B Testing Evaluation</Title>
            <div>
                <Row align="middle">
                    <Col span={12}>
                        <Button
                            onClick={handleExportClick}
                            icon={<LineChartOutlined />}
                            size="large"
                        >
                            Export
                        </Button>
                    </Col>
                </Row>
            </div>
            <Table
                dataSource={rows}
                columns={columns}
                pagination={false}
                rowClassName={() => "editable-row"}
                rowKey={(record) => record.id!}
            />
        </div>
    )
}

export default ABTestingEvaluationTable
