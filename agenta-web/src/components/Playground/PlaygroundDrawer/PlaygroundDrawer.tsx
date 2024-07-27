import React, {useEffect, useState} from "react"
import {useQueryParam} from "@/hooks/useQuery"
import {TraceSpan, TraceSpanDetails, TraceSpanTreeNode} from "@/lib/Types"
import {ClockCircleOutlined, PlusCircleOutlined} from "@ant-design/icons"
import {Drawer, DrawerProps, Space, Tabs, Tooltip, Tree, Typography} from "antd"
import {createUseStyles} from "react-jss"
import {JSSTheme, KeyValuePair} from "@/lib/Types"
import AddToTestSetDrawer from "@/components/Playground/AddToTestSetDrawer/AddToTestSetDrawer"
import {capitalize, getStringOrJson} from "@/lib/helpers/utils"
import {GenerationContentTab, GenerationDetailsTab, GenerationModelConfigTab} from "./tabItems"
import _ from "lodash"
import {RiCoinLine, RiArrowLeftUpLine} from "react-icons/ri"
import {formatLatency, formatNumber} from "@/lib/helpers/formatters"
import {formatDate24} from "@/lib/helpers/dateTimeHelper"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        marginBottom: "0 !important",
        marginTop: 0,
    },
    date: {
        fontSize: 12,
        fontWeight: 400,
        color: theme.colorTextDescription,
    },
    container: {
        display: "flex",
        gap: "2rem",
        width: "100%",
        overflow: "auto",
        height: "100%",
        "& .ant-tree-treenode": {
            width: "100%",
            "& .ant-tree-title": {
                width: "100%",
                display: "block",
                padding: "0.75rem",
            },
        },
        "&>*:first-of-type": {
            flex: 1,
        },
        "&>*:last-of-type": {
            flex: 1,
        },
        "& .ant-tree-switcher": {
            height: 24,
        },
        "& .ant-tree-node-content-wrapper": {
            border: `1px solid ${theme.colorBorder}`,
            width: "100%",
        },
        "& .ant-tree-switcher-leaf-line::after": {
            display: "none",
        },
        "& .ant-tree-treenode-leaf-last .ant-tree-switcher-leaf-line:last-of-type": {
            "&::before": {
                display: "none",
            },
        },
    },
    tabsRoot: {
        "& .ant-tabs-tab": {
            paddingTop: 0,
        },
    },
    fullWidth: {
        width: "100%",
    },
}))

type Type = "generation" | "trace"

const TreeItem: React.FC<TraceSpan & {type: Type; onClick: () => void}> = ({
    type,
    onClick,
    ...data
}) => {
    return (
        <Space className={"w-full"} direction="vertical" onClick={onClick}>
            <Space className="justify-between w-full gap-x-6 items-center flex">
                <Space>
                    <Typography.Text strong>{"Span"}</Typography.Text>
                    <Typography.Text>{data.name ?? ""}</Typography.Text>
                </Space>

                <Space className="text-xs text-gray-500">
                    {/* <CalendarOutlined /> */}
                    {formatDate24(data.created_at)}
                </Space>
            </Space>

            <Typography.Text style={{fontSize: 12}}>
                <Space size="middle">
                    <Space>
                        <ClockCircleOutlined />
                        {formatLatency(data.metadata?.latency)}
                    </Space>

                    <Space>
                        <RiArrowLeftUpLine />
                        {data.spankind}
                    </Space>
                    <Space>
                        <RiCoinLine className="mt-1" size={12} strokeWidth={2} />
                        {formatNumber(data.metadata?.usage?.total_tokens)}
                    </Space>
                </Space>
            </Typography.Text>
        </Space>
    )
}

interface Props {
    type: Type
    traceSpans: TraceSpan[]
}

const GenerationDrawer: React.FC<Props & DrawerProps> = ({type, traceSpans, ...props}) => {
    const classes = useStyles()
    const [tab, setTab] = useQueryParam("tab", "content")
    const [selected, setSelected] = useQueryParam("selected")
    const [generation, setGeneration] = useState<TraceSpanDetails>()
    // const [trace, setTrace] = useState<any>()
    const [addToTestset, setAddToTestset] = useState(false)

    const fetchGen = (id: string) => {
        const trace = traceSpans.find((span) => span.id === id)
        if (trace) {
            setGeneration(trace)
        }
    }

    const fetchTraceDetails = (id: string) => {
        const trace = traceSpans.find((span) => span.id === id)

        if (trace) {
            // setTrace({...trace, spans: traceSpans})
            setGeneration(trace)
            setSelected(trace.id)
        }
    }

    const buildTreeData = (spans: TraceSpan[]): TraceSpanTreeNode[] => {
        return spans.map((span) => ({
            title: <TreeItem {...span} onClick={() => fetchGen(span.id!)} type="generation" />,
            key: span.id,
            children: span.children ? buildTreeData(span.children) : undefined,
        }))
    }

    useEffect(() => {
        if (!traceSpans.length) return
        type === "generation" ? fetchGen(traceSpans[0].id) : fetchTraceDetails(traceSpans[0].id)
    }, [props.open])

    const onAddToTestset = () => {
        setAddToTestset(true)
    }

    const tabItems: React.ComponentProps<typeof Tabs>["items"] = []
    if (generation?.content)
        tabItems.push({
            key: "content",
            label: "Content",
            children: <GenerationContentTab data={generation} />,
        })
    if (generation)
        tabItems.push({
            key: "details",
            label: "Details",
            children: <GenerationDetailsTab generation={generation} />,
        })
    if (generation?.config)
        tabItems.push({
            key: "modelConfig",
            label: "Model Config",
            children: <GenerationModelConfigTab data={generation} />,
        })

    return (
        <Drawer
            width={900}
            height={700}
            closeIcon={null}
            title={
                <Space direction="vertical" size={0} className={`${classes.fullWidth}`}>
                    <Space
                        align="center"
                        className={classes.fullWidth}
                        style={{justifyContent: "space-between"}}
                    >
                        <Typography.Title className={classes.title} level={5}>
                            {capitalize(type)} Details
                        </Typography.Title>
                        <Space>
                            {generation?.content && (
                                <Tooltip title="Add to testset">
                                    <PlusCircleOutlined onClick={onAddToTestset} />
                                </Tooltip>
                            )}
                        </Space>
                    </Space>
                    {generation && (
                        <Typography.Text className={classes.date}>
                            {formatDate24(generation.created_at, true)}
                        </Typography.Text>
                    )}
                </Space>
            }
            {...props}
            onClose={(e) => {
                props?.onClose?.(e)
                setTimeout(() => {
                    setTab("")
                    setSelected("")
                    setGeneration(undefined)
                    // setTrace(undefined)
                }, 100)
            }}
            destroyOnClose
        >
            <div className={classes.container}>
                <div className="flex flex-col">
                    {traceSpans.map((span) => (
                        <>
                            <Tree
                                selectedKeys={[selected]}
                                onSelect={(keys) => setSelected(keys[0]?.toString() || span.id)}
                                showLine
                                defaultExpandAll
                                treeData={[
                                    {
                                        title: (
                                            <TreeItem
                                                {...span}
                                                onClick={() => {
                                                    setGeneration(span)
                                                }}
                                                type="trace"
                                            />
                                        ),
                                        key: span.id,
                                        children: span.children
                                            ? buildTreeData(span.children)
                                            : undefined,
                                    },
                                ]}
                            />
                        </>
                    ))}
                </div>

                {generation && (
                    <Tabs
                        className={classes.tabsRoot}
                        activeKey={tab}
                        onChange={setTab}
                        items={tabItems}
                    />
                )}
            </div>

            {generation?.content && (
                <AddToTestSetDrawer
                    open={addToTestset}
                    onClose={() => setAddToTestset(false)}
                    params={{
                        ...generation.content.inputs.reduce((acc: KeyValuePair, input) => {
                            acc[getStringOrJson(input.input_name)] = getStringOrJson(
                                input.input_value,
                            )
                            return acc
                        }, {}),
                        correct_answer: (generation.content.outputs?.[0] ?? "").toString(),
                    }}
                    isChatVariant={false}
                />
            )}
        </Drawer>
    )
}

export default GenerationDrawer
