import ResultTag from "@/components/ResultTag/ResultTag"
import {JSSTheme} from "@/lib/Types"
import {ArrowRight, Database, PlusCircle, Rocket, Timer} from "@phosphor-icons/react"
import {Button, Divider, Space, Tabs, TabsProps, Typography} from "antd"
import React, {useState} from "react"
import {createUseStyles} from "react-jss"
import {_AgentaRootsResponse} from "@/services/observability/types"
import dayjs from "dayjs"
import {getStringOrJson} from "@/lib/helpers/utils"
import {statusMapper} from "../components/AvatarTreeContent"
import {formatCurrency, formatLatency, formatTokenUsage} from "@/lib/helpers/formatters"
import StatusRenderer from "../components/StatusRenderer"
import AccordionTreePanel from "../components/AccordionTreePanel"

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
            overflowY: "auto",
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
}))

const TraceContent = ({activeTrace}: TraceContentProps) => {
    const {node, time, meta, data, status, metrics, parent} = activeTrace
    const classes = useStyles()
    const [tab, setTab] = useState("overview")
    const {icon, bgColor, color} = statusMapper(node.type, status)

    const items: TabsProps["items"] = [
        {
            key: "overview",
            label: "Overview",
            children: (
                <Space direction="vertical" size={24} className="w-full">
                    {meta && meta.request && (
                        <Space direction="vertical">
                            <Typography.Text className={classes.subTitle}>Summary</Typography.Text>
                            <Space style={{flexWrap: "wrap"}}>
                                {Object.entries(meta.request).map(([key, value], index) => (
                                    <ResultTag
                                        key={index}
                                        value1={key}
                                        value2={getStringOrJson(value)}
                                    />
                                ))}
                            </Space>
                        </Space>
                    )}

                    {data && data?.inputs ? (
                        <Space direction="vertical" className="w-full">
                            {node.type !== "chat" ? (
                                <AccordionTreePanel
                                    label={"inputs"}
                                    value={data.inputs}
                                    enableFormatSwitcher
                                />
                            ) : (
                                Object.values(data.inputs).map((item) =>
                                    Array.isArray(item)
                                        ? item.map((param, index) =>
                                              param.role !== "tool" ? (
                                                  <AccordionTreePanel
                                                      key={index}
                                                      label={param.role}
                                                      value={param.content}
                                                  />
                                              ) : (
                                                  <AccordionTreePanel
                                                      key={index}
                                                      label={param.role}
                                                      value={param.content}
                                                      enableFormatSwitcher
                                                  />
                                              ),
                                          )
                                        : null,
                                )
                            )}
                        </Space>
                    ) : null}

                    {data && data?.outputs ? (
                        <Space direction="vertical" className="w-full">
                            {node.type !== "chat" ? (
                                <AccordionTreePanel
                                    label={"outputs"}
                                    value={data.outputs}
                                    enableFormatSwitcher
                                />
                            ) : (
                                Object.values(data.outputs).map((item) =>
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
                                                      value={param.content}
                                                      enableFormatSwitcher
                                                  />
                                              ),
                                          )
                                        : null,
                                )
                            )}
                        </Space>
                    ) : null}

                    {data && data?.internals && (
                        <Space direction="vertical" className="w-full">
                            {node.type !== "chat" && (
                                <AccordionTreePanel
                                    label={"internals"}
                                    value={data.internals}
                                    enableFormatSwitcher
                                />
                            )}
                        </Space>
                    )}
                </Space>
            ),
        },
        {
            key: "raw_data",
            label: "Raw Data",
            children: "Content of Tab Pane 2",
        },
    ]

    return (
        <div className={classes.container}>
            <div className="flex-1 flex flex-col">
                <div>
                    <div className="p-4 flex items-center justify-between">
                        <Typography.Text className={classes.title}>{node.name}</Typography.Text>

                        <Space>
                            {!parent && (
                                <Button className="flex items-center">
                                    <Rocket size={14} />
                                    Open in playground
                                </Button>
                            )}
                            <Button className="flex items-center">
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
                            backgroundColor: status.code === "ERROR" ? "#FBE7E7" : bgColor,
                            border: `1px solid ${status.code === "ERROR" ? "#D61010" : color}`,
                            color: status.code === "ERROR" ? "#D61010" : color,
                        }}
                        bordered
                        value1={
                            <>
                                {icon} {node.type}
                            </>
                        }
                    />
                    <StatusRenderer {...status} />
                    <ResultTag
                        value1={
                            <>
                                <Timer size={14} /> {formatLatency(time.span / 1000000)}
                            </>
                        }
                    />
                    <ResultTag
                        value1={
                            <>
                                <PlusCircle size={14} />
                                {formatTokenUsage(metrics?.acc?.tokens?.total)} /{" "}
                                {formatCurrency(metrics?.acc?.costs?.total)}
                            </>
                        }
                        popoverContent={
                            <Space direction="vertical">
                                <Space className={classes.tokenContainer}>
                                    <div>{formatTokenUsage(metrics?.acc?.tokens?.prompt)}</div>
                                    <div>Prompt tokens</div>
                                </Space>
                                <Space className={classes.tokenContainer}>
                                    <div>{formatTokenUsage(metrics?.acc?.tokens?.completion)}</div>
                                    <div>Completion tokens</div>
                                </Space>
                            </Space>
                        }
                    />
                    <ResultTag
                        value1={
                            <>
                                {dayjs(time.start).format("DD/MM/YYYY, hh:mm:ss A")}
                                <ArrowRight size={14} />{" "}
                                {dayjs(time.end).format("DD/MM/YYYY, hh:mm:ss A")}
                            </>
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
            {/* <Divider type="vertical" className="h-full m-0" />
            <div className="w-[320px] p-4 flex flex-col gap-4">
                <Typography.Text className={classes.title}>Evaluation</Typography.Text>

                <Space direction="vertical">
                    <ResultTag value1="Evaluator Name" value2={"70"} />
                </Space>
            </div> */}
        </div>
    )
}

export default TraceContent
