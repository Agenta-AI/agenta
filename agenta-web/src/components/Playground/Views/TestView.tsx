import React, {useState} from "react"
import {Button, Input, Card, Row, Col, Space, Form} from "antd"
import {CaretRightOutlined, PlusOutlined} from "@ant-design/icons"
import {callVariant} from "@/lib/services/api"
import {ChatMessage, ChatRole, GenericObject, Parameter, Variant} from "@/lib/Types"
import {randString, removeKeys} from "@/lib/helpers/utils"
import LoadTestsModal from "../LoadTestsModal"
import AddToTestSetDrawer from "../AddToTestSetDrawer/AddToTestSetDrawer"
import {DeleteOutlined} from "@ant-design/icons"
import {getErrorMessage} from "@/lib/helpers/errorHandler"
import {createUseStyles} from "react-jss"
import CopyButton from "@/components/CopyButton/CopyButton"
import {useRouter} from "next/router"
import {getDefaultNewMessage} from "@/components/ChatInputs/ChatInputs"
import {v4 as uuidv4} from "uuid"
import {testsetRowToChatMessages} from "@/lib/helpers/testset"
import ParamsForm from "../ParamsForm/ParamsForm"

const {TextArea} = Input
const LOADING_TEXT = "Loading..."

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
    variant: Variant
    inputParams: Parameter[] | null
    optParams: Parameter[] | null
    isChatVariant?: boolean
}

interface BoxComponentProps {
    inputParams: Parameter[] | null
    testData: GenericObject
    result: string
    onInputParamChange: (paramName: string, newValue: any) => void
    onRun: () => void
    onAddToTestset: (params: Record<string, string>) => void
    onDelete?: () => void
    isChatVariant?: boolean
}

const BoxComponent: React.FC<BoxComponentProps> = ({
    inputParams,
    testData,
    result,
    onInputParamChange,
    onRun,
    onAddToTestset,
    onDelete,
    isChatVariant = false,
}) => {
    const classes = useStylesBox()
    const loading = result === LOADING_TEXT
    const [form] = Form.useForm()

    if (!inputParams) {
        return <div>Loading...</div>
    }

    const handleAddToTestset = () => {
        const params: Record<string, string> = {}
        inputParams.forEach(({name}) => {
            params[name] = testData[name] || ""
        })
        params.correct_answer = result
        if (isChatVariant) {
            const messages = testData.chat.filter((item: ChatMessage) => !!item.content)
            params.chat = messages.slice(0, -1)
            params.correct_answer = messages.at(-1)
        }

        onAddToTestset(params)
    }

    return (
        <Card className={classes.card}>
            <Row className={classes.rowHeader}>
                <h4>{isChatVariant ? "Chat" : "Input parameters"}</h4>
                {onDelete && <Button icon={<DeleteOutlined />} onClick={onDelete}></Button>}
            </Row>

            <Row className={classes.row1}>
                <ParamsForm
                    isChatVariant={isChatVariant}
                    inputParams={
                        isChatVariant
                            ? [{value: testData.chat, name: "chat"} as any]
                            : inputParams.map((item) => ({...item, value: testData[item.name]}))
                    }
                    onFinish={onRun}
                    onParamChange={onInputParamChange}
                />
            </Row>
            <Row className={classes.row2} style={{marginBottom: isChatVariant ? 12 : 0}}>
                <Col span={24} className={classes.row2Col}>
                    <Button
                        shape="round"
                        icon={<PlusOutlined />}
                        onClick={handleAddToTestset}
                        disabled={loading}
                    >
                        Add to Test Set
                    </Button>
                    <CopyButton
                        buttonText={isChatVariant ? "Copy last message" : "Copy result"}
                        text={result}
                        disabled={loading || !result}
                        shape="round"
                    />
                    <Button
                        data-cy="testview-input-parameters-run-button"
                        type="primary"
                        shape="round"
                        icon={<CaretRightOutlined />}
                        onClick={isChatVariant ? onRun : form.submit}
                        loading={loading}
                    >
                        Run
                    </Button>
                </Col>
            </Row>
            {!isChatVariant && (
                <Row className={classes.row3}>
                    <TextArea
                        data-cy="testview-input-parameters-result"
                        value={result}
                        rows={6}
                        placeholder="Results will be shown here"
                        disabled={!result || result === LOADING_TEXT}
                    />
                </Row>
            )}
        </Card>
    )
}

const App: React.FC<TestViewProps> = ({inputParams, optParams, variant, isChatVariant}) => {
    const router = useRouter()
    const appId = router.query.app_id as unknown as string
    const [testList, setTestList] = useState<GenericObject[]>([{}])
    const [resultsList, setResultsList] = useState<string[]>(testList.map(() => ""))
    const [params, setParams] = useState<Record<string, string> | null>(null)
    const classes = useStylesApp()

    const setResultForIndex = (value: string, index: number) => {
        if (isChatVariant) {
            setTestList((prevState) =>
                prevState.map((prevItem, prevIndex) => {
                    const chat = prevItem.chat || []
                    const isLoading = value === LOADING_TEXT
                    const isPrevLoading = chat.at(-1)?.content === LOADING_TEXT

                    return prevIndex === index
                        ? {
                              ...prevItem,
                              chat: (isPrevLoading ? chat.slice(0, -1) : chat).concat(
                                  isLoading
                                      ? [{id: uuidv4(), content: value, role: ChatRole.Assistant}]
                                      : [
                                            {
                                                id: uuidv4(),
                                                content: value,
                                                role: ChatRole.Assistant,
                                            },
                                            getDefaultNewMessage(),
                                        ],
                              ),
                          }
                        : prevItem
                }),
            )
        } else {
            setResultsList((prevState) => {
                return prevState.map((prevResult, prevIndex) =>
                    prevIndex === index ? value : prevResult,
                )
            })
        }
    }

    const handleRun = async (index: number) => {
        try {
            setResultForIndex(LOADING_TEXT, index)

            const testItem = testList[index]
            const res = await callVariant(
                isChatVariant ? removeKeys(testItem, ["chat"]) : testItem,
                inputParams || [],
                optParams || [],
                appId || "",
                variant.baseId || "",
                isChatVariant ? testItem.chat : [],
            )

            setResultForIndex(res, index)
        } catch (e) {
            setResultForIndex(
                "The code has resulted in the following error: \n\n --------------------- \n" +
                    getErrorMessage(e) +
                    "\n---------------------\n\nPlease update your code, and re-serve it using cli and try again.\n\nFor more information please read https://docs.agenta.ai/howto/how-to-debug\n\nIf you believe this is a bug, please create a new issue here: https://github.com/Agenta-AI/agenta/issues/new?title=Issue%20in%20playground",
                index,
            )
        }
    }

    const handleRunAll = () => {
        testList.forEach((_, index) => handleRun(index))
    }

    const handleAddRow = () => {
        setTestList([...testList, {_id: randString(6)}])
        setResultsList([...resultsList, ""])
    }

    const handleDeleteRow = (testIndex: number) => {
        setTestList((prevTestList) => prevTestList.filter((_, index) => index !== testIndex))
        setResultsList((prevResultsList) =>
            prevResultsList.filter((_, index) => index !== testIndex),
        )
    }

    const handleInputParamChange = (paramName: string, value: any, index: number) => {
        setTestList((prevState) => {
            const newState = [...prevState]
            newState[index] = {...newState[index], [paramName]: value}
            return newState
        })
    }

    const onLoadTests = (tests: Record<string, string>[], shouldReplace: boolean) => {
        const testsList = tests.map((test) => ({
            ...test,
            ...(isChatVariant ? {chat: testsetRowToChatMessages(test, false)} : {}),
            _id: randString(6),
        }))
        if (shouldReplace) {
            setTestList(testsList)
        } else {
            setTestList((prev) => [...prev, ...testsList])
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
                    key={testData._id}
                    inputParams={inputParams}
                    testData={testData}
                    result={
                        isChatVariant
                            ? testData?.chat?.findLast?.((item: ChatMessage) => !!item.content)
                                  ?.content
                            : resultsList[index]
                    }
                    onInputParamChange={(paramName, value) =>
                        handleInputParamChange(paramName, value, index)
                    }
                    onRun={() => handleRun(index)}
                    onAddToTestset={setParams}
                    onDelete={testList.length >= 2 ? () => handleDeleteRow(index) : undefined}
                    isChatVariant={isChatVariant}
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
                isChatVariant={!!isChatVariant}
            />
        </div>
    )
}

export default App
