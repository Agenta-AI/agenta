import React, {useContext, useEffect, useMemo, useRef, useState} from "react"
import {Button, Input, Card, Row, Col, Space, Form, Modal} from "antd"
import {CaretRightOutlined, CloseCircleOutlined, PlusOutlined} from "@ant-design/icons"
import {callVariant} from "@/services/api"
import {
    ChatMessage,
    ChatRole,
    GenericObject,
    JSSTheme,
    Parameter,
    Variant,
    StyleProps,
    BaseResponse,
    TraceDetailsV2,
    TraceDetailsV3,
} from "@/lib/Types"
import {batchExecute, getStringOrJson, isDemo, randString, removeKeys} from "@/lib/helpers/utils"
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
import isEqual from "lodash/isEqual"
import {useAppTheme} from "@/components/Layout/ThemeContextProvider"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import duration from "dayjs/plugin/duration"
import {useQueryParam} from "@/hooks/useQuery"
import {formatCurrency, formatLatency, formatTokenUsage} from "@/lib/helpers/formatters"
import {dynamicService} from "@/lib/helpers/dynamic"
import {isBaseResponse, isFuncResponse} from "@/lib/helpers/playgroundResp"
import {AgentaNodeDTO} from "@/services/observability/types"
import GenericDrawer from "@/components/GenericDrawer"
import TraceHeader from "@/components/pages/observability/drawer/TraceHeader"
import TraceTree from "@/components/pages/observability/drawer/TraceTree"
import TraceContent from "@/components/pages/observability/drawer/TraceContent"
import {
    buildNodeTree,
    getNodeById,
    observabilityTransformer,
} from "@/lib/helpers/observability_helpers"

const promptRevision: any = dynamicService("promptVersioning/api")

dayjs.extend(relativeTime)
dayjs.extend(duration)

const {TextArea} = Input
const LOADING_TEXT = "Loading..."

const useStylesBox = createUseStyles((theme: JSSTheme) => ({
    card: {
        marginTop: 16,
        border: "1px solid #ccc",
        marginRight: "24px",
        marginLeft: "12px",
        "& .ant-card-body": {
            padding: "8px 16px",
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
        justifyContent: "space-between",
        display: "flex",
        alignItems: "center",
    },
    row3: {
        margin: "16px 0",
        position: "relative",
        "& textarea": {
            height: "100%",
            width: "100%",
        },
    },
    copyButton: {
        position: "absolute",
        right: 6,
        opacity: 0.5,
        bottom: 6,
        color: theme.colorPrimary,
    },
    viewTracesBtn: {
        "& > span": {
            textDecoration: "underline",
            color: theme.colorPrimary,
            "&:hover": {
                textDecoration: "none",
            },
        },
    },
    cardDeleteIcon: {
        color: "red",
    },
}))

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
    setPromptOptParams: React.Dispatch<React.SetStateAction<Parameter[] | null>>
    promptOptParams: Parameter[] | null
}

interface BoxComponentProps {
    inputParams: Parameter[] | null
    testData: GenericObject
    result: string
    additionalData: {
        cost: number | null
        latency: number | null
        usage: number | null
    }
    onInputParamChange: (paramName: string, newValue: any) => void
    onRun: () => void
    onAddToTestset: (params: Record<string, string>) => void
    onDelete?: () => void
    isChatVariant?: boolean
    variant: Variant
    onCancel: () => void
    traceSpans: TraceDetailsV3 | undefined
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
    traceSpans,
}) => {
    const [selectedTraceId, setSelectedTraceId] = useQueryParam("trace", "")

    const traces = useMemo(() => {
        if (traceSpans && traceSpans) {
            return traceSpans.nodes
                .flatMap((node: AgentaNodeDTO) => buildNodeTree(node))
                .flatMap((item: any) => observabilityTransformer(item))
        }
    }, [traceSpans])

    const activeTrace = useMemo(() => (traces ? traces[0] ?? null : null), [traces])
    const [selected, setSelected] = useState("")

    useEffect(() => {
        if (!selected) {
            setSelected(activeTrace?.node.id ?? "")
        }
    }, [activeTrace, selected])

    const selectedItem = useMemo(
        () => (traces?.length ? getNodeById(traces, selected) : null),
        [selected, traces],
    )

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

                {onDelete && (
                    <Button
                        type="text"
                        icon={<DeleteOutlined className={classes.cardDeleteIcon} />}
                        onClick={onDelete}
                    ></Button>
                )}
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
                    isPlaygroundComponent={true}
                    isLoading={loading}
                />
            </Row>
            <Row className={classes.row2} style={{marginBottom: isChatVariant ? 12 : 0}}>
                <Col span={24} className={classes.row2Col} id={variant.variantId}>
                    <h4>{isChatVariant ? "" : "Results"}</h4>

                    <Space>
                        <Button
                            icon={<PlusOutlined />}
                            onClick={handleAddToTestset}
                            disabled={loading}
                        >
                            Add to Test Set
                        </Button>
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
                                icon={<CaretRightOutlined />}
                                onClick={isChatVariant ? onRun : form.submit}
                                loading={loading}
                            >
                                Run Test
                            </Button>
                        )}
                    </Space>
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
                            background: result?.startsWith("❌")
                                ? appTheme === "dark"
                                    ? "#490b0b"
                                    : "#fff1f0"
                                : "",
                            color: result?.startsWith("❌")
                                ? appTheme === "dark"
                                    ? "#ffffffd9"
                                    : "#000000e0"
                                : "",
                        }}
                    />
                    <CopyButton
                        buttonText={null}
                        text={result}
                        disabled={loading || !result}
                        icon={true}
                        className={classes.copyButton}
                    />
                </Row>
            )}
            {additionalData?.cost || additionalData?.latency ? (
                <Space className="flex items-center gap-3">
                    <span>Tokens: {formatTokenUsage(additionalData?.usage)}</span>
                    <span>Cost: {formatCurrency(additionalData?.cost)}</span>
                    <span>Latency: {formatLatency(additionalData?.latency)}</span>
                    {traceSpans && (
                        <Button
                            type="link"
                            className={classes.viewTracesBtn}
                            onClick={() => setSelectedTraceId(traceSpans.nodes[0].node.id)}
                        >
                            View Trace
                        </Button>
                    )}
                </Space>
            ) : (
                ""
            )}

            {activeTrace && !!traces?.length && (
                <GenericDrawer
                    open={!!selectedTraceId}
                    onClose={() => setSelectedTraceId("")}
                    expandable
                    headerExtra={
                        <TraceHeader
                            activeTrace={activeTrace}
                            traces={traces}
                            setSelectedTraceId={setSelectedTraceId}
                            activeTraceIndex={0}
                        />
                    }
                    mainContent={selectedItem ? <TraceContent activeTrace={selectedItem} /> : null}
                    sideContent={
                        <TraceTree
                            activeTrace={activeTrace}
                            selected={selected}
                            setSelected={setSelected}
                        />
                    }
                />
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
    setPromptOptParams,
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

    const rootRef = React.useRef<HTMLDivElement>(null)
    const [isLLMProviderMissingModalOpen, setIsLLMProviderMissingModalOpen] = useState(false)

    const [additionalDataList, setAdditionalDataList] = useState<
        Array<{
            cost: number | null
            latency: number | null
            usage: number | null
        }>
    >(testList.map(() => ({cost: null, latency: null, usage: null})))
    const [traceSpans, setTraceSpans] = useState<TraceDetailsV3>()
    const [revisionNum] = useQueryParam("revision")

    useEffect(() => {
        if (!revisionNum) return

        const fetchData = async () => {
            await promptRevision.then(async (module: any) => {
                if (!module) return

                const revision = await module.fetchPromptRevision(
                    variant.variantId,
                    parseInt(revisionNum),
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
                            const newValue = (revision?.config.parameters as Record<string, any>)[
                                param.name
                            ]
                            if (newValue !== undefined) {
                                param.default = newValue
                            }
                        }
                        return param
                    })
                })
            })
        }

        fetchData()
    }, [revisionNum])

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

            const result = await callVariant(
                isChatVariant ? removeKeys(testItem, ["chat"]) : testItem,
                inputParams || [],
                optParams || [],
                appId || "",
                variant.baseId || "",
                isChatVariant ? testItem.chat || [{}] : [],
                controller.signal,
                true,
            )

            let res: BaseResponse | undefined

            // Check result type
            // String, FuncResponse or BaseResponse
            if (typeof result === "string") {
                res = {version: "3.0", data: result} as BaseResponse
                setResultForIndex(getStringOrJson(res.data), index)
            } else if (isFuncResponse(result)) {
                const res = {version: "3.0", data: result.message}
                setResultForIndex(getStringOrJson(res.data), index)

                const {message, cost, latency, usage} = result

                // Set additional data
                setAdditionalDataList((prev) => {
                    const newDataList = [...prev]
                    newDataList[index] = {
                        cost,
                        latency,
                        usage: usage?.total_tokens,
                    }
                    return newDataList
                })
            } else if (isBaseResponse(result)) {
                res = result as BaseResponse
                setResultForIndex(getStringOrJson(res.data), index)

                const {tree, trace, version} = result

                // Main update logic
                setAdditionalDataList((prev) => {
                    const newDataList = [...prev]
                    if (version === "2.0" && trace) {
                        newDataList[index] = {
                            cost: trace?.cost ?? null,
                            latency: trace?.latency ?? null,
                            usage: trace?.usage?.total_tokens ?? null,
                        }
                    } else if (version === "3.0" && tree) {
                        const firstTraceNode = tree.nodes[0]
                        newDataList[index] = {
                            cost: firstTraceNode?.metrics?.acc?.costs?.total ?? null,
                            latency: firstTraceNode?.metrics?.acc?.duration?.total / 1000 || null,
                            usage: firstTraceNode?.metrics?.acc?.tokens?.total ?? null,
                        }
                    }
                    return newDataList
                })

                if (tree && isDemo()) {
                    setTraceSpans(tree)
                }
            } else {
                console.error("Unknown response type:", result)
            }
        } catch (e: any) {
            if (!controller.signal.aborted) {
                setResultForIndex(
                    `❌ ${getErrorMessage(e?.response?.data?.error || e?.response?.data, e)}`,
                    index,
                )
                if (e?.response?.status === 401) {
                    setIsLLMProviderMissingModalOpen(true)
                }
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

    return (
        <div ref={rootRef}>
            <div className={classes.testView}>
                <h2>2. Preview and test</h2>
                <Space size={10}>
                    <LoadTestsModal onLoad={onLoadTests} />

                    {!isRunningAll ? (
                        <Button type="primary" size="middle" onClick={handleRunAll}>
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
                    traceSpans={traceSpans}
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

            <Modal
                centered
                title="Incorrect LLM key provided"
                open={isLLMProviderMissingModalOpen}
                onOk={() => router.push("/settings?tab=secrets")}
                onCancel={() => setIsLLMProviderMissingModalOpen(false)}
                okText={"View LLM Keys"}
            >
                <p>
                    The API key for the LLM is either incorrect or missing. Please ensure that you
                    have a valid API key for the model you are using.
                </p>
            </Modal>
        </div>
    )
}

export default App
