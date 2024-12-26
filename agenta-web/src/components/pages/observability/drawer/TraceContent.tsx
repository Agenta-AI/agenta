import ResultTag from "@/components/ResultTag/ResultTag"
import {JSSTheme, KeyValuePair} from "@/lib/Types"
import {ArrowRight, Database, PlusCircle, Rocket, Timer} from "@phosphor-icons/react"
import {Button, Divider, Space, Tabs, TabsProps, Typography} from "antd"
import React, {useState} from "react"
import {dynamicComponent} from "@/lib/helpers/dynamic"
import {createUseStyles} from "react-jss"
import {_AgentaRootsResponse} from "@/services/observability/types"
import dayjs from "dayjs"
import {getStringOrJson} from "@/lib/helpers/utils"
import {statusMapper} from "../components/AvatarTreeContent"
import {formatCurrency, formatLatency, formatTokenUsage} from "@/lib/helpers/formatters"
import StatusRenderer from "../components/StatusRenderer"
import AccordionTreePanel from "../components/AccordionTreePanel"
import {TestsetDrawerProps} from "./TestsetDrawer/assets/types"
const TestsetDrawer = dynamicComponent<TestsetDrawerProps>(
    "pages/observability/drawer/TestsetDrawer/TestsetDrawer",
)

interface TraceContentProps {
    activeTrace: _AgentaRootsResponse
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        flex: 1,
        border: `1px solid ${theme.colorBorder}`,
        borderRadius: theme.borderRadius,
        display: "flex",
        height: "100%",
        "& .ant-tag": {
            margin: 0,
            display: "flex",
            alignItems: "center",
            gap: 8,
        },
    },
    title: {
        fontSize: theme.fontSizeHeading5,
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeightHeading5,
    },
    subTitle: {
        fontSize: theme.fontSize,
        lineHeight: theme.lineHeight,
        fontWeight: theme.fontWeightMedium,
    },
    tabs: {
        height: "100%",
        display: "flex",
        flexDirection: "column",
        "& .ant-tabs-nav": {
            marginBottom: 8,
            "& .ant-tabs-nav-wrap": {
                padding: "0 16px",
            },
        },
        "& .ant-tabs-content-holder": {
            padding: theme.padding,
            flex: 1,
            "& .ant-tabs-content": {
                height: "100%",
                "& .ant-tabs-tabpane": {
                    height: "100%",
                },
            },
        },
    },
    tokenContainer: {
        "& > div:nth-of-type(1)": {
            lineHeight: theme.lineHeight,
            fontWeight: theme.fontWeightMedium,
        },
        "& > div:nth-of-type(2)": {
            lineHeight: theme.lineHeight,
            fontWeight: 400,
        },
    },
    resultTag: {
        display: "flex",
        alignItems: "center",
        fontFamily: "monospace",
        gap: 4,
    },
}))

const TraceContent = ({activeTrace}: TraceContentProps) => {
    const {key, children, ...filteredTrace} = activeTrace
    const classes = useStyles()
    const [tab, setTab] = useState("overview")
    const {icon, bgColor, color} = statusMapper(activeTrace.node.type)
    const [isTestsetDrawerOpen, setIsTestsetDrawerOpen] = useState(false)

    const transformDataInputs = (data: any) => {
        return Object.keys(data).reduce((acc, curr) => {
            if (curr === "prompt") {
                acc[curr] = data[curr]
            }

            if (!acc.tools) {
                acc.tools = []
            }

            if (curr === "functions") {
                const functions = data[curr].map((item: any) => ({
                    type: "function",
                    function: item,
                }))
                acc.tools.push(...functions)
            }

            if (curr === "tools") {
                acc.tools.push(...data[curr])
            }

            return acc
        }, {} as any)
    }

    const items: TabsProps["items"] = [
        {
            key: "overview",
            label: "Overview",
            children: (
                <Space direction="vertical" size={24} className="w-full">
                    {activeTrace.meta && activeTrace.meta.request && (
                        <Space direction="vertical">
                            <Typography.Text className={classes.subTitle}>
                                Meta Data
                            </Typography.Text>
                            <Space style={{flexWrap: "wrap"}}>
                                {Object.entries(activeTrace.meta.request).map(
                                    ([key, value], index) => (
                                        <ResultTag
                                            key={index}
                                            value1={key}
                                            value2={getStringOrJson(value)}
                                        />
                                    ),
                                )}
                            </Space>
                        </Space>
                    )}

                    {activeTrace.data && activeTrace.data?.inputs ? (
                        <Space direction="vertical" className="w-full" size={24}>
                            {activeTrace.node.type !== "chat" ? (
                                <AccordionTreePanel
                                    label={"inputs"}
                                    value={activeTrace.data.inputs}
                                    enableFormatSwitcher
                                />
                            ) : (
                                Object.entries(transformDataInputs(activeTrace.data?.inputs)).map(
                                    ([key, values]) => {
                                        if (key === "prompt") {
                                            return Array.isArray(values)
                                                ? values.map((param, index) => (
                                                      <AccordionTreePanel
                                                          key={index}
                                                          label={param.role}
                                                          value={param.content}
                                                          enableFormatSwitcher={
                                                              param.role === "tool"
                                                          }
                                                      />
                                                  ))
                                                : null
                                        } else {
                                            return Array.isArray(values) && values.length > 0 ? (
                                                <AccordionTreePanel
                                                    key={key}
                                                    label="tools"
                                                    value={values as any[]}
                                                    enableFormatSwitcher
                                                />
                                            ) : null
                                        }
                                    },
                                )
                            )}
                        </Space>
                    ) : null}

                    {activeTrace.data && activeTrace.data?.outputs ? (
                        <Space direction="vertical" className="w-full" size={24}>
                            {activeTrace.node.type !== "chat" ? (
                                <AccordionTreePanel
                                    label={"outputs"}
                                    value={activeTrace.data.outputs}
                                    enableFormatSwitcher
                                />
                            ) : (
                                Object.values(activeTrace.data.outputs).map((item) =>
                                    Array.isArray(item)
                                        ? item.map((param, index) =>
                                              !!param.content &&
                                              !Array.isArray(param.tool_calls) ? (
                                                  <AccordionTreePanel
                                                      key={index}
                                                      label={"assistant"}
                                                      value={param.content}
                                                      bgColor="#E6FFFB"
                                                  />
                                              ) : (
                                                  <AccordionTreePanel
                                                      key={index}
                                                      label={"assistant"}
                                                      value={param}
                                                      enableFormatSwitcher
                                                  />
                                              ),
                                          )
                                        : null,
                                )
                            )}
                        </Space>
                    ) : null}

                    {activeTrace.data && activeTrace.data?.internals && (
                        <Space direction="vertical" className="w-full" size={24}>
                            {activeTrace.node.type !== "chat" && (
                                <AccordionTreePanel
                                    label={"internals"}
                                    value={activeTrace.data.internals}
                                    enableFormatSwitcher
                                />
                            )}
                        </Space>
                    )}

                    {activeTrace.exception && (
                        <Space direction="vertical" className="w-full" size={24}>
                            <AccordionTreePanel
                                label={"Exception"}
                                value={activeTrace.exception}
                                enableFormatSwitcher
                                bgColor="#FBE7E7"
                            />
                        </Space>
                    )}
                </Space>
            ),
        },
        {
            key: "raw_data",
            label: "Raw Data",
            children: (
                <AccordionTreePanel
                    label={"Raw Data"}
                    value={{...filteredTrace}}
                    enableFormatSwitcher
                    fullEditorHeight
                />
            ),
        },
    ]

    return (
        <div className={classes.container}>
            <div className="flex-1 flex flex-col">
                <div>
                    <div className="p-4 flex items-center justify-between">
                        <Typography.Text className={classes.title}>
                            {activeTrace.node.name}
                        </Typography.Text>

                        <Space>
                            <Button
                                className="flex items-center"
                                onClick={() => setIsTestsetDrawerOpen(true)}
                                disabled={!activeTrace.key}
                            >
                                <Database size={14} />
                                Add to testset
                            </Button>
                        </Space>
                    </div>
                    <Divider className="m-0" />
                </div>
                <div className="p-4 flex flex-wrap gap-2">
                    <ResultTag
                        style={{
                            backgroundColor: bgColor,
                            border: `1px solid ${color}`,
                            color: color,
                        }}
                        bordered
                        value1={
                            <>
                                {icon} {activeTrace.node.type}
                            </>
                        }
                    />
                    <StatusRenderer status={activeTrace.status} />
                    <ResultTag
                        value1={
                            <div className={classes.resultTag}>
                                <Timer size={14} />{" "}
                                {formatLatency(
                                    activeTrace?.metrics?.acc?.duration?.total
                                        ? activeTrace?.metrics?.acc?.duration?.total / 1000
                                        : null,
                                )}
                            </div>
                        }
                    />
                    <ResultTag
                        value1={
                            <div className={classes.resultTag}>
                                <PlusCircle size={14} />
                                {formatTokenUsage(activeTrace.metrics?.acc?.tokens?.total)} /{" "}
                                {formatCurrency(activeTrace.metrics?.acc?.costs?.total)}
                            </div>
                        }
                        popoverContent={
                            <Space direction="vertical">
                                <Space className={classes.tokenContainer}>
                                    <div>
                                        {formatTokenUsage(activeTrace.metrics?.acc?.tokens?.prompt)}
                                    </div>
                                    <div>Prompt tokens</div>
                                </Space>
                                <Space className={classes.tokenContainer}>
                                    <div>
                                        {formatTokenUsage(
                                            activeTrace.metrics?.acc?.tokens?.completion,
                                        )}
                                    </div>
                                    <div>Completion tokens</div>
                                </Space>
                            </Space>
                        }
                    />
                    <ResultTag
                        value1={
                            <div className={classes.resultTag}>
                                {dayjs(activeTrace.time.start)
                                    .local()
                                    .format("DD/MM/YYYY, hh:mm:ss A")}
                                <ArrowRight size={14} />{" "}
                                {dayjs(activeTrace.time.end)
                                    .local()
                                    .format("DD/MM/YYYY, hh:mm:ss A")}
                            </div>
                        }
                    />
                </div>
                <div className="flex-1 flex flex-col overflow-y-auto">
                    <Tabs
                        defaultActiveKey="overview"
                        activeKey={tab}
                        onChange={setTab}
                        items={items}
                        className={classes.tabs}
                    />
                </div>
            </div>
            {isTestsetDrawerOpen && (
                <TestsetDrawer
                    open={isTestsetDrawerOpen}
                    data={[{data: activeTrace.data as KeyValuePair, key: activeTrace.key, id: 1}]}
                    onClose={() => setIsTestsetDrawerOpen(false)}
                />
            )}
        </div>
    )
}

export default TraceContent
