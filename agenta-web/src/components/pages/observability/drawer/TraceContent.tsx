import CopyButton from "@/components/CopyButton/CopyButton"
import ResultTag from "@/components/ResultTag/ResultTag"
import {JSSTheme} from "@/lib/Types"
import {ArrowRight, Database, PlusCircle, Rocket, Sparkle, Timer} from "@phosphor-icons/react"
import {Button, Collapse, CollapseProps, Divider, Space, Tabs, TabsProps, Typography} from "antd"
import React, {useState} from "react"
import {createUseStyles} from "react-jss"
import {IBM_Plex_Mono} from "next/font/google"

const ibm_plex_mono = IBM_Plex_Mono({
    subsets: ["latin"],
    weight: ["400", "500", "600"],
})

interface TraceContentProps {}

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
            marginBottom: 24,
            background: theme.colorFillAlter,
            borderRadius: `${theme.borderRadiusLG}px !important`,
            border: `1px solid ${theme.colorBorder}`,
            borderBottom: "in",
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

const TraceContent = ({}: TraceContentProps) => {
    const classes = useStyles()
    const [tab, setTab] = useState("overview")

    const accordionItems: CollapseProps["items"] = [
        {
            key: "1",
            label: "System",
            children: (
                <div className={ibm_plex_mono.className}>
                    You are an expert Q&A system that is trusted around the world. Always answer the
                    query using the provided context information, and not prior knowledge. Some
                    rules to follow: 1. Never directly reference the given context in your answer.
                    2. Avoid statements like 'Based on the context, ...' or 'The context information
                    ...' or anything along those lines.
                </div>
            ),
            extra: <CopyButton text="" icon={true} buttonText={null} />,
        },
        {
            key: "2",
            label: "User",
            children: (
                <div className={ibm_plex_mono.className}>
                    You are an expert Q&A system that is trusted around the world. Always answer the
                    query using the provided context information, and not prior knowledge. Some
                    rules to follow: 1. Never directly reference the given context in your answer.
                    2. Avoid statements like 'Based on the context, ...' or 'The context information
                    ...' or anything along those lines.
                </div>
            ),
            extra: <CopyButton text="" icon={true} buttonText={null} />,
        },
        {
            key: "3",
            label: "Assistant / Output",
            children: (
                <div className={ibm_plex_mono.className}>
                    You are an expert Q&A system that is trusted around the world. Always answer the
                    query using the provided context information, and not prior knowledge. Some
                    rules to follow: 1. Never directly reference the given context in your answer.
                    2. Avoid statements like 'Based on the context, ...' or 'The context information
                    ...' or anything along those lines.
                </div>
            ),
            extra: <CopyButton text="" icon={true} buttonText={null} />,
        },
        {
            key: "4",
            label: "Assistant / Output",
            children: (
                <div className={ibm_plex_mono.className}>
                    You are an expert Q&A system that is trusted around the world. Always answer the
                    query using the provided context information, and not prior knowledge. Some
                    rules to follow: 1. Never directly reference the given context in your answer.
                    2. Avoid statements like 'Based on the context, ...' or 'The context information
                    ...' or anything along those lines.
                </div>
            ),
            extra: <CopyButton text="" icon={true} buttonText={null} />,
        },
        {
            key: "4",
            label: "Assistant / Output",
            children: (
                <div className={ibm_plex_mono.className}>
                    You are an expert Q&A system that is trusted around the world. Always answer the
                    query using the provided context information, and not prior knowledge. Some
                    rules to follow: 1. Never directly reference the given context in your answer.
                    2. Avoid statements like 'Based on the context, ...' or 'The context information
                    ...' or anything along those lines.
                </div>
            ),
            extra: <CopyButton text="" icon={true} buttonText={null} />,
        },
    ]

    const items: TabsProps["items"] = [
        {
            key: "overview",
            label: "Overview",
            children: (
                <Space direction="vertical" size={24}>
                    <Space direction="vertical">
                        <Typography.Text>Summary</Typography.Text>
                        <Space style={{flexWrap: "wrap"}}>
                            <ResultTag value1="Model" value2={"gpt-3.5-turbo"} />
                            <ResultTag value1="Temperature" value2={1.24} />
                            <ResultTag value1="Max tokens" value2={1} />
                            <ResultTag value1="Top p" value2={-1} />
                            <ResultTag value1="Frequency penalty" value2={0} />
                            <ResultTag value1="Presence penalty" value2={0} />
                            <ResultTag value1="Force json" value2={"off"} />
                        </Space>
                    </Space>

                    <Collapse
                        defaultActiveKey={["1"]}
                        items={accordionItems}
                        className={classes.collapseContainer}
                        bordered={false}
                    />
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
                        <Typography.Text className={classes.title}>generation</Typography.Text>

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
                                <Sparkle size={14} /> LLM
                            </>
                        }
                    />
                    <ResultTag
                        value1={
                            <>
                                08/29/2024, 10:35:01 AM <ArrowRight size={14} /> 08/29/2024,
                                10:35:03 AM
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
            <Divider type="vertical" className="h-full m-0" />
            <div className="w-[320px] p-4 flex flex-col gap-4">
                <Typography.Text className={classes.title}>Evaluation</Typography.Text>

                <Space direction="vertical">
                    <ResultTag value1="Evaluator Name" value2={"70"} />
                    <ResultTag value1="Evaluator Name" value2={"70"} />
                    <ResultTag value1="Evaluator Name" value2={"70"} />
                    <ResultTag value1="Evaluator Name" value2={"70"} />
                </Space>
            </div>
        </div>
    )
}

export default TraceContent
