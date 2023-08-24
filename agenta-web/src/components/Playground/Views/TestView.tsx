import React, {Dispatch, SetStateAction, useContext, useState} from "react"
import {Button, Input, Card, Row, Col, Space} from "antd"
import {CaretRightOutlined, PlusOutlined} from "@ant-design/icons"
import {callVariant} from "@/lib/services/api"
import {Parameter} from "@/lib/Types"
import {renameVariables} from "@/lib/helpers/utils"
import {TestContext} from "../TestContextProvider"
import LoadTestsModal from "../LoadTestsModal"
import AddToTestSetDrawer from "../AddToTestSetDrawer/AddToTestSetDrawer"
import {DeleteOutlined} from "@ant-design/icons"

interface TestViewProps {
    URIPath: string | null
    inputParams: Parameter[] | null
    optParams: Parameter[] | null
}

interface BoxComponentProps {
    inputParams: Parameter[] | null
    testData: Record<string, string>
    testIndex: number
    setTestList: Dispatch<SetStateAction<Record<string, string>[]>>
    handleRun: (testData: Record<string, string>, testIndex: number) => Promise<void>
    results: string
    resultsList: string[]
    onAddToTestset: (params: Record<string, string>) => void
    handleDeleteRow: (testIndex: number) => void
}

const BoxComponent: React.FC<BoxComponentProps> = ({
    inputParams,
    testData,
    testIndex,
    setTestList,
    handleRun,
    results,
    resultsList,
    onAddToTestset,
    handleDeleteRow,
}) => {
    const {TextArea} = Input

    if (!inputParams) {
        return <div>Loading...</div>
    }

    const inputParamsNames = inputParams.map((param) => param.name)

    const handleInputParamValChange = (inputParamName: string, newValue: string) => {
        setTestList((prevState) => {
            const newState = [...prevState]

            newState[testIndex] = {...newState[testIndex], [inputParamName]: newValue}
            return newState
        })
    }

    const handleAddToTestset = () => {
        const params: Record<string, string> = {}
        inputParamsNames.forEach((name) => {
            params[name] = testData[name] || ""
        })
        params.correct_answer = results

        onAddToTestset(params)
    }

    return (
        <Card
            style={{
                marginTop: 16,
                border: "1px solid #ccc",
                marginRight: "24px",
                marginLeft: "12px",
            }}
            bodyStyle={{padding: "4px 16px", border: "0px solid #ccc"}}
        >
            <Row style={{display: "flex", alignItems: "center", justifyContent: "space-between"}}>
                <h4>Input parameters</h4>
                <Button
                    icon={<DeleteOutlined />}
                    onClick={() => handleDeleteRow(testIndex)}
                ></Button>
            </Row>

            <Row style={{marginTop: "0px"}}>
                {inputParamsNames.map((key, index) => (
                    <TextArea
                        key={index}
                        value={testData[key]}
                        placeholder={renameVariables(key)}
                        onChange={(e) => handleInputParamValChange(key, e.target.value)}
                        style={{height: "100%", width: "100%", marginTop: "16px"}}
                    />
                ))}
            </Row>
            <Row style={{marginTop: "16px"}}>
                <Col
                    span={24}
                    style={{justifyContent: "flex-end", display: "flex", gap: "0.75rem"}}
                >
                    <Button shape="round" icon={<PlusOutlined />} onClick={handleAddToTestset}>
                        Add to Test Set
                    </Button>
                    <Button
                        type="primary"
                        shape="round"
                        icon={<CaretRightOutlined />}
                        onClick={() => handleRun(testData, testIndex)}
                        style={{width: "100px"}}
                        loading={resultsList[testIndex] === "Loading..."}
                        disabled={resultsList[testIndex] === "Loading..."}
                    >
                        Run
                    </Button>
                </Col>
            </Row>
            <Row style={{marginTop: "16px", marginBottom: "16px"}}>
                <TextArea
                    value={results}
                    rows={6}
                    placeholder="Results will be shown here"
                    disabled
                    style={{
                        height: "100%",
                        width: "100%",
                    }}
                />
            </Row>
        </Card>
    )
}

const App: React.FC<TestViewProps> = ({inputParams, optParams, URIPath}) => {
    const {testList, setTestList} = useContext(TestContext)
    const [resultsList, setResultsList] = useState<string[]>(testList.map(() => ""))
    const [params, setParams] = useState<Record<string, string> | null>(null)

    const handleRun = async (testData: Record<string, string>, testIndex: number) => {
        try {
            const newResultsList = [...resultsList]
            newResultsList[testIndex] = "Loading..."
            setResultsList(newResultsList)

            const result = await callVariant(
                testData,
                inputParams || [],
                optParams || [],
                URIPath || "",
            )

            const newResultList2 = [...resultsList]
            newResultList2[testIndex] = result
            setResultsList(newResultList2)
        } catch (e) {
            const newResultsList = [...resultsList]
            newResultsList[testIndex] =
                "The code has resulted in the following error: \n\n --------------------- \n" +
                e +
                "\n---------------------\n\nPlease update your code, and re-serve it using cli and try again.\n\nFor more information please read https://docs.agenta.ai/howto/how-to-debug\n\nIf you believe this is a bug, please create a new issue here: https://github.com/Agenta-AI/agenta/issues/new?title=Issue%20in%20playground"
            setResultsList(newResultsList)
        }
    }

    const handleRunAll = async () => {
        const newResultsList = testList.map(() => "Loading...")
        setResultsList(testList.map(() => "Loading..."))
        try {
            const resultsPromises = testList.map(async (testData, index) => {
                return await callVariant(
                    testData,
                    inputParams || [],
                    optParams || [],
                    URIPath || "",
                )
            })
            const results = await Promise.all(resultsPromises)
            results.forEach((result, index) => {
                newResultsList[index] = result
            })
        } catch (e) {
            newResultsList.forEach((_, index) => {
                newResultsList[index] =
                    "The code has resulted in the following error: \n\n --------------------- \n" +
                    e +
                    "\n---------------------\n\nPlease update your code, and re-serve it using cli and try again.\n\nFor more information please read https://docs.agenta.ai/howto/how-to-debug\n\nIf you believe this is a bug, please create a new issue here: https://github.com/Agenta-AI/agenta/issues/new?title=Issue%20in%20playground"
            })
        }
        setResultsList(newResultsList)
    }

    const handleAddRow = () => {
        setTestList([...testList, {}])
        setResultsList([...resultsList, ""])
    }

    const handleSetNewTests: (tests: Record<string, string>[]) => void = (tests) => {
        setTestList([...tests])
        setResultsList(tests.map(() => ""))
    }

    const handleDeleteRow = (testIndex: number) => {
        if (resultsList.length < 2) return
        if (resultsList[testIndex] !== "") {
            setResultsList(resultsList.filter((_, index) => index !== testIndex))
        }
        const newTestList = testList.filter((_, index) => index !== testIndex)
        setTestList(newTestList)
    }

    return (
        <div>
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginRight: "24px",
                    marginLeft: "12px",
                }}
            >
                <h2 style={{padding: "0px", marginBottom: "8px"}}>2. Preview and test</h2>
                <Space size={10}>
                    <LoadTestsModal
                        setNewTests={handleSetNewTests}
                        addNewTests={handleSetNewTests}
                    />

                    <Button
                        type="primary"
                        size="middle"
                        style={{backgroundColor: "green"}}
                        onClick={handleRunAll}
                    >
                        Run all
                    </Button>
                </Space>
            </div>

            {testList.map((testData, index) => (
                <BoxComponent
                    key={index}
                    inputParams={inputParams}
                    testData={testData}
                    testIndex={index}
                    setTestList={setTestList}
                    handleRun={(testData) => handleRun(testData, index)}
                    results={resultsList[index]}
                    resultsList={resultsList}
                    onAddToTestset={setParams}
                    handleDeleteRow={handleDeleteRow}
                />
            ))}
            <Button
                type="primary"
                size="large"
                icon={<PlusOutlined />}
                onClick={handleAddRow}
                style={{
                    marginTop: "16px",
                    width: "200px",
                    marginBottom: "24px",
                    marginLeft: "12px",
                }}
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
