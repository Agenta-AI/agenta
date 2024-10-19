import CopyButton from "@/components/CopyButton/CopyButton"
import ResultTag from "@/components/ResultTag/ResultTag"
import {JSSTheme} from "@/lib/Types"
import {ArrowRight, Database, PlusCircle, Rocket, Sparkle, Timer} from "@phosphor-icons/react"
import {Button, Collapse, Divider, Space, Tabs, TabsProps, Typography} from "antd"
import React, {useState} from "react"
import {createUseStyles} from "react-jss"
import {IBM_Plex_Mono} from "next/font/google"
import {_AgentaRootsResponse} from "@/services/observability/types"
import dayjs from "dayjs"
import {getStringOrJson} from "@/lib/helpers/utils"

const ibm_plex_mono = IBM_Plex_Mono({
    subsets: ["latin"],
    weight: ["400", "500", "600"],
})

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
    collapseContainer: {
        backgroundColor: "unset",
        "& .ant-collapse-item": {
            background: theme.colorFillAlter,
            borderRadius: `${theme.borderRadiusLG}px !important`,
            border: `1px solid ${theme.colorBorder}`,
        },
        "& .ant-collapse-item:last-child": {
            borderBottom: `1px solid ${theme.colorBorder}`,
        },
        "& .ant-collapse-header": {
            alignItems: "center !important",
        },
        "& .ant-collapse-content": {
            borderTop: `1px solid ${theme.colorBorder} !important`,
            padding: theme.padding,
            lineHeight: theme.lineHeight,
            backgroundColor: `${theme.colorBgContainer} !important`,
            borderBottomLeftRadius: theme.borderRadius,
            borderBottomRightRadius: theme.borderRadius,
            fontSize: theme.fontSize,
            "& .ant-collapse-content-box": {
                padding: "0px !important",
            },
        },
    },
}))

const TraceContent = ({activeTrace}: TraceContentProps) => {
    const {node, time, meta, data} = activeTrace
    const classes = useStyles()
    const [tab, setTab] = useState("overview")

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
                                <Collapse
                                    items={[
                                        {
                                            key: "inputs",
                                            label: "inputs",
                                            children: (
                                                <div className={ibm_plex_mono.className}>
                                                    {getStringOrJson(data.inputs)}
                                                </div>
                                            ),
                                            extra: (
                                                <CopyButton
                                                    text={getStringOrJson(data.inputs)}
                                                    icon={true}
                                                    buttonText={null}
                                                    stopPropagation
                                                />
                                            ),
                                        },
                                    ]}
                                    className={classes.collapseContainer}
                                    bordered={false}
                                />
                            ) : (
                                Object.values(data.inputs).map((item) =>
                                    Array.isArray(item)
                                        ? item.map((param, index) =>
                                              param.role !== "tool" ? (
                                                  <Collapse
                                                      key={index}
                                                      items={[
                                                          {
                                                              key: param.role,
                                                              label: param.role,
                                                              children: (
                                                                  <div
                                                                      className={
                                                                          ibm_plex_mono.className
                                                                      }
                                                                  >
                                                                      {getStringOrJson(
                                                                          param.content,
                                                                      )}
                                                                  </div>
                                                              ),
                                                              extra: (
                                                                  <CopyButton
                                                                      text={getStringOrJson(
                                                                          param.content,
                                                                      )}
                                                                      icon={true}
                                                                      buttonText={null}
                                                                      stopPropagation
                                                                  />
                                                              ),
                                                          },
                                                      ]}
                                                      className={classes.collapseContainer}
                                                      bordered={false}
                                                  />
                                              ) : (
                                                  "TO_DO"
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
                                <Collapse
                                    items={[
                                        {
                                            key: "outputs",
                                            label: "outputs",
                                            children: (
                                                <div className={ibm_plex_mono.className}>
                                                    {getStringOrJson(data.outputs)}
                                                </div>
                                            ),
                                            extra: (
                                                <CopyButton
                                                    text={getStringOrJson(data.outputs)}
                                                    icon={true}
                                                    buttonText={null}
                                                    stopPropagation
                                                />
                                            ),
                                        },
                                    ]}
                                    className={classes.collapseContainer}
                                    bordered={false}
                                />
                            ) : (
                                Object.values(data.outputs).map((item) =>
                                    Array.isArray(item)
                                        ? item.map((param, index) =>
                                              !!param.content &&
                                              !Array.isArray(param.tool_calls) ? (
                                                  <Collapse
                                                      key={index}
                                                      items={[
                                                          {
                                                              key: "assistant",
                                                              label: "assistant",
                                                              children: (
                                                                  <div
                                                                      className={
                                                                          ibm_plex_mono.className
                                                                      }
                                                                  >
                                                                      {getStringOrJson(
                                                                          param.content,
                                                                      )}
                                                                  </div>
                                                              ),
                                                              extra: (
                                                                  <CopyButton
                                                                      text={getStringOrJson(
                                                                          param.content,
                                                                      )}
                                                                      icon={true}
                                                                      buttonText={null}
                                                                      stopPropagation
                                                                  />
                                                              ),
                                                          },
                                                      ]}
                                                      className={classes.collapseContainer}
                                                      bordered={false}
                                                  />
                                              ) : (
                                                  "TO_DO"
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
                                <Collapse
                                    items={[
                                        {
                                            key: "internals",
                                            label: "internals",
                                            children: (
                                                <div className={ibm_plex_mono.className}>
                                                    {getStringOrJson(data.internals)}
                                                </div>
                                            ),
                                            extra: (
                                                <CopyButton
                                                    text={getStringOrJson(data.internals)}
                                                    icon={true}
                                                    buttonText={null}
                                                    stopPropagation
                                                />
                                            ),
                                        },
                                    ]}
                                    className={classes.collapseContainer}
                                    bordered={false}
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
                            <Button className="flex items-center">
                                <Rocket size={14} />
                                Open in playground
                            </Button>
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
                        color="cyan"
                        bordered
                        value1={
                            <>
                                <Sparkle size={14} /> {node.type}
                            </>
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
                    <ResultTag
                        value1={
                            <>
                                <Timer size={14} /> 0.02
                            </>
                        }
                    />
                    <ResultTag
                        value1={
                            <>
                                <PlusCircle size={14} />
                                79 / $0.005
                            </>
                        }
                        popoverContent={
                            <>
                                <Typography.Text>Prompt tokens</Typography.Text>
                                <Typography.Text>Completion tokens</Typography.Text>
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
