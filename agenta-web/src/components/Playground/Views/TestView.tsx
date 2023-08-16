import React, {Dispatch, SetStateAction, useContext, useState} from "react"
import {Button, Input, Card, Row, Col, Space, message} from "antd"
import {CaretRightOutlined, PlusOutlined} from "@ant-design/icons"
import {callVariant} from "@/lib/services/api"
import {Parameter} from "@/lib/Types"
import {renameVariables} from "@/lib/helpers/utils"
import {TestContext} from "../TestContextProvider"
import LoadTestsModal from "../LoadTestsModal"

interface TestViewProps {
    URIPath: string | null
    inputParams: Parameter[] | null
    optParams: Parameter[] | null
}

interface BoxComponentProps {
    inputParams: Parameter[] | null
    URIPath: string | null
    testData: Record<string, string>
    testIndex: number
    setTestList: Dispatch<SetStateAction<Record<string, string>[]>>
    handleRun: (testData: Record<string, string>, testIndex: number) => Promise<void>
    results: string
    resultsList: string[]
    error: boolean
}

const BoxComponent: React.FC<BoxComponentProps> = ({
    inputParams,
    URIPath,
    testData,
    testIndex,
    setTestList,
    handleRun,
    results,
    resultsList,
    error,
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

    return (
        <>
            <Card
                style={{
                    marginTop: 16,
                    border: "1px solid #ccc",
                    marginRight: "24px",
                    marginLeft: "12px",
                }}
                bodyStyle={{padding: "4px 16px", border: "0px solid #ccc"}}
            >
                <h4 style={{padding: "0px", marginTop: "8px", marginBottom: "0px"}}>
                    Input parameters
                </h4>

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
                    <Col span={24} style={{textAlign: "right"}}>
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
                            color: error ? "red" : undefined,
                        }}
                    />
                </Row>
            </Card>
        </>
    )
}

const App: React.FC<TestViewProps> = ({inputParams, optParams, URIPath}) => {
    const {testList, setTestList} = useContext(TestContext)

    const [resultsList, setResultsList] = useState<string[]>(testList.map(() => ""))

    const [errorList, setErrorList] = useState<boolean[]>(testList.map(() => false))

    const handleRun = async (testData: Record<string, string>, testIndex: number) => {
        try {
            const newResultsList = [...resultsList]
            newResultsList[testIndex] = "Loading..."
            const newErrorList = [...errorList]
            newErrorList[testIndex] = false

            setResultsList(newResultsList)
            setErrorList(newErrorList)

            const result = await callVariant(testData, inputParams, optParams, URIPath)

            const newResultList2 = [...resultsList]
            newResultList2[testIndex] = result
            setResultsList(newResultList2)
        } catch (e: any) {
            const newResultsList = [...resultsList]
            const newErrorList = [...errorList]

            Object.entries(OpenAiErrors).map(([key, value]) => {
                if (e.toString().includes(key)) {
                    newResultsList[testIndex] = value
                    newErrorList[testIndex] = true
                    message.error(`${value} at row ${testIndex + 1}`)
                }
            })

            setResultsList(newResultsList)
            setErrorList(newErrorList)
        }
    }

    const handleRunAll = async () => {
        const newResultsList = testList.map(() => "Loading...")

        setResultsList(testList.map(() => "Loading..."))

        setErrorList(errorList.map(() => false))

        try {
            const resultsPromises = testList.map(async (testData, index) => {
                return await callVariant(testData, inputParams, optParams, URIPath)
            })

            const results = await Promise.all(resultsPromises)

            results.forEach((result, index) => {
                newResultsList[index] = result
            })
        } catch (e: any) {
            const messageError: string[] = []
            const newErrorList = [...errorList]
            newResultsList.forEach((_, index) => {
                Object.entries(OpenAiErrors).map(([key, value]) => {
                    if (e.toString().includes(key)) {
                        newResultsList[index] = value
                        newErrorList[index] = true
                        if (!messageError.includes(value)) messageError.push(value)
                    }
                })
            })
            messageError.forEach((msg) => {
                message.error(`${msg} at some rows`)
            })
            setErrorList(newErrorList)
        }

        setResultsList(newResultsList)
    }

    const handleAddRow = () => {
        setTestList([...testList, {}])
    }

    const handleSetNewTests: (tests: Record<string, string>[]) => void = (tests) => {
        setTestList([...tests])
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
                    URIPath={URIPath}
                    testData={testData}
                    testIndex={index}
                    setTestList={setTestList}
                    handleRun={(testData) => handleRun(testData, index)}
                    results={resultsList[index]}
                    resultsList={resultsList}
                    error={errorList[index]}
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
        </div>
    )
}

export default App

const OpenAiErrors = {
    "Error: You exceeded your current quota, please check your plan and billing details":
        "You exceeded your current quota, please check your plan and billing details.",
    "Error: Error communicating with OpenAI": "Error communicating with OpenAI.",
}
