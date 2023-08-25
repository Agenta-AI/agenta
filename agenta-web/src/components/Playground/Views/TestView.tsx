import React, {Dispatch, SetStateAction, useContext, useEffect, useRef, useState} from "react"
import {Button, Input, Card, Row, Col, Space} from "antd"
import {CaretRightOutlined, PlusOutlined} from "@ant-design/icons"
import {callVariant} from "@/lib/services/api"
import {Parameter} from "@/lib/Types"
import {renameVariables} from "@/lib/helpers/utils"
import {TestContext} from "../TestContextProvider"
import LoadTestsModal from "../LoadTestsModal"
import AddToTestSetDrawer from "../AddToTestSetDrawer/AddToTestSetDrawer"
import {DeleteOutlined} from "@ant-design/icons"
import {createUseStyles} from "react-jss"

const useStylesBox = createUseStyles({
    card: {
        marginTop: 16,
        border: "1px solid #ccc",
        marginRight: "24px",
        marginLeft: "12px",
        "& .ant-card-body": {
            padding: "4px 16px",
            border: "0px solid #ccc",
        },
    },
    rowHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
    },
    row1: {
        marginTop: 0,
        "& textarea": {
            height: "100%",
            width: "100%",
            marginTop: "16px",
        },
    },
    row2: {
        marginTop: "16px",
    },
    row2Col: {
        justifyContent: "flex-end",
        display: "flex",
        gap: "0.75rem",
        "& button:nth-of-type(2)": {
            width: "100px",
        },
    },
    row3: {
        margin: "16px 0",
        "& textarea": {
            height: "100%",
            width: "100%",
        },
    },
})

const useStylesApp = createUseStyles({
    testView: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginRight: "24px",
        marginLeft: "12px",
        "& > h2": {
            padding: "0px",
            marginBottom: "8px",
        },
    },
    runAllBtn: {
        backgroundColor: "green",
    },
    addBtn: {
        marginTop: "16px",
        width: "200px",
        marginBottom: "24px",
        marginLeft: "12px",
    },
})

interface TestViewProps {
    URIPath: string | null
    inputParams: Parameter[] | null
    optParams: Parameter[] | null
}

interface BoxComponentProps {
    URIPath: string | null
    inputParams: Parameter[] | null
    optParams: Parameter[] | null
    testData: Record<string, string>
    result: string
    onInputParamChange: (paramName: string, newValue: string) => void
    onResultChange: (result: string) => void
    onAddToTestset: (params: Record<string, string>) => void
    onDelete?: () => void
    getRunFunction?: (fn: Function) => void
}

const BoxComponent: React.FC<BoxComponentProps> = ({
    URIPath,
    inputParams,
    optParams,
    testData,
    result,
    onInputParamChange,
    onResultChange,
    onAddToTestset,
    onDelete,
    getRunFunction,
}) => {
    const classes = useStylesBox()
    const {TextArea} = Input
    const [loading, setLoading] = useState(false)

    const handleRun = async () => {
        try {
            setLoading(true)

            const res = await callVariant(
                testData,
                inputParams || [],
                optParams || [],
                URIPath || "",
            )

            onResultChange(res)
        } catch (e) {
            onResultChange(
                "The code has resulted in the following error: \n\n --------------------- \n" +
                    e +
                    "\n---------------------\n\nPlease update your code, and re-serve it using cli and try again.\n\nFor more information please read https://docs.agenta.ai/howto/how-to-debug\n\nIf you believe this is a bug, please create a new issue here: https://github.com/Agenta-AI/agenta/issues/new?title=Issue%20in%20playground",
            )
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (getRunFunction) getRunFunction(handleRun)
    }, [handleRun])

    if (!inputParams) {
        return <div>Loading...</div>
    }

    const inputParamsNames = inputParams.map((param) => param.name)

    const handleAddToTestset = () => {
        const params: Record<string, string> = {}
        inputParamsNames.forEach((name) => {
            params[name] = testData[name] || ""
        })
        params.correct_answer = result

        onAddToTestset(params)
    }

    return (
        <Card className={classes.card}>
            <Row className={classes.rowHeader}>
                <h4>Input parameters</h4>
                {onDelete && <Button icon={<DeleteOutlined />} onClick={onDelete}></Button>}
            </Row>

            <Row className={classes.row1}>
                {inputParamsNames.map((key, index) => (
                    <TextArea
                        key={index}
                        value={testData[key]}
                        placeholder={renameVariables(key)}
                        onChange={(e) => onInputParamChange(key, e.target.value)}
                    />
                ))}
            </Row>
            <Row className={classes.row2}>
                <Col span={24} className={classes.row2Col}>
                    <Button
                        shape="round"
                        icon={<PlusOutlined />}
                        onClick={handleAddToTestset}
                        disabled={loading}
                    >
                        Add to Test Set
                    </Button>
                    <Button
                        type="primary"
                        shape="round"
                        icon={<CaretRightOutlined />}
                        onClick={handleRun}
                        loading={loading}
                    >
                        Run
                    </Button>
                </Col>
            </Row>
            <Row className={classes.row3}>
                <TextArea
                    value={loading ? "Loading..." : result}
                    rows={6}
                    placeholder="Results will be shown here"
                    disabled
                />
            </Row>
        </Card>
    )
}

const App: React.FC<TestViewProps> = ({inputParams, optParams, URIPath}) => {
    const {testList, setTestList} = useContext(TestContext)
    const [resultsList, setResultsList] = useState<string[]>(testList.map(() => ""))
    const [params, setParams] = useState<Record<string, string> | null>(null)
    const runners = useRef<Function[]>([])
    const classes = useStylesApp()

    const handleRunAll = () => {
        runners.current.forEach((runner) => runner())
    }

    const handleAddRow = () => {
        setTestList([...testList, {}])
        setResultsList([...resultsList, ""])
    }

    const handleDeleteRow = (testIndex: number) => {
        setTestList((prevTestList) => prevTestList.filter((_, index) => index !== testIndex))
        setResultsList((prevResultsList) =>
            prevResultsList.filter((_, index) => index !== testIndex),
        )
    }

    const handleResultChange = (result: string, index: number) => {
        setResultsList((prevState) => {
            return prevState.map((prevResult, prevIndex) =>
                prevIndex === index ? result : prevResult,
            )
        })
    }

    const handleInputParamChange = (paramName: string, value: string, index: number) => {
        setTestList((prevState) => {
            const newState = [...prevState]
            newState[index] = {...newState[index], [paramName]: value}
            return newState
        })
    }

    const onLoadTests = (tests: Record<string, string>[], shouldReplace: boolean) => {
        const results = tests.map((test) => test?.correct_answer || "")
        if (shouldReplace) {
            setTestList(tests)
            setResultsList(results)
        } else {
            setTestList((prev) => [...prev, ...tests])
            setResultsList((prev) => [...prev, ...results])
        }
    }

    return (
        <div>
            <div className={classes.testView}>
                <h2>2. Preview and test</h2>
                <Space size={10}>
                    <LoadTestsModal onLoad={onLoadTests} />

                    <Button
                        type="primary"
                        size="middle"
                        className={classes.runAllBtn}
                        onClick={handleRunAll}
                    >
                        Run all
                    </Button>
                </Space>
            </div>

            {testList.map((testData, index) => (
                <BoxComponent
                    key={index}
                    URIPath={URIPath}
                    inputParams={inputParams}
                    optParams={optParams}
                    testData={testData}
                    result={resultsList[index]}
                    onResultChange={(result) => handleResultChange(result, index)}
                    onInputParamChange={(paramName, value) =>
                        handleInputParamChange(paramName, value, index)
                    }
                    onAddToTestset={setParams}
                    onDelete={testList.length >= 2 ? () => handleDeleteRow(index) : undefined}
                    getRunFunction={(runner) => (runners.current[index] = runner)}
                />
            ))}
            <Button
                type="primary"
                size="large"
                icon={<PlusOutlined />}
                onClick={handleAddRow}
                className={classes.addBtn}
            >
                Add Row
            </Button>

            <AddToTestSetDrawer
                open={!!params}
                onClose={() => setParams(null)}
                destroyOnClose
                params={params || {}}
            />
        </div>
    )
}

export default App
