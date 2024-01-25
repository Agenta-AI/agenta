import React, {useContext, useEffect, useRef, useState} from "react"
import {
    Button,
    Input,
    Card,
    Row,
    Col,
    Space,
    Form,
    Drawer,
    Typography,
    Divider,
    Empty,
    Result,
} from "antd"
import {
    CaretRightOutlined,
    CloseCircleOutlined,
    LoadingOutlined,
    PlusOutlined,
} from "@ant-design/icons"
import {callVariant} from "@/lib/services/api"
import {
    ChatMessage,
    ChatRole,
    GenericObject,
    IPromptRevisions,
    IPromptVersioning,
    Parameter,
    Variant,
} from "@/lib/Types"
import {batchExecute, randString, removeKeys} from "@/lib/helpers/utils"
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
import {TestContext} from "../TestContextProvider"
import {isEqual} from "lodash"
import {useAppTheme} from "@/components/Layout/ThemeContextProvider"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import duration from "dayjs/plugin/duration"
import {useQueryParam} from "@/hooks/useQuery"
dayjs.extend(relativeTime)
dayjs.extend(duration)

type StyleProps = {
    themeMode: "dark" | "light"
}

const {Text} = Typography

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
    historyContainer: ({themeMode}: StyleProps) => ({
        display: "flex",
        flexDirection: "column",
        padding: "10px 20px 20px",
        margin: "20px 0",
        borderRadius: 10,
        backgroundColor: themeMode === "dark" ? "#1f1f1f" : "#fff",
        color: themeMode === "dark" ? "#fff" : "#000",
        borderColor: themeMode === "dark" ? "#333" : "#eceff1",
        border: "1px solid",
        boxShadow: `0px 4px 8px ${
            themeMode === "dark" ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)"
        }`,
    }),
    tagText: {
        color: "#656d76",
        fontSize: 12,
    },
    revisionText: {
        fontWeight: "bold",
    },
    emptyContainer: {
        marginTop: "4rem",
    },
    divider: {
        margin: "15px 0",
    },
})

interface TestViewProps {
    variant: Variant
    inputParams: Parameter[] | null
    optParams: Parameter[] | null
    isChatVariant?: boolean
    compareMode: boolean
    onStateChange: (isDirty: boolean) => void
    promptRevisions: IPromptVersioning | undefined
    historyStatus: {
        loading: boolean
        error: boolean
    }
    setPromptOptParams: React.Dispatch<React.SetStateAction<Parameter[] | null>>
    promptOptParams: Parameter[] | null
    setIsDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>
    isDrawerOpen: boolean
}

interface BoxComponentProps {
    inputParams: Parameter[] | null
    testData: GenericObject
    result: string
    additionalData: {
        cost: number | null
        latency: number | null
        usage: {completion_tokens: number; prompt_tokens: number; total_tokens: number} | null
    }
    onInputParamChange: (paramName: string, newValue: any) => void
    onRun: () => void
    onAddToTestset: (params: Record<string, string>) => void
    onDelete?: () => void
    isChatVariant?: boolean
    variant: Variant
    onCancel: () => void
}

const BoxComponent: React.FC<BoxComponentProps> = ({
    inputParams,
    testData,
    result,
    additionalData,
    onInputParamChange,
    onRun,
    onAddToTestset,
    onDelete,
    isChatVariant = false,
    variant,
    onCancel,
}) => {
    const {appTheme} = useAppTheme()
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
            const messages = testData?.chat?.filter((item: ChatMessage) => !!item.content)
            params.chat = messages?.slice(0, -1)
            params.correct_answer = messages?.at(-1)
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
                    form={form}
                    imageSize="large"
                />
            </Row>
            {additionalData?.cost || additionalData?.latency ? (
                <Space>
                    <p>
                        Tokens:{" "}
                        {additionalData.usage !== null
                            ? JSON.stringify(additionalData.usage.total_tokens)
                            : 0}
                    </p>
                    <p>
                        Cost:{" "}
                        {additionalData.cost !== null
                            ? `$${additionalData.cost.toFixed(4)}`
                            : "$0.00"}
                    </p>
                    <p>
                        Latency:{" "}
                        {additionalData.latency !== null
                            ? `${Math.round(additionalData.latency * 1000)}ms`
                            : "0ms"}
                    </p>
                </Space>
            ) : (
                ""
            )}
            <Row className={classes.row2} style={{marginBottom: isChatVariant ? 12 : 0}}>
                <Col span={24} className={classes.row2Col} id={variant.variantId}>
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
                    {loading ? (
                        <Button
                            icon={<CloseCircleOutlined />}
                            type="primary"
                            style={{backgroundColor: "#d32f2f"}}
                            onClick={onCancel}
                            className={`testview-cancel-button-${testData._id}`}
                        >
                            Cancel
                        </Button>
                    ) : (
                        <Button
                            data-cy="testview-input-parameters-run-button"
                            className={`testview-run-button-${testData._id}`}
                            type="primary"
                            shape="round"
                            icon={<CaretRightOutlined />}
                            onClick={isChatVariant ? onRun : form.submit}
                            loading={loading}
                        >
                            Run
                        </Button>
                    )}
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
                        style={{
                            background: result?.startsWith("❌ Error code")
                                ? appTheme === "dark"
                                    ? "#490b0b"
                                    : "#fff1f0"
                                : "",
                            color: result?.startsWith("❌ Error code")
                                ? appTheme === "dark"
                                    ? "#ffffffd9"
                                    : "#000000e0"
                                : "",
                        }}
                    />
                </Row>
            )}
        </Card>
    )
}

const App: React.FC<TestViewProps> = ({
    inputParams,
    optParams,
    variant,
    isChatVariant,
    compareMode,
    onStateChange,
    setPromptOptParams,
    promptOptParams,
    promptRevisions,
    historyStatus,
    isDrawerOpen,
    setIsDrawerOpen,
}) => {
    const router = useRouter()
    const appId = router.query.app_id as unknown as string
    const {
        testList: _testList,
        setTestList: _setTestList,
        isRunning,
        setIsRunning,
    } = useContext(TestContext)
    const {appTheme} = useAppTheme()
    const [testList, setTestList] = useState<GenericObject[]>(_testList)
    const [resultsList, setResultsList] = useState<string[]>(testList.map(() => ""))
    const [params, setParams] = useState<Record<string, string> | null>(null)
    const classes = useStylesApp({themeMode: appTheme} as StyleProps)
    // const {promptRevisions, isDrawerOpen, setIsDrawerOpen, historyStatus, setPromptOptParams} =
    //     useContext(PromptVersioningContext)

    const rootRef = React.useRef<HTMLDivElement>(null)
    const [additionalDataList, setAdditionalDataList] = useState<
        Array<{
            cost: number | null
            latency: number | null
            usage: {completion_tokens: number; prompt_tokens: number; total_tokens: number} | null
        }>
    >(testList.map(() => ({cost: null, latency: null, usage: null})))
    const [revisionNum, setRevisionNum] = useQueryParam("revision")

    useEffect(() => {
        if (!revisionNum) return

        const revision = promptRevisions?.revisions.find(
            (rev) => rev.revision === parseInt(revisionNum),
        )

        if (!revision) return

        setPromptOptParams((prevState: Parameter[] | null) => {
            if (!prevState) {
                return prevState
            }

            const parameterNames = [
                "temperature",
                "model",
                "max_tokens",
                "prompt_system",
                "prompt_user",
                "top_p",
                "frequence_penalty",
                "presence_penalty",
                "inputs",
            ]

            return prevState.map((param: Parameter) => {
                if (parameterNames.includes(param.name)) {
                    param.default = (revision?.config.parameters as Record<string, any>)[param.name]
                }
                return param
            })
        })
    }, [revisionNum, promptRevisions])

    const abortControllersRef = useRef<AbortController[]>([])
    const [isRunningAll, setIsRunningAll] = useState(false)

    useEffect(() => {
        return () => {
            abortControllersRef.current.forEach((controller) => controller.abort())
        }
    }, [])

    useEffect(() => {
        setResultsList((prevResultsList) => {
            const newResultsList = testList.map((_, index) => {
                return index < prevResultsList.length ? prevResultsList[index] : ""
            })
            return newResultsList
        })
    }, [testList])

    useEffect(() => {
        setTestList(_testList)
    }, [JSON.stringify(_testList)])

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
        const controller = new AbortController()
        abortControllersRef.current[index] = controller
        try {
            const testItem = testList[index]
            if (compareMode && !isRunning[index]) {
                let called = false
                const callback = () => {
                    if (called) return
                    called = true
                    document
                        .querySelectorAll(`.testview-run-button-${testItem._id}`)
                        .forEach((btn) => {
                            if (btn.parentElement?.id !== variant.variantId) {
                                ;(btn as HTMLButtonElement).click()
                            }
                        })
                }

                setIsRunning((prevState) => {
                    const newState = [...prevState]
                    newState[index] = true
                    return newState
                }, callback)
                setTimeout(callback, 300)
            }
            setResultForIndex(LOADING_TEXT, index)

            const res = await callVariant(
                isChatVariant ? removeKeys(testItem, ["chat"]) : testItem,
                inputParams || [],
                optParams || [],
                appId || "",
                variant.baseId || "",
                isChatVariant ? testItem.chat : [],
                controller.signal,
                true,
            )

            // check if res is an object or string
            if (typeof res === "string") {
                setResultForIndex(res, index)
            } else {
                setResultForIndex(res.message, index)
                setAdditionalDataList((prev) => {
                    const newDataList = [...prev]
                    newDataList[index] = {cost: res.cost, latency: res.latency, usage: res.usage}
                    return newDataList
                })
            }
        } catch (e) {
            if (!controller.signal.aborted) {
                setResultForIndex(`❌ ${getErrorMessage(e)}`, index)
            } else {
                setResultForIndex("", index)
                setAdditionalDataList((prev) => {
                    const newDataList = [...prev]
                    newDataList[index] = {cost: null, latency: null, usage: null}
                    return newDataList
                })
            }
        } finally {
            setIsRunning((prevState) => {
                const newState = [...prevState]
                newState[index] = false
                return newState
            })
        }
    }

    const handleCancel = (index: number) => {
        if (abortControllersRef.current[index]) {
            abortControllersRef.current[index].abort()
        }
        if (compareMode && isRunning[index]) {
            const testItem = testList[index]

            document.querySelectorAll(`.testview-cancel-button-${testItem._id}`).forEach((btn) => {
                if (btn.parentElement?.id !== variant.variantId) {
                    ;(btn as HTMLButtonElement).click()
                }
            })
        }
    }

    const handleCancelAll = () => {
        const funcs: Function[] = []
        rootRef.current
            ?.querySelectorAll("[class*=testview-cancel-button-]")
            .forEach((btn) => funcs.push(() => (btn as HTMLButtonElement).click()))
        batchExecute(funcs)
    }

    const handleRunAll = async () => {
        const funcs: Function[] = []
        rootRef.current
            ?.querySelectorAll("[data-cy=testview-input-parameters-run-button]")
            .forEach((btn) => funcs.push(() => (btn as HTMLButtonElement).click()))

        setIsRunningAll(true)
        await batchExecute(funcs)
        setIsRunningAll(false)
    }

    const handleAddRow = () => {
        _setTestList([...testList, {_id: randString(6)}])
        setResultsList([...resultsList, ""])
    }

    const handleDeleteRow = (testIndex: number) => {
        _setTestList((prevTestList) => prevTestList.filter((_, index) => index !== testIndex))
        setResultsList((prevResultsList) =>
            prevResultsList.filter((_, index) => index !== testIndex),
        )
    }

    const handleInputParamChange = (paramName: string, value: any, index: number) => {
        const newState = [...testList]
        newState[index] = {...newState[index], [paramName]: value}
        setTestList(newState)

        if (
            !isEqual(_testList[index][paramName], value) &&
            !isEqual(testList[index][paramName], value)
        ) {
            _setTestList(newState)
        }
    }

    const onLoadTests = (tests: Record<string, string>[], shouldReplace: boolean) => {
        const testsList = tests.map((test) => ({
            ...test,
            ...(isChatVariant ? {chat: testsetRowToChatMessages(test, false)} : {}),
            _id: randString(6),
        }))
        if (shouldReplace) {
            _setTestList(testsList)
        } else {
            _setTestList((prev) => [...prev, ...testsList])
        }
    }

    const filteredRevisions = promptRevisions?.revisions.filter(
        (item) => item.config.parameters.inputs,
    )

    return (
        <div ref={rootRef}>
            <div className={classes.testView}>
                <h2>2. Preview and test</h2>
                <Space size={10}>
                    <LoadTestsModal onLoad={onLoadTests} />

                    {!isRunningAll ? (
                        <Button
                            type="primary"
                            size="middle"
                            className={classes.runAllBtn}
                            onClick={handleRunAll}
                        >
                            Run all
                        </Button>
                    ) : (
                        <Button
                            size="middle"
                            type="primary"
                            style={{backgroundColor: "#d32f2f"}}
                            onClick={handleCancelAll}
                        >
                            Cancel All
                        </Button>
                    )}
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
                    additionalData={additionalDataList[index]}
                    onInputParamChange={(paramName, value) =>
                        handleInputParamChange(paramName, value, index)
                    }
                    onRun={() => handleRun(index)}
                    onAddToTestset={setParams}
                    onDelete={testList.length >= 2 ? () => handleDeleteRow(index) : undefined}
                    isChatVariant={isChatVariant}
                    variant={variant}
                    onCancel={() => handleCancel(index)}
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

            <Drawer
                open={isDrawerOpen}
                title="History"
                size="default"
                destroyOnClose
                onClose={() => setIsDrawerOpen(false)}
            >
                {historyStatus.loading ? (
                    <Result
                        className={classes.emptyContainer}
                        icon={<LoadingOutlined />}
                        subTitle="Loading..."
                    />
                ) : historyStatus.error ? (
                    <Result
                        className={classes.emptyContainer}
                        subTitle="Failed to Load History."
                        status={"error"}
                    />
                ) : (
                    <>
                        {!!filteredRevisions?.length ? (
                            filteredRevisions
                                ?.map((item: IPromptRevisions) => (
                                    <div key={item.revision} className={classes.historyContainer}>
                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "space-between",
                                            }}
                                        >
                                            <Text className={classes.revisionText}>
                                                {`# ${item.revision}`}
                                            </Text>

                                            <Text className={classes.tagText}>
                                                {dayjs(item.created_at).fromNow()}
                                            </Text>
                                        </div>

                                        <Divider className={classes.divider} />

                                        <Space style={{justifyContent: "space-between"}}>
                                            <Space direction="vertical">
                                                <div>
                                                    <Text strong>Config Name: </Text>
                                                    <Text>{item.config.config_name}</Text>
                                                </div>
                                                <div>
                                                    <Text strong>Modified By: </Text>
                                                    <Text>{item.modified_by}</Text>
                                                </div>
                                            </Space>
                                            <Button
                                                type="primary"
                                                onClick={() => {
                                                    setRevisionNum(item.revision.toString())
                                                    onStateChange(true)
                                                    setIsDrawerOpen(false)
                                                }}
                                            >
                                                Restore
                                            </Button>
                                        </Space>
                                    </div>
                                ))
                                .reverse()
                        ) : (
                            <Empty
                                className={classes.emptyContainer}
                                description="You have no saved changes"
                            />
                        )}
                    </>
                )}
            </Drawer>
        </div>
    )
}

export default App
