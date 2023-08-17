import {useState, useEffect} from "react"
import type {ColumnType} from "antd/es/table"
import {CaretRightOutlined, ContainerOutlined, LeftOutlined, RightOutlined} from "@ant-design/icons"
import {Button, Input, Space, Spin, Table} from "antd"
import {Variant, Parameter} from "@/lib/Types"
import {updateEvaluationScenario, callVariant} from "@/lib/services/api"
import {useVariant} from "@/lib/hooks/useVariant"
import {useRouter} from "next/router"
import {EvaluationFlow} from "@/lib/enums"
import {fetchVariants} from "@/lib/services/api"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles({
    evaluationContainer: {
        "& > h1": {
            textAlign: "center",
        },
    },
    evaluationView: {
        display: "flex",
        margin: "20px 0",
        alignItems: "center",
    },
    evaluationBox: {
        flex: 1,
        border: "1px solid #000",
        borderRadius: 10,
        margin: 10,
        display: "flex",
        padding: 20,
        gap: 10,
        "& > div:nth-child(1)": {
            display: "flex",
            alignItems: "flex-start",
            flexDirection: "column",
            "& input": {
                width: "100%",
                marginBottom: 10,
            },
        },
        "& > div:nth-child(2)": {
            flex: 1,
        },
    },
    evaluationBtns: {
        alignItems: "center",
        justifyContent: "center",
        display: "flex",
    },
    variantBox: {
        display: "flex",
        gap: 10,
    },
    variant: {
        width: "100%",
        maxWidth: 400,
        margin: "0 auto",
    },
    variantData: {
        border: "1px solid #000",
        borderRadius: 10,
        margin: "20px auto",
        width: "100%",
        overflowY: "auto",
        padding: 10,
        height: 350,
    },
    empty: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        margin: "20px 0",
        "& svg": {
            fontSize: 40,
        },
        "& p": {
            fontSize: 20,
        },
    },
})

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

    const variantData = variants.map((variant: Variant) => {
        const {inputParams, optParams, URIPath, isLoading, isError, error} = useVariant(
            appName,
            variant,
        )

        return {
            inputParams,
            optParams,
            URIPath,
            isLoading,
            isError,
            error,
        }
    })

    const [currentSlide, setCurrentSlide] = useState(0)

    const handlePreviousSlide = () => {
        if (currentSlide > 0) {
            setCurrentSlide(currentSlide - 1)
        }
    }

    const handleNextSlide = () => {
        if (currentSlide < evaluationScenarios.length - 1) {
            setCurrentSlide(currentSlide + 1)
        }
    }

    const currentScenario = evaluationScenarios[currentSlide]

    const [rows, setRows] = useState<ABTestingEvaluationTableRow[]>([])

    useEffect(() => {
        if (evaluationScenarios) {
            setRows(evaluationScenarios)
        }
    }, [evaluationScenarios])

    const handleInputChange = (
        e: React.ChangeEvent<HTMLInputElement>,
        rowIndex: number,
        inputFieldKey: number,
    ) => {
        const newRows = [...rows]
        newRows[rowIndex].inputs[inputFieldKey].input_value = e.target.value
        setRows(newRows)
    }

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
        const promises: Promise<void>[] = []

        for (let i = 0; i < rows.length; i++) {
            promises.push(runEvaluation(i))
        }

        Promise.all(promises)
            .then(() => console.log("All functions finished."))
            .catch((err) => console.error("An error occurred:", err))
    }

    const runEvaluation = async (rowIndex: number) => {
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
                    variantData[idx].inputParams,
                    variantData[idx].optParams,
                    variantData[idx].URIPath,
                )
                setRowValue(rowIndex, columnName, result)
                setRowValue(rowIndex, "evaluationFlow", EvaluationFlow.COMPARISON_RUN_STARTED)
            } catch (e) {
                console.error("Error:", e)
            }
        })
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

    return (
        <>
            {evaluationScenarios.length ? (
                <div className={classes.evaluationContainer}>
                    <h1>
                        Evaluation {currentSlide + 1}/{evaluationScenarios.length}
                    </h1>

                    <div className={classes.evaluationView}>
                        <Button
                            onClick={handlePreviousSlide}
                            icon={<LeftOutlined />}
                            disabled={currentSlide === 0}
                        />

                        <div className={classes.evaluationBox}>
                            <div>
                                <p>
                                    <span> Inputs (Test set: </span>
                                    <span
                                        style={{
                                            backgroundColor: "rgb(201 255 216)",
                                            color: "rgb(0 0 0)",
                                            padding: 4,
                                            borderRadius: 5,
                                        }}
                                    >
                                        {evaluation.testset.name}
                                    </span>
                                    <span> )</span>
                                </p>
                                {currentScenario?.inputs.map((input, index) => (
                                    <div key={index}>
                                        <Input
                                            placeholder={input.input_name}
                                            value={input.input_value}
                                            onChange={(e) =>
                                                handleInputChange(e, currentSlide, index)
                                            }
                                        />
                                        <Button
                                            onClick={() => runEvaluation(currentSlide, index)}
                                            icon={<CaretRightOutlined />}
                                        >
                                            Run
                                        </Button>
                                    </div>
                                ))}
                            </div>

                            <div>
                                <div className={classes.variantBox}>
                                    <div className={classes.variant}>
                                        <p style={{textAlign: "center"}}>
                                            App variant:{" "}
                                            <span
                                                style={{
                                                    backgroundColor: "rgb(201 255 216)",
                                                    color: "rgb(0 0 0)",
                                                    padding: 4,
                                                    borderRadius: 5,
                                                }}
                                            >
                                                {variants[0].variantName}
                                            </span>
                                        </p>

                                        <div className={classes.variantData}>
                                            {rows[currentSlide]?.columnData0}
                                        </div>
                                    </div>
                                    <div className={classes.variant}>
                                        <p style={{textAlign: "center"}}>
                                            App variant:{" "}
                                            <span
                                                style={{
                                                    backgroundColor: "rgb(201 255 216)",
                                                    color: "rgb(0 0 0)",
                                                    padding: 4,
                                                    borderRadius: 5,
                                                }}
                                            >
                                                {variants[1].variantName}
                                            </span>
                                        </p>

                                        <div className={classes.variantData}>
                                            {rows[currentSlide]?.columnData1}
                                        </div>
                                    </div>
                                </div>

                                <Spin spinning={rows[currentSlide]?.vote === "loading"}>
                                    <Space className={classes.evaluationBtns} size={20}>
                                        {variants.map((variant, idx) => (
                                            <Button
                                                key={idx}
                                                type={
                                                    rows[currentSlide]?.vote === variant.variantName
                                                        ? "primary"
                                                        : "default"
                                                }
                                                disabled={
                                                    rows[currentSlide]?.evaluationFlow ===
                                                        EvaluationFlow.COMPARISON_RUN_STARTED ||
                                                    rows[currentSlide]?.vote !== ""
                                                        ? false
                                                        : true
                                                }
                                                onClick={() =>
                                                    handleVoteClick(
                                                        currentSlide,
                                                        variant?.variantName,
                                                    )
                                                }
                                            >
                                                {`Variant: ${variant.variantName}`}
                                            </Button>
                                        ))}
                                        <Button
                                            type={
                                                rows[currentSlide]?.vote === "0"
                                                    ? "primary"
                                                    : "default"
                                            }
                                            disabled={
                                                rows[currentSlide]?.evaluationFlow ===
                                                    EvaluationFlow.COMPARISON_RUN_STARTED ||
                                                rows[currentSlide]?.vote !== ""
                                                    ? false
                                                    : true
                                            }
                                            danger
                                            onClick={() => handleVoteClick(currentSlide, "0")}
                                        >
                                            Both are bad
                                        </Button>
                                    </Space>
                                </Spin>
                            </div>
                        </div>

                        <Button
                            onClick={handleNextSlide}
                            icon={<RightOutlined />}
                            disabled={currentSlide === evaluationScenarios.length - 1}
                        />
                    </div>
                </div>
            ) : (
                <div className={classes.empty}>
                    <ContainerOutlined />
                    <p>No Data</p>
                </div>
            )}
        </>
    )
}

export default ABTestingEvaluationTable
